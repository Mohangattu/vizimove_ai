/**
 * Driver Recommendation Engine
 * Constraint-aware, evidence-backed repositioning optimization and audit logging.
 */

import { DriverRecommendation, RecommendationPriority, RecommendationStatus } from './types';
import { VIZAG_ZONES, calculateHaversineDistance, estimateTravelTimeMinutes, getZoneById } from './zones';
import { FleetManager } from './fleet';
import { analyzeAllZonesSupplyDemand, getSupplyDemandRankings } from './supplyDemand';
import { getEventsForZone } from './events';
import { persistentStore } from '../db/store';

export class RecommendationEngine {
  private recommendations: Map<string, DriverRecommendation> = new Map();
  private recommendationCounter: number = 501;

  constructor() {}

  /**
   * Generates optimal repositioning recommendations based on current supply-demand state.
   */
  public generateRecommendations(
    fleetManager: FleetManager,
    targetTime: Date = new Date(),
    maxRecommendations: number = 6
  ): DriverRecommendation[] {
    const analyses = analyzeAllZonesSupplyDemand(fleetManager, targetTime);
    const { deficitZones, surplusZones } = getSupplyDemandRankings(analyses);

    const generated: DriverRecommendation[] = [];

    // Track available vehicles per surplus zone that haven't been allocated yet
    const availablePoolByZone: Map<string, string[]> = new Map();
    for (const surplus of surplusZones) {
      const availableVehicles = fleetManager
        .getAvailableVehiclesInZone(surplus.zoneId)
        .map((v) => v.id);
      availablePoolByZone.set(surplus.zoneId, availableVehicles);
    }

    let targetsToEvaluate = deficitZones;

    // If no immediate deficit at current off-peak snapshot, evaluate proactive upcoming horizon (targetTime + 2h or event zones)
    if (targetsToEvaluate.length === 0) {
      const peakTargetTime = new Date(targetTime.getTime() + 2 * 3600 * 1000);
      const horizonAnalyses = analyzeAllZonesSupplyDemand(fleetManager, peakTargetTime);
      const horizonDeficits = getSupplyDemandRankings(horizonAnalyses).deficitZones;

      if (horizonDeficits.length > 0) {
        targetsToEvaluate = horizonDeficits;
      } else {
        // Evaluate event host zones needing proactive staging
        const eventDeficits = analyses
          .filter((a) => {
            const evts = getEventsForZone(a.zoneId);
            return evts.some((e) => e.status === 'ACTIVE' || e.status === 'UPCOMING');
          })
          .sort((a, b) => b.eventAdjustedDemand - a.eventAdjustedDemand);
        targetsToEvaluate = eventDeficits;
      }
    }

    // Match each deficit or event zone with nearest eligible surplus zones
    for (const deficit of targetsToEvaluate) {
      if (generated.length >= maxRecommendations) break;

      const targetZone = getZoneById(deficit.zoneId);
      if (!targetZone) continue;

      let remainingShortageVehicles = deficit.unmetDemand > 0 ? Math.ceil(deficit.unmetDemand / 2.2) : 3;
      if (remainingShortageVehicles <= 0) continue;

      // Check for active events in target zone
      const zoneEvents = getEventsForZone(deficit.zoneId);
      const activeEvent = zoneEvents.find((e) => e.status === 'ACTIVE' || e.status === 'UPCOMING');

      // Rank potential surplus sources by travel distance
      const candidates = surplusZones
        .map((surplus) => {
          const sourceZone = getZoneById(surplus.zoneId)!;
          const distKm = calculateHaversineDistance(sourceZone.centroid, targetZone.centroid);
          const travelTimeMin = estimateTravelTimeMinutes(distKm, targetTime.getHours() >= 17 && targetTime.getHours() <= 20);
          const availableList = availablePoolByZone.get(surplus.zoneId) || [];
          return {
            surplus,
            sourceZone,
            distKm,
            travelTimeMin,
            availableList,
          };
        })
        .filter((c) => c.distKm > 0 && c.travelTimeMin <= 32 && c.availableList.length > 0)
        .sort((a, b) => a.travelTimeMin - b.travelTimeMin);

      for (const candidate of candidates) {
        if (remainingShortageVehicles <= 0) break;
        if (generated.length >= maxRecommendations) break;

        const maxCanTake = Math.min(
          remainingShortageVehicles,
          Math.min(candidate.availableList.length, candidate.surplus.excessVehicles || 2)
        );

        if (maxCanTake <= 0) continue;

        // Take the vehicles from the pool
        const allocatedVehicleIds = candidate.availableList.splice(0, maxCanTake);
        remainingShortageVehicles -= maxCanTake;

        // Calculate expected operational benefit (trips served)
        const expectedTrips = Math.round(maxCanTake * 2.2 * 10) / 10;

        // Priority calculation
        let priority: RecommendationPriority = 'LOW';
        if (deficit.unmetDemand >= 15 || activeEvent) {
          priority = 'CRITICAL';
        } else if (deficit.unmetDemand >= 8) {
          priority = 'HIGH';
        } else if (deficit.unmetDemand >= 4) {
          priority = 'MEDIUM';
        }

        const reason = activeEvent
          ? `Event surge from "${activeEvent.name}" creates estimated shortage of ${deficit.unmetDemand} trips/hr in ${targetZone.name}. Reposition ${maxCanTake} idle vehicles from ${candidate.sourceZone.name} (${candidate.distKm} km, ~${candidate.travelTimeMin} min).`
          : `High demand peak creates shortage of ${deficit.unmetDemand} trips/hr in ${targetZone.name}. Surplus of ${candidate.surplus.excessVehicles} idle vehicles available in ${candidate.sourceZone.name}.`;

        const recId = `REC-VZ-${this.recommendationCounter++}`;
        const nowIso = new Date().toISOString();

        const recommendation: DriverRecommendation = {
          id: recId,
          sourceZoneId: candidate.sourceZone.id,
          sourceZoneName: candidate.sourceZone.name,
          targetZoneId: targetZone.id,
          targetZoneName: targetZone.name,
          recommendedVehicleCount: maxCanTake,
          allocatedVehicleIds,
          priority,
          status: 'PENDING',
          estimatedTravelDistanceKm: candidate.distKm,
          estimatedTravelTimeMin: candidate.travelTimeMin,
          expectedNetTripsServed: expectedTrips,
          confidenceScore: activeEvent ? 0.92 : 0.86,
          reason,
          supportingData: {
            sourceSurplus: candidate.surplus.excessVehicles,
            targetShortage: deficit.unmetDemand,
            targetDemand: deficit.eventAdjustedDemand,
            activeEvent: activeEvent ? activeEvent.name : undefined,
          },
          createdAt: nowIso,
          updatedAt: nowIso,
        };

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
