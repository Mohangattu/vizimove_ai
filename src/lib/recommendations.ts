/**
 * Driver Recommendation Engine
 * Constraint-aware, evidence-backed repositioning optimization and audit logging.
 */

import { DriverRecommendation, RecommendationPriority, RecommendationStatus } from './types';
import { VIZAG_ZONES, calculateHaversineDistance, estimateTravelTimeMinutes, getZoneById } from './zones';
import { FleetManager } from './fleet';
import { analyzeAllZonesSupplyDemand, getSupplyDemandRankings } from './supplyDemand';
import { getEventsForZone } from './events';
import { forecast15mForZone } from './forecasting';
import { persistentStore } from '../db/store';

export class RecommendationEngine {
  private recommendations: Map<string, DriverRecommendation> = new Map();
  private recommendationCounter: number = 501;

  constructor() {}

  /**
   * Generates optimal repositioning recommendations based on 60-minute operational demand forecast.
   * Leverages 15-minute intervals (4 quarter-hours) to detect sustained deficits and event surges.
   * Enforces all operational constraints (distance ≤ 12km, travel time ≤ 32min, batch 2-15, reserve ≥ 3, battery ≥ 20%).
   * Dispatches eligible recommendations autonomously and records forecast evidence.
   */
  public generateRecommendations(
    fleetManager: FleetManager,
    targetTime: Date = new Date(),
    maxRecommendations: number = 6,
    autoDispatch: boolean = false
  ): DriverRecommendation[] {
    const allEvents = persistentStore.getEvents();
    const zones = VIZAG_ZONES;

    // 1. Calculate 60-minute demand across the four upcoming 15-minute intervals for all zones
    interface Zone60mAnalysis {
      zone: (typeof zones)[0];
      demand60m: number;
      capacity60m: number;
      deficit60m: number;
      surplus60m: number;
      neededVehicles: number;
      peak15mDemand: number;
      peak15mInterval: string;
      availableVehicles: number;
      activeEvent?: string;
    }

    const intervalLabels = ['0-15m', '15-30m', '30-45m', '45-60m'];
    const analyses60m: Zone60mAnalysis[] = [];

    for (const zone of zones) {
      const zoneEvents = getEventsForZone(zone.id, allEvents);
      const activeEvt = zoneEvents.find((e) => e.status === 'ACTIVE' || e.status === 'UPCOMING');

      let demand60m = 0;
      let peak15mDemand = 0;
      let peak15mInterval = intervalLabels[0];

      for (let i = 0; i < 4; i++) {
        const intervalTarget = new Date(targetTime.getTime() + i * 15 * 60 * 1000);
        const f15 = forecast15mForZone(zone, intervalTarget, allEvents);
        demand60m += f15.eventAdjustedDemand;
        if (f15.eventAdjustedDemand > peak15mDemand) {
          peak15mDemand = Math.round(f15.eventAdjustedDemand);
          peak15mInterval = intervalLabels[i];
        }
      }

      demand60m = Math.round(demand60m);
      const availableVehicles = fleetManager.getAvailableVehiclesInZone(zone.id).length;
      // 2.2 trips per vehicle per hour capacity standard
      const capacity60m = Math.round(availableVehicles * 2.2 * 10) / 10;
      const deficit60m = Math.max(0, Math.round(demand60m - capacity60m));
      const vehiclesNeededForDemand = Math.ceil(demand60m / 2.2);
      const surplus60m = Math.max(0, availableVehicles - vehiclesNeededForDemand);
      const neededVehicles = Math.max(0, Math.ceil(deficit60m / 2.2));

      analyses60m.push({
        zone,
        demand60m,
        capacity60m,
        deficit60m,
        surplus60m,
        neededVehicles,
        peak15mDemand,
        peak15mInterval,
        availableVehicles,
        activeEvent: activeEvt ? activeEvt.name : undefined,
      });
    }

    // 2. Rank deficit and surplus zones
    let deficitZones = analyses60m
      .filter((a) => a.deficit60m > 0 || (a.activeEvent && a.availableVehicles < 10))
      .sort((a, b) => b.deficit60m - a.deficit60m);

    // Proactive event / peak horizon fallback if current window has no deficit
    if (deficitZones.length === 0) {
      deficitZones = analyses60m
        .filter((a) => a.activeEvent !== undefined || a.demand60m > a.capacity60m * 0.85)
        .sort((a, b) => b.demand60m - a.demand60m);
    }

    const surplusZones = analyses60m
      .filter((a) => a.surplus60m >= 3 && a.availableVehicles >= 5)
      .sort((a, b) => b.surplus60m - a.surplus60m);

    // Track available eligible vehicles per surplus zone (battery ≥ 20%, state AVAILABLE)
    const availablePoolByZone: Map<string, string[]> = new Map();
    for (const surplus of surplusZones) {
      const eligibleVehicles = fleetManager
        .getAvailableVehiclesInZone(surplus.zone.id)
        .filter((v) => v.batteryOrFuelLevel >= 20 && !v.assignedRecommendationId)
        .map((v) => v.id);
      availablePoolByZone.set(surplus.zone.id, eligibleVehicles);
    }

    // Build duplicate guard: check corridors already DISPATCHED within the last 15 minutes
    const nowMs = targetTime.getTime();
    const fifteenMinAgoMs = nowMs - 15 * 60 * 1000;
    const activeDispatchedPairs = new Set<string>();
    for (const r of persistentStore.getRecommendations()) {
      if (
        (r.status === 'DISPATCHED' || r.status === 'PENDING') &&
        new Date(r.createdAt).getTime() >= fifteenMinAgoMs
      ) {
        activeDispatchedPairs.add(`${r.sourceZoneId}:${r.targetZoneId}`);
      }
    }

    const generated: DriverRecommendation[] = [];

    // Match deficit zones with nearest eligible surplus zones
    for (const deficit of deficitZones) {
      if (generated.length >= maxRecommendations) break;

      let vehiclesShortage = Math.max(deficit.neededVehicles, deficit.deficit60m > 0 ? Math.ceil(deficit.deficit60m / 2.2) : 3);
      if (vehiclesShortage < 2) vehiclesShortage = 2; // Operational batch size minimum is 2

      // Rank candidate surplus zones by Haversine distance
      const candidates = surplusZones
        .map((surplus) => {
          const distKm = calculateHaversineDistance(surplus.zone.centroid, deficit.zone.centroid);
          const travelTimeMin = estimateTravelTimeMinutes(
            distKm,
            targetTime.getHours() >= 17 && targetTime.getHours() <= 20
          );
          const eligibleList = availablePoolByZone.get(surplus.zone.id) || [];
          return {
            surplus,
            distKm,
            travelTimeMin,
            eligibleList,
          };
        })
        .filter((c) => {
          return (
            c.distKm > 0 &&
            c.distKm <= 12.0 &&
            c.travelTimeMin <= 32 &&
            c.eligibleList.length >= 2 &&
            c.eligibleList.length - 2 >= 3 // Ensure leaving at least 3 vehicles in reserve
          );
        })
        .sort((a, b) => a.travelTimeMin - b.travelTimeMin);

      for (const candidate of candidates) {
        if (vehiclesShortage < 2) break;
        if (generated.length >= maxRecommendations) break;

        const corridorKey = `${candidate.surplus.zone.id}:${deficit.zone.id}`;
        if (activeDispatchedPairs.has(corridorKey)) {
          continue; // Duplicate guard: prevent re-dispatch on recently active corridor
        }

        // Safe batch allocation: leave at least 3 vehicles in source reserve, cap at 15
        const maxCanTake = Math.min(
          15,
          Math.min(
            vehiclesShortage,
            Math.max(2, candidate.eligibleList.length - 3)
          )
        );

        if (maxCanTake < 2) continue;

        // Allocate vehicles atomically from pool
        const allocatedVehicleIds = candidate.eligibleList.splice(0, maxCanTake);
        vehiclesShortage -= maxCanTake;

        // Calculate expected trips served in 60m window (2.2 trips/veh/hr)
        const expectedTrips = Math.round(maxCanTake * 2.2 * 10) / 10;

        // Priority calculation
        let priority: RecommendationPriority = 'LOW';
        if (deficit.deficit60m >= 15 || deficit.activeEvent) {
          priority = 'CRITICAL';
        } else if (deficit.deficit60m >= 8) {
          priority = 'HIGH';
        } else if (deficit.deficit60m >= 3) {
          priority = 'MEDIUM';
        }

        const reason = deficit.activeEvent
          ? `60-Min Forecast: Event surge from "${deficit.activeEvent}" creates shortage of ${deficit.deficit60m} trips/hr in ${deficit.zone.name} (peak ${deficit.peak15mDemand} trips in ${deficit.peak15mInterval}). Dispatched ${maxCanTake} surplus vehicles from ${candidate.surplus.zone.name} (${candidate.distKm} km, ~${candidate.travelTimeMin} min).`
          : `60-Min Forecast: Projected demand of ${deficit.demand60m} trips exceeds capacity (${deficit.capacity60m} trips) with ${deficit.deficit60m} trip deficit in ${deficit.zone.name}. Dispatched ${maxCanTake} vehicles from surplus zone ${candidate.surplus.zone.name}.`;

        const recId = `REC-VZ-${this.recommendationCounter++}`;
        const nowIso = targetTime.toISOString();

        const recommendation: DriverRecommendation = {
          id: recId,
          sourceZoneId: candidate.surplus.zone.id,
          sourceZoneName: candidate.surplus.zone.name,
          targetZoneId: deficit.zone.id,
          targetZoneName: deficit.zone.name,
          recommendedVehicleCount: maxCanTake,
          allocatedVehicleIds,
          priority,
          status: 'PENDING',
          autonomousDispatch: true,
          estimatedTravelDistanceKm: candidate.distKm,
          estimatedTravelTimeMin: candidate.travelTimeMin,
          expectedNetTripsServed: expectedTrips,
          confidenceScore: deficit.activeEvent ? 0.93 : 0.88,
          reason,
          supportingData: {
            sourceSurplus: candidate.surplus.surplus60m,
            targetShortage: deficit.deficit60m,
            targetDemand: deficit.demand60m,
            forecastHorizonMinutes: 60,
            peak15mDemand: deficit.peak15mDemand,
            peak15mInterval: deficit.peak15mInterval,
            effectiveCapacity: deficit.capacity60m,
            activeEvent: deficit.activeEvent,
          },
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        if (autoDispatch) {
          // Automatically dispatch recommendation without requiring manual UI approval
          const dispatchResult = fleetManager.autonomousDispatch(recommendation, nowIso);
          if (dispatchResult.success) {
            recommendation.status = 'DISPATCHED';
            recommendation.dispatchedAt = nowIso;
            recommendation.allocatedVehicleIds = dispatchResult.assignedVehicleIds;
            activeDispatchedPairs.add(corridorKey);
          } else {
            recommendation.dispatchError = dispatchResult.error;
          }
        }

        this.recommendations.set(recId, recommendation);
        persistentStore.upsertRecommendation(recommendation);
        generated.push(recommendation);
      }
    }

    return generated;
  }

  public getAllRecommendations(): DriverRecommendation[] {
    const fromStore = persistentStore.getRecommendations();
    if (fromStore.length > 0) return fromStore;
    return Array.from(this.recommendations.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getRecommendation(id: string): DriverRecommendation | undefined {
    return this.recommendations.get(id) || persistentStore.getRecommendations().find((r) => r.id === id);
  }

  /**
   * Dispatches a recommendation: assigns vehicles and marks status as DISPATCHED.
   */
  public dispatchRecommendation(id: string, fleetManager: FleetManager): boolean {
    const rec = this.getRecommendation(id);
    if (!rec || rec.status !== 'PENDING') return false;

    let successCount = 0;
    for (const vid of rec.allocatedVehicleIds) {
      if (fleetManager.dispatchReposition(vid, rec.targetZoneId, rec.id)) {
        successCount++;
      }
    }

    rec.status = 'DISPATCHED';
    rec.updatedAt = new Date().toISOString();
    this.recommendations.set(rec.id, rec);
    persistentStore.updateRecommendationStatus(rec.id, 'DISPATCHED');
    return successCount > 0;
  }

  /**
   * Completes a recommendation: relocates vehicles to target zone.
   */
  public completeRecommendation(id: string, fleetManager: FleetManager): boolean {
    const rec = this.getRecommendation(id);
    if (!rec || rec.status !== 'DISPATCHED') return false;

    fleetManager.completeRepositionToZone(rec.allocatedVehicleIds, rec.targetZoneId);
    rec.status = 'COMPLETED';
    rec.updatedAt = new Date().toISOString();
    this.recommendations.set(rec.id, rec);
    persistentStore.updateRecommendationStatus(rec.id, 'COMPLETED');
    return true;
  }

  /**
   * Cancels a recommendation and releases any EN_ROUTE vehicles back to AVAILABLE.
   */
  public cancelRecommendation(id: string): boolean {
    const rec = this.getRecommendation(id);
    if (!rec || (rec.status !== 'PENDING' && rec.status !== 'DISPATCHED')) return false;

    const nowIso = new Date().toISOString();

    // Release EN_ROUTE vehicles assigned to this recommendation
    for (const vid of rec.allocatedVehicleIds) {
      const v = persistentStore.getVehicle(vid);
      if (v && v.state === 'EN_ROUTE' && v.assignedRecommendationId === rec.id) {
        persistentStore.updateVehicle(vid, {
          state: 'AVAILABLE',
          targetZoneId: undefined,
          targetZoneName: undefined,
          assignedRecommendationId: undefined,
          movementStartedAt: undefined,
          estimatedArrivalAt: undefined,
          movementProgressPct: 0,
          lastStateChange: nowIso,
        });
      }
    }

    rec.status = 'CANCELLED';
    rec.updatedAt = nowIso;
    this.recommendations.set(rec.id, rec);
    persistentStore.updateRecommendationStatus(rec.id, 'CANCELLED');
    return true;
  }
}

export const globalRecommendationEngine = new RecommendationEngine();
