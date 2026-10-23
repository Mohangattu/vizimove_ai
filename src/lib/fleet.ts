/**
 * Virtual Fleet Simulation & State Machine
 * Deterministic vehicle allocation, state transitions, and persistent fleet store across 30 Visakhapatnam zones.
 */

import { VirtualVehicle, VehicleState, DriverRecommendation } from './types';
import { VIZAG_ZONES, getZoneById } from './zones';
import { persistentStore } from '../db/store';

export class FleetManager {
  private fleetSize: number = 1200;

  constructor(size: number = 1200) {
    this.fleetSize = size;
  }

  public getAllVehicles(): VirtualVehicle[] {
    return persistentStore.getVehicles();
  }

  public getVehicle(id: string): VirtualVehicle | undefined {
    return persistentStore.getVehicle(id);
  }

  public getVehiclesByZone(zoneId: string): VirtualVehicle[] {
    return this.getAllVehicles().filter((v) => v.zoneId === zoneId);
  }

  public getAvailableVehiclesInZone(zoneId: string): VirtualVehicle[] {
    return this.getVehiclesByZone(zoneId).filter((v) => v.state === 'AVAILABLE');
  }

  public initializeFleet(
    policy: 'PROPORTIONAL_TO_DEMAND' | 'UNIFORM' | 'TRANSIT_HEAVY' = 'PROPORTIONAL_TO_DEMAND',
    newSize?: number
  ): void {
    const size = newSize || this.fleetSize;
    this.fleetSize = size;
    persistentStore.reallocateFleet(size, policy);
  }

  /**
   * Assigns a repositioning movement to an available vehicle with strict validation.
   * Concurrency & Conflict Prevention:
   * - Vehicle must exist and be currently AVAILABLE.
   * - Cannot reposition BUSY or OFFLINE vehicles.
   * - Destination zone must be valid and distinct from current zone.
   * - Vehicle must not already have an active assignment.
   */
  public assignRepositioning(
    vehicleId: string,
    targetZoneId: string,
    recommendationId: string,
    travelTimeMinutes: number,
    nowIso: string = new Date().toISOString()
  ): boolean {
    const vehicle = persistentStore.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.state !== 'AVAILABLE') return false;
    if (vehicle.zoneId === targetZoneId) return false; // Prevent oscillation / redundant movement
    if (vehicle.assignedRecommendationId) return false; // Prevent conflicting assignment

    const targetZone = getZoneById(targetZoneId);
    if (!targetZone) return false;

    const arrivalDate = new Date(new Date(nowIso).getTime() + travelTimeMinutes * 60 * 1000);

    return persistentStore.updateVehicle(vehicleId, {
      state: 'EN_ROUTE',
      targetZoneId,
      targetZoneName: targetZone.name,
      assignedRecommendationId: recommendationId,
      movementStartedAt: nowIso,
      estimatedArrivalAt: arrivalDate.toISOString(),
      movementProgressPct: 0,
      repositionCountToday: vehicle.repositionCountToday + 1,
      lastStateChange: nowIso,
    });
  }

  /**
   * Dispatches a specific vehicle for repositioning.
   */
  public dispatchReposition(vehicleId: string, targetZoneId: string, recommendationId: string): boolean {
    const vehicle = persistentStore.getVehicle(vehicleId);
    if (!vehicle) return false;
    if (vehicle.state !== 'AVAILABLE') return false;
    const targetZone = getZoneById(targetZoneId);
    if (!targetZone) return false;

    const nowIso = new Date().toISOString();
    return persistentStore.updateVehicle(vehicleId, {
      state: 'EN_ROUTE',
      targetZoneId,
      targetZoneName: targetZone.name,
      assignedRecommendationId: recommendationId,
      movementStartedAt: nowIso,
      estimatedArrivalAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      movementProgressPct: 0,
      repositionCountToday: vehicle.repositionCountToday + 1,
      lastStateChange: nowIso,
    });
  }

  /**
   * Autonomously dispatches vehicles for a recommendation with constraint validation and atomic rollback.
   * This is the single authoritative dispatch path for the autonomous pipeline.
   */
  public autonomousDispatch(
    rec: DriverRecommendation,
    nowIso: string = new Date().toISOString()
  ): { success: boolean; assignedVehicleIds: string[]; error?: string } {
    // 1. Duplicate guard
    if (rec.status === 'DISPATCHED' || rec.status === 'COMPLETED') {
      return { success: false, assignedVehicleIds: [], error: 'Already dispatched' };
    }

    // 2. Constraint validation (fail fast, no vehicle touched)
    if (rec.estimatedTravelDistanceKm > 12.0) {
      return {
        success: false,
        assignedVehicleIds: [],
        error: `Distance constraint violation: ${rec.estimatedTravelDistanceKm} km exceeds maximum 12.0 km`,
      };
    }
    if (rec.estimatedTravelTimeMin > 32) {
      return {
        success: false,
        assignedVehicleIds: [],
        error: `Travel time constraint violation: ${rec.estimatedTravelTimeMin} min exceeds maximum 32 min`,
      };
    }
    if (rec.recommendedVehicleCount < 2) {
      return {
        success: false,
        assignedVehicleIds: [],
        error: `Batch size constraint violation: ${rec.recommendedVehicleCount} vehicles is below minimum of 2`,
      };
    }

    // 3. Atomic vehicle selection — filter eligible vehicles from allocatedVehicleIds
    const eligible: string[] = [];
    for (const vid of rec.allocatedVehicleIds) {
      if (eligible.length >= rec.recommendedVehicleCount) break;
      const v = persistentStore.getVehicle(vid);
      if (
        v &&
        v.state === 'AVAILABLE' &&
        v.batteryOrFuelLevel >= 20 &&
        v.zoneId === rec.sourceZoneId &&
        !v.assignedRecommendationId
      ) {
        eligible.push(vid);
      }
    }

    if (eligible.length < 2) {
      return {
        success: false,
        assignedVehicleIds: [],
        error: `Insufficient eligible vehicles: only ${eligible.length} of required 2+ vehicles meet battery (≥20%), availability, and zone constraints`,
      };
    }

    // 4. Source-zone reserve check
    const allInSource = this.getAllVehicles().filter(
      (v) => v.zoneId === rec.sourceZoneId && v.state === 'AVAILABLE'
    );
    const remainingAfterRemoval = allInSource.length - eligible.length;
    if (remainingAfterRemoval < 3) {
      return {
        success: false,
        assignedVehicleIds: [],
        error: `Source zone reserve constraint: removing ${eligible.length} vehicles would leave only ${remainingAfterRemoval} available (minimum 3 required)`,
      };
    }

    // 5. Commit phase — assign each selected vehicle
    const assigned: string[] = [];
    const targetZone = getZoneById(rec.targetZoneId);
    const targetZoneName = targetZone?.name || rec.targetZoneName;
    const arrivalIso = new Date(Date.parse(nowIso) + rec.estimatedTravelTimeMin * 60000).toISOString();

    for (const vid of eligible) {
      const v = persistentStore.getVehicle(vid);
      if (!v) {
        // 6. Rollback: vehicle disappeared mid-commit
        for (const assignedVid of assigned) {
          persistentStore.updateVehicle(assignedVid, {
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
        return {
          success: false,
          assignedVehicleIds: [],
          error: `Rollback: vehicle ${vid} not found during commit phase`,
        };
      }

      const updated = persistentStore.updateVehicle(vid, {
        state: 'EN_ROUTE',
        targetZoneId: rec.targetZoneId,
        targetZoneName,
        assignedRecommendationId: rec.id,
        movementStartedAt: nowIso,
        estimatedArrivalAt: arrivalIso,
        movementProgressPct: 0,
        repositionCountToday: v.repositionCountToday + 1,
        lastStateChange: nowIso,
      });

      if (!updated) {
        // 6. Rollback on commit failure
        for (const assignedVid of assigned) {
          persistentStore.updateVehicle(assignedVid, {
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
        return {
          success: false,
          assignedVehicleIds: [],
          error: `Rollback: failed to commit vehicle ${vid} to EN_ROUTE state`,
        };
      }

      assigned.push(vid);
    }

    // 7. Success
    return { success: true, assignedVehicleIds: assigned };
  }

  /**
   * Completes a repositioning: relocates vehicles to target zone.
   */
  public completeRepositionToZone(vehicleIds: string[], targetZoneId: string): void {
    const nowIso = new Date().toISOString();
    for (const vid of vehicleIds) {
      const v = persistentStore.getVehicle(vid);
      persistentStore.updateVehicle(vid, {
        zoneId: targetZoneId,
        state: 'AVAILABLE',
        targetZoneId: undefined,
        targetZoneName: undefined,
        assignedRecommendationId: undefined,
        movementStartedAt: undefined,
        estimatedArrivalAt: undefined,
        movementProgressPct: 100,
        repositionCountToday: (v?.repositionCountToday || 0) + 1,
        lastStateChange: nowIso,
      });
    }
  }

  /**
   * Retrieves all currently active repositioning movements across the virtual fleet.
   */
  public getActiveMovements(): VirtualVehicle[] {
    return this.getAllVehicles().filter((v) => v.state === 'EN_ROUTE' && v.targetZoneId);
  }

  /**
   * Autonomous background progression engine executed on the 15-minute operational schedule.
   * - Progresses EN_ROUTE vehicles: computes progress %, verifies arrival when elapsed time >= travel duration.
   * - On verified arrival: updates vehicle.zoneId to targetZoneId, resets state to AVAILABLE, increments reposition count.
   * - Completes passenger trips for BUSY vehicles, decrements battery/fuel realistically.
   * - Handles charging transitions for low-battery vehicles.
   * - Handles expired or stale assignments safely.
   */
  public progressAutonomousMovements(nowIso: string = new Date().toISOString()): {
    arrivedCount: number;
    tripsCompletedCount: number;
    rechargedCount: number;
    activeEnRouteCount: number;
    timestamp: string;
  } {
    let arrivedCount = 0;
    let tripsCompletedCount = 0;
    let rechargedCount = 0;
    let activeEnRouteCount = 0;

    const nowMs = new Date(nowIso).getTime();
    const all = this.getAllVehicles();

    for (const vehicle of all) {
      if (vehicle.state === 'EN_ROUTE') {
        const startedMs = vehicle.movementStartedAt ? new Date(vehicle.movementStartedAt).getTime() : nowMs - 15 * 60 * 1000;
        const targetArrivalMs = vehicle.estimatedArrivalAt ? new Date(vehicle.estimatedArrivalAt).getTime() : startedMs + 15 * 60 * 1000;
        const totalDuration = Math.max(1, targetArrivalMs - startedMs);
        const elapsed = Math.max(0, nowMs - startedMs);

        if (nowMs >= targetArrivalMs || elapsed >= totalDuration) {
          // Verified arrival at destination zone!
          const destinationZoneId = vehicle.targetZoneId || vehicle.zoneId;
          const recId = vehicle.assignedRecommendationId;

          persistentStore.updateVehicle(vehicle.id, {
            zoneId: destinationZoneId,
            state: 'AVAILABLE',
            targetZoneId: undefined,
            targetZoneName: undefined,
            assignedRecommendationId: undefined,
            movementStartedAt: undefined,
            estimatedArrivalAt: undefined,
            movementProgressPct: 100,
            repositionCountToday: vehicle.repositionCountToday + 1,
            lastStateChange: nowIso,
          });

          if (recId) {
            persistentStore.updateRecommendationStatus(recId, 'COMPLETED');
          }
          arrivedCount++;
        } else {
          // In progress: update movement progress percentage
          const progressPct = Math.min(99, Math.round((elapsed / totalDuration) * 100));
          persistentStore.updateVehicle(vehicle.id, {
            movementProgressPct: progressPct,
          });
          activeEnRouteCount++;
        }
      } else if (vehicle.state === 'BUSY') {
        // Passenger trip completed in this operational cycle
        persistentStore.updateVehicle(vehicle.id, {
          state: 'AVAILABLE',
          tripsCompletedToday: vehicle.tripsCompletedToday + 1,
          batteryOrFuelLevel: Math.max(12, vehicle.batteryOrFuelLevel - 3),
          lastStateChange: nowIso,
        });
        tripsCompletedCount++;
      } else if (vehicle.state === 'OFFLINE') {
        // Charging replenishment at depot/hub
        const newCharge = Math.min(100, vehicle.batteryOrFuelLevel + 30);
        persistentStore.updateVehicle(vehicle.id, {
          batteryOrFuelLevel: newCharge,
          state: newCharge >= 80 ? 'AVAILABLE' : 'OFFLINE',
          lastStateChange: nowIso,
        });
        if (newCharge >= 80) rechargedCount++;
      } else if (vehicle.state === 'AVAILABLE' && vehicle.batteryOrFuelLevel < 20) {
        // Low charge: transition to offline charging
        persistentStore.updateVehicle(vehicle.id, {
          state: 'OFFLINE',
          lastStateChange: nowIso,
        });
      }
    }

    return {
      arrivedCount,
      tripsCompletedCount,
      rechargedCount,
      activeEnRouteCount,
      timestamp: nowIso,
    };
  }

  /**
   * Deterministic simulation step: transitions EN_ROUTE arrivals, completes BUSY passenger trips, recharges OFFLINE vehicles.
   */
  public stepSimulation(): { transitionedCount: number; timestamp: string } {
    let transitionedCount = 0;
    const nowIso = new Date().toISOString();
    const all = this.getAllVehicles();

    for (const vehicle of all) {
      if (vehicle.state === 'EN_ROUTE') {
        const destinationZoneId = vehicle.targetZoneId || vehicle.zoneId;
        const recId = vehicle.assignedRecommendationId;
        persistentStore.updateVehicle(vehicle.id, {
          zoneId: destinationZoneId,
          state: 'AVAILABLE',
          targetZoneId: undefined,
          targetZoneName: undefined,
          assignedRecommendationId: undefined,
          movementStartedAt: undefined,
          estimatedArrivalAt: undefined,
          movementProgressPct: 100,
          repositionCountToday: vehicle.repositionCountToday + 1,
        });
        if (recId) {
          persistentStore.updateRecommendationStatus(recId, 'COMPLETED');
        }
        transitionedCount++;
      } else if (vehicle.state === 'BUSY') {
        persistentStore.updateVehicle(vehicle.id, {
          state: 'AVAILABLE',
          tripsCompletedToday: vehicle.tripsCompletedToday + 1,
          batteryOrFuelLevel: Math.max(10, vehicle.batteryOrFuelLevel - 2),
        });
        transitionedCount++;
      } else if (vehicle.state === 'OFFLINE' && vehicle.batteryOrFuelLevel < 90) {
        const newLevel = Math.min(100, vehicle.batteryOrFuelLevel + 25);
        persistentStore.updateVehicle(vehicle.id, {
          batteryOrFuelLevel: newLevel,
          state: newLevel >= 80 ? 'AVAILABLE' : 'OFFLINE',
        });
        if (newLevel >= 80) transitionedCount++;
      }
    }

    return { transitionedCount, timestamp: nowIso };
  }

  public getFleetStateSummary(): {
    total: number;
    available: number;
    busy: number;
    enRoute: number;
    offline: number;
    assigned: number;
    utilizationRate: number;
  } {
    const all = this.getAllVehicles();
    const available = all.filter((v) => v.state === 'AVAILABLE').length;
    const busy = all.filter((v) => v.state === 'BUSY').length;
    const enRoute = all.filter((v) => v.state === 'EN_ROUTE').length;
    const offline = all.filter((v) => v.state === 'OFFLINE').length;
    const assigned = all.filter((v) => v.state === 'ASSIGNED').length;
    const active = available + busy + enRoute + assigned;

    const utilizationRate = active > 0 ? Math.round((busy / active) * 1000) / 10 : 0;

    return {
      total: all.length,
      available,
      busy,
      enRoute,
      offline,
      assigned,
      utilizationRate,
    };
  }
}

export const globalFleetManager = new FleetManager(1200);

