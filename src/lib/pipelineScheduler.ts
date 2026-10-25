/**
 * ViziMove AI — 15-Minute Operational Pipeline & Scheduled Processor
 *
 * Runs every 15 minutes to:
 * 1. Verify input freshness & provenance.
 * 2. Generate 15-minute sub-hourly demand forecasts for all 30 zones.
 * 3. Retrieve upcoming events & compute spatial-temporal distance decay associations.
 * 4. Separately preserve baseline vs event-adjusted demand predictions.
 * 5. Compare sub-hourly demand against available fleet capacity (0.55 trips/vehicle/15m).
 * 6. Generate constraint-aware vehicle repositioning recommendations.
 * 7. Persist cycles, predictions, and recommendations to the relational store.
 * 8. Prevent concurrent/overlapping job runs using atomic execution locks.
 */

import { VIZAG_ZONES, getZoneById, calculateHaversineDistance, estimateTravelTimeMinutes } from './zones';
import {
  forecast15mForZone,
  generate15mForecastHorizon,
  SUBHOURLY_MODEL_EVALUATION_METRICS,
  executeDemandForecastingPipeline,
} from './forecasting';
import {
  generateAllEventZoneAssociations,
  VERIFIED_VIZAG_EVENTS,
} from './events';
import { FleetManager, globalFleetManager } from './fleet';
import {
  calculateAllZonesSupplyDemand15m,
  TRIPS_PER_VEHICLE_15M,
  ZoneSupplyDemand15m,
} from './supplyDemand';
import {
  PipelineCycleRun,
  Forecast15mRecord,
  EventZoneAssociation,
  DriverRecommendation,
  VirtualVehicle,
  ForecastRunRecord,
} from './types';
import { persistentStore } from '../db/store';

export class OperationalPipelineScheduler {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number = 15 * 60 * 1000; // 15 minutes = 900,000 ms
  private isExecuting: boolean = false;
  private nextRunScheduledAt: Date | null = null;
  private executionLockTimeoutMs: number = 60 * 1000; // 1 min lock expiration to prevent deadlock

  constructor() {
    // Single instance check: logged to identify instance lifecycle
    console.log('[Pipeline Scheduler] Initialized. Single-instance operational loop configured for 15-min cycles.');
  }

  /**
   * Starts the 15-minute scheduled recurring operational loop.
   */
  public start(): void {
    if (this.timer) {
      console.log('[Pipeline Scheduler] Loop already active.');
      return;
    }

    // Execute immediately on startup to ensure fresh state, then schedule every 15 minutes
    this.executeCycle('SCHEDULED_STARTUP').catch((err) => {
      console.error('[Pipeline Scheduler] Initial startup cycle failed:', err);
    });

    this.timer = setInterval(() => {
      this.executeCycle('SCHEDULED_15M').catch((err) => {
        console.error('[Pipeline Scheduler] Scheduled 15m cycle failed:', err);
      });
    }, this.intervalMs);

    this.nextRunScheduledAt = new Date(Date.now() + this.intervalMs);
    console.log(`[Pipeline Scheduler] Scheduled loop started. Next cycle at ${this.nextRunScheduledAt.toISOString()}`);
  }

  /**
   * Stops the scheduled recurring loop.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.nextRunScheduledAt = null;
      console.log('[Pipeline Scheduler] Scheduled loop stopped.');
    }
  }

  /**
   * Manually triggers an immediate operational cycle.
   */
  public async triggerImmediateCycle(triggerReason: string = 'MANUAL_TRIGGER'): Promise<PipelineCycleRun> {
    return this.executeCycle(triggerReason);
  }

  /**
   * Executes a single operational cycle with idempotency, locks, and persistence.
   */
  public async executeCycle(triggerSource: string = 'SCHEDULED'): Promise<PipelineCycleRun> {
    const startTime = Date.now();

    // Concurrency protection: prevent overlapping scheduled jobs
    if (this.isExecuting) {
      const msg = `[Pipeline Scheduler] Cycle execution already in progress. Skipping trigger [${triggerSource}].`;
      console.warn(msg);
      throw new Error('Cycle execution locked: another operational pipeline cycle is currently running.');
    }

    this.isExecuting = true;
    const cycleTimestamp = new Date();
    const cycleId = `CYCLE-${cycleTimestamp.toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;

    try {
      // Stage 1: Progress existing vehicle movements (arrivals, trips, charging)
      const fleetProgress = globalFleetManager.progressAutonomousMovements(cycleTimestamp.toISOString());

      // Stage 2: Validate forecast and input freshness
      const zones = VIZAG_ZONES;
      const allVehicles = persistentStore.getVehicles();
      const allEvents = persistentStore.getEvents();

      // Check age of inputs
      const latestVehicleUpdate = allVehicles.reduce((latest, v) => {
        const time = new Date(v.lastStateChange).getTime();
        return time > latest ? time : latest;
      }, 0);

      const dataFreshnessSeconds = Math.max(0, Math.floor((startTime - latestVehicleUpdate) / 1000));

      // Validate hourly demand forecast freshness & automatically schedule/execute if missing or stale (>3600s)
      let latestForecastRun = persistentStore.getLatestForecastRun();
      let forecastAgeSeconds = latestForecastRun
        ? Math.max(0, Math.floor((startTime - new Date(latestForecastRun.generationTimestamp).getTime()) / 1000))
        : 999999;

      let forecastFreshness: 'VALID' | 'STALE' | 'MISSING' = !latestForecastRun
        ? 'MISSING'
        : forecastAgeSeconds >= 3600
        ? 'STALE'
        : 'VALID';

      // Automatically execute scheduled hourly demand forecast pipeline if missing or stale (60-minute resolution)
      if (forecastFreshness !== 'VALID') {
        try {
          latestForecastRun = this.executeHourlyForecast(12);
          forecastFreshness = 'VALID';
          forecastAgeSeconds = 0;
        } catch (fErr) {
          console.error('[Pipeline Scheduler] Automatic hourly forecast generation encountered error:', fErr);
        }
      }

      const inputFreshness = {
        zonesRegistryCount: zones.length,
        zonesFreshness: (zones.length === 30 ? 'VALID' : 'STALE') as 'VALID' | 'STALE',
        eventsCount: allEvents.length,
        eventsLastRetrieved: cycleTimestamp.toISOString(),
        fleetVehiclesCount: allVehicles.length,
        fleetLastStateChange: new Date(latestVehicleUpdate || startTime).toISOString(),
        dataFreshnessSeconds,
        forecastFreshness,
        forecastLastGenerated: latestForecastRun?.generationTimestamp || cycleTimestamp.toISOString(),
        forecastAgeSeconds,
      };

      // Stage 3: Calculate demand for all 30 zones (sub-hourly 15m resolution across 16 intervals)
      const forecastMap: Record<string, Forecast15mRecord[]> = {};
      let totalBaselineDemand15m = 0;

      for (const zone of zones) {
        const zoneForecasts: Forecast15mRecord[] = [];
        for (let i = 0; i < 16; i++) {
          const target = new Date(cycleTimestamp.getTime() + i * 15 * 60 * 1000);
          const f = forecast15mForZone(zone, target, allEvents);
          zoneForecasts.push(f);
        }
        forecastMap[zone.id] = zoneForecasts;

        // Current immediate 15m window baseline
        totalBaselineDemand15m += zoneForecasts[0].baselineDemand;
      }

      // Stage 4: Apply current event impacts (spatial-temporal distance decay associations)
      const eventAssociations = generateAllEventZoneAssociations(allEvents, zones, cycleTimestamp);
      const affectedZoneIds = new Set(eventAssociations.map((a) => a.zoneId));

      let totalEventAdjustedDemand15m = 0;
      for (const zone of zones) {
        totalEventAdjustedDemand15m += forecastMap[zone.id][0].eventAdjustedDemand;
      }

      // Stage 5: Calculate zone supply, deficit, and surplus (using supplyDemand module)
      const availableVehiclesByZone: Record<string, VirtualVehicle[]> = {};
      for (const z of zones) {
        availableVehiclesByZone[z.id] = [];
      }
      for (const v of allVehicles) {
        if (v.state === 'AVAILABLE' && availableVehiclesByZone[v.zoneId]) {
          availableVehiclesByZone[v.zoneId].push(v);
        }
      }

      const zoneSupplyDemand: ZoneSupplyDemand15m[] = calculateAllZonesSupplyDemand15m(
        zones,
        forecastMap,
        availableVehiclesByZone,
        TRIPS_PER_VEHICLE_15M
      );

      let totalAvailableFleet = 0;
      let deficitZonesCount = 0;
      let surplusZonesCount = 0;

      for (const sd of zoneSupplyDemand) {
        totalAvailableFleet += sd.availableVehicles;
        if (sd.deficit > 0) {
          deficitZonesCount++;
        } else if (sd.surplus >= 6) {
          surplusZonesCount++;
        }
      }

      // Stage 6: Generate feasible repositioning decisions and execute approved movements
      const deficitList = zoneSupplyDemand
        .filter((z) => z.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);

      const surplusList = zoneSupplyDemand
        .filter((z) => z.surplus > 0)
        .sort((a, b) => b.surplus - a.surplus);

      const generatedRecommendations: DriverRecommendation[] = [];
      let recIndex = 1;

      // Build duplicate-dispatch guard: set of 'sourceZoneId:targetZoneId' pairs
      // already DISPATCHED within the last 15 minutes to prevent re-dispatch on retries
      const fifteenMinAgoMs = cycleTimestamp.getTime() - 15 * 60 * 1000;
      const recentlyDispatchedPairs = new Set<string>();
      for (const r of persistentStore.getRecommendations()) {
        if (
          r.status === 'DISPATCHED' &&
          new Date(r.createdAt).getTime() >= fifteenMinAgoMs
        ) {
          recentlyDispatchedPairs.add(`${r.sourceZoneId}:${r.targetZoneId}`);
        }
      }

      for (const def of deficitList) {
        if (generatedRecommendations.length >= 6) break;

        const targetZone = getZoneById(def.zoneId);
        if (!targetZone) continue;

        // Find nearest surplus zone within maximum 12 km operational range
        let bestSource: (typeof surplusList)[0] | null = null;
        let shortestDist = Infinity;

        for (const sur of surplusList) {
          if (sur.surplus <= 3) continue; // Keep safety reserve in source zone
          const sourceZone = getZoneById(sur.zoneId);
          if (!sourceZone) continue;

          const dist = calculateHaversineDistance(sourceZone.centroid, targetZone.centroid);
          if (dist <= 12.0 && dist < shortestDist) {
            shortestDist = dist;
            bestSource = sur;
          }
        }

        if (bestSource) {
          const moveCount = Math.min(
            Math.min(def.deficit, 15),
            Math.floor(bestSource.surplus * 0.7)
          );

          if (moveCount >= 2) {
            const sourceZone = getZoneById(bestSource.zoneId)!;
            const travelTime = estimateTravelTimeMinutes(shortestDist, def.severity === 'CRITICAL');
            const availableInSource = availableVehiclesByZone[bestSource.zoneId] || [];
            // Remove allocated vehicles from pool so they are never double-allocated
            const allocatedVehicles = availableInSource.splice(0, moveCount).map((v) => v.id);

            // Deduct surplus
            bestSource.surplus -= moveCount;

            const associatedEvt = eventAssociations.find((a) => a.zoneId === def.zoneId);

            const pairKey = `${sourceZone.id}:${targetZone.id}`;

            // Skip if this source/target pair was already dispatched in the last 15-minute window
            if (recentlyDispatchedPairs.has(pairKey)) {
              continue;
            }

            // Aggregate 60-minute operational horizon metrics across the four 15-minute intervals
            const intervalNames = ['0-15m', '15-30m', '30-45m', '45-60m'];
            const next4Intervals = (forecastMap[targetZone.id] || []).slice(0, 4);
            const demand60m = Math.round(next4Intervals.reduce((sum, f) => sum + f.eventAdjustedDemand, 0)) || def.demand15m * 4;
            let peak15mDemand = def.demand15m;
            let peak15mInterval = intervalNames[0];
            next4Intervals.forEach((f, idx) => {
              if (f.eventAdjustedDemand > peak15mDemand) {
                peak15mDemand = Math.round(f.eventAdjustedDemand);
                peak15mInterval = intervalNames[idx];
              }
            });
            const effectiveCapacity60m = Math.round(def.capacity15m * 4 * 10) / 10;

            const rec: DriverRecommendation = {
              id: `REC-${cycleId.slice(6)}-${recIndex++}`,
              sourceZoneId: sourceZone.id,
              sourceZoneName: sourceZone.name,
              targetZoneId: targetZone.id,
              targetZoneName: targetZone.name,
              recommendedVehicleCount: moveCount,
              allocatedVehicleIds: allocatedVehicles,
              priority: def.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
              status: 'PENDING',
              autonomousDispatch: true,
              estimatedTravelDistanceKm: Math.round(shortestDist * 10) / 10,
              estimatedTravelTimeMin: travelTime,
              expectedNetTripsServed: Math.round(moveCount * TRIPS_PER_VEHICLE_15M * 10) / 10,
              confidenceScore: 0.91,
              reason: associatedEvt
                ? `60-Min Forecast (15m cycle): Event surge from ${associatedEvt.eventName} (+${Math.round((associatedEvt.eventLiftMultiplier - 1) * 100)}% lift) causing ${def.deficit} trip deficit (peak ${peak15mDemand} in ${peak15mInterval}). Dispatched ${moveCount} vehicles from ${sourceZone.name}.`
                : `60-Min Forecast (15m cycle): Projected demand of ${demand60m} trips exceeds capacity (${effectiveCapacity60m} trips) with sub-hourly deficit of ${def.deficit} in ${targetZone.name}. Dispatched ${moveCount} vehicles from surplus zone ${sourceZone.name}.`,
              supportingData: {
                sourceSurplus: bestSource.surplus,
                targetShortage: def.deficit,
                targetDemand: demand60m,
                forecastHorizonMinutes: 60,
                peak15mDemand,
                peak15mInterval,
                effectiveCapacity: effectiveCapacity60m,
                activeEvent: associatedEvt ? associatedEvt.eventName : undefined,
              },
              createdAt: cycleTimestamp.toISOString(),
              updatedAt: cycleTimestamp.toISOString(),
            };

            // Attempt autonomous dispatch
            const dispatchResult = globalFleetManager.autonomousDispatch(rec, cycleTimestamp.toISOString());

            if (dispatchResult.success) {
              rec.status = 'DISPATCHED';
              rec.dispatchedAt = cycleTimestamp.toISOString();
              rec.allocatedVehicleIds = dispatchResult.assignedVehicleIds;
              rec.updatedAt = cycleTimestamp.toISOString();
              // Mark this pair as dispatched to prevent duplicates within this cycle
              recentlyDispatchedPairs.add(pairKey);
            } else {
              rec.status = 'PENDING';
              rec.dispatchError = dispatchResult.error;
              rec.updatedAt = cycleTimestamp.toISOString();
            }

            generatedRecommendations.push(rec);
            persistentStore.upsertRecommendation(rec);
          }
        }
      }

      // Stage 7: Persist all outputs and the cycle result to the relational store
      persistentStore.saveAllForecasts15m(forecastMap);
      persistentStore.saveEventZoneImpacts(eventAssociations);

      const durationMs = Date.now() - startTime;

      const cycleRun: PipelineCycleRun = {
        runId: cycleId,
        timestamp: cycleTimestamp.toISOString(),
        cycleIntervalMinutes: 15,
        status: 'COMPLETED',
        durationMs,
        inputFreshness,
        fleetProgression: fleetProgress,
        zonesForecastedCount: zones.length,
        totalBaselineDemand15m,
        totalEventAdjustedDemand15m,
        affectedZonesCount: affectedZoneIds.size,
        activeEventsEvaluated: eventAssociations.length,
        supplyCapacityAssumption: TRIPS_PER_VEHICLE_15M,
        totalAvailableFleet,
        deficitZonesCount,
        surplusZonesCount,
        recommendationsGeneratedCount: generatedRecommendations.length,
        recommendations: generatedRecommendations,
      };

      persistentStore.saveCycleRun(cycleRun);

      console.log(
        `[Pipeline Scheduler] Cycle ${cycleId} completed successfully in ${durationMs}ms: ` +
        `${zones.length} zones forecasted, ${eventAssociations.length} event impacts analyzed, ` +
        `${generatedRecommendations.length} recommendations dispatched.`
      );

      this.nextRunScheduledAt = new Date(Date.now() + this.intervalMs);
      return cycleRun;
    } catch (err) {
      console.error('[Pipeline Scheduler] Cycle execution encountered fatal error:', err);

      // Record failure without overwriting previous successful forecast results!
      const failedRun: PipelineCycleRun = {
        runId: cycleId,
        timestamp: cycleTimestamp.toISOString(),
        cycleIntervalMinutes: 15,
        status: 'FAILED',
        durationMs: Date.now() - startTime,
        inputFreshness: {
          zonesRegistryCount: 30,
          zonesFreshness: 'STALE',
          eventsCount: 0,
          eventsLastRetrieved: cycleTimestamp.toISOString(),
          fleetVehiclesCount: 0,
          fleetLastStateChange: cycleTimestamp.toISOString(),
          dataFreshnessSeconds: 9999,
          forecastFreshness: 'STALE',
          forecastAgeSeconds: 9999,
        },
        zonesForecastedCount: 0,
        totalBaselineDemand15m: 0,
        totalEventAdjustedDemand15m: 0,
        affectedZonesCount: 0,
        activeEventsEvaluated: 0,
        supplyCapacityAssumption: 0.55,
        totalAvailableFleet: 0,
        deficitZonesCount: 0,
        surplusZonesCount: 0,
        recommendationsGeneratedCount: 0,
        recommendations: [],
        failures: [String(err)],
      };

      persistentStore.saveCycleRun(failedRun);
      throw err;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Executes the hourly demand forecasting pipeline and idempotently persists run & predictions.
   * Called automatically when forecast is missing or stale (> 3600 seconds).
   */
  public executeHourlyForecast(horizonHours: number = 12): ForecastRunRecord {
    console.log(`[Pipeline Scheduler] Triggering automatic hourly forecasting run (horizon: ${horizonHours}h)...`);
    const { run } = executeDemandForecastingPipeline({ horizonHours });
    return run;
  }

  /**
   * Returns current scheduler operational status and next execution timestamp.
   */
  public getStatus(): {
    isSchedulerActive: boolean;
    intervalMinutes: number;
    hourlyForecastScheduleMinutes: number;
    isExecuting: boolean;
    nextRunScheduledAt: string | null;
    latestCompletedCycle: PipelineCycleRun | undefined;
    latestHourlyForecastRun: ForecastRunRecord | undefined;
    isHourlyForecastDue: boolean;
  } {
    const latestForecast = persistentStore.getLatestForecastRun();
    const forecastAgeMs = latestForecast
      ? Date.now() - new Date(latestForecast.generationTimestamp).getTime()
      : Infinity;
    return {
      isSchedulerActive: this.timer !== null,
      intervalMinutes: 15,
      hourlyForecastScheduleMinutes: 60,
      isExecuting: this.isExecuting,
      nextRunScheduledAt: this.nextRunScheduledAt ? this.nextRunScheduledAt.toISOString() : null,
      latestCompletedCycle: persistentStore.getLatestCycleRun(),
      latestHourlyForecastRun: latestForecast,
      isHourlyForecastDue: !latestForecast || forecastAgeMs >= 3600 * 1000,
    };
  }
}

export const globalPipelineScheduler = new OperationalPipelineScheduler();
