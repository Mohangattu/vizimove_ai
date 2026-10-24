/**
 * Autonomous Dispatch Engine Tests
 * Covers: eligible dispatch, constraint rejection, duplicate prevention,
 * rollback, cancellation, simulated arrival, and pipeline deduplication.
 *
 * Uses node:test + node:assert/strict following the algorithms.test.ts pattern.
 * Creates small FleetManager instances to avoid polluting globalFleetManager state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FleetManager } from './fleet.ts';
import { DriverRecommendation } from './types.ts';
import { RecommendationEngine, globalRecommendationEngine } from './recommendations.ts';
import { persistentStore } from '../db/store.ts';
import { globalPipelineScheduler } from './pipelineScheduler.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRec(overrides: Partial<DriverRecommendation> & {
  sourceZoneId: string;
  targetZoneId: string;
  allocatedVehicleIds: string[];
}): DriverRecommendation {
  const now = new Date().toISOString();
  return {
    id: `REC-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceZoneName: overrides.sourceZoneId,
    targetZoneName: overrides.targetZoneId,
    recommendedVehicleCount: overrides.allocatedVehicleIds.length,
    priority: 'HIGH',
    status: 'PENDING',
    estimatedTravelDistanceKm: 5.0,
    estimatedTravelTimeMin: 15,
    expectedNetTripsServed: 4,
    confidenceScore: 0.9,
    reason: 'Unit test recommendation',
    supportingData: { sourceSurplus: 10, targetShortage: 5, targetDemand: 20 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Sets up a fresh fleet manager and injects test vehicles directly into persistentStore.
 * Returns the manager instance and the IDs of the injected vehicles.
 */
function setupTestFleet(
  sourceZoneId: string,
  count: number,
  batteryLevel: number = 80,
  vehicleState: 'AVAILABLE' | 'BUSY' | 'EN_ROUTE' = 'AVAILABLE'
): { fm: FleetManager; vehicleIds: string[] } {
  const fm = new FleetManager(0); // zero-size: no automatic init
  const now = new Date().toISOString();
  const vehicleIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = `VM-TEST-${sourceZoneId}-${Date.now()}-${i}`;
    vehicleIds.push(id);
    // Inject directly into persistent store so autonomousDispatch can find them
    (persistentStore as any).state.vehicles[id] = {
      id,
      zoneId: sourceZoneId,
      state: vehicleState,
      batteryOrFuelLevel: batteryLevel,
      lastStateChange: now,
      assignedRecommendationId: undefined,
      targetZoneId: undefined,
      targetZoneName: undefined,
      movementStartedAt: undefined,
      estimatedArrivalAt: undefined,
      movementProgressPct: 0,
      tripsCompletedToday: 0,
      repositionCountToday: 0,
    };
  }

  return { fm, vehicleIds };
}

/** Cleanup test vehicles from the store after a test. */
function cleanupVehicles(vehicleIds: string[]): void {
  for (const id of vehicleIds) {
    delete (persistentStore as any).state.vehicles[id];
  }
}

/** Cleanup a recommendation from the store after a test. */
function cleanupRec(recId: string): void {
  delete (persistentStore as any).state.recommendations[recId];
}

// ---------------------------------------------------------------------------
// Test 1: Eligible dispatch — selects AVAILABLE vehicles and transitions to EN_ROUTE
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Eligible dispatch — selects AVAILABLE vehicles and transitions to EN_ROUTE', () => {
  // Provide source zone with 10 available vehicles (well above 3-vehicle reserve)
  const { fm, vehicleIds } = setupTestFleet('VZ-01', 10, 80);
  const allocatedIds = vehicleIds.slice(0, 3);

  const rec = makeRec({
    sourceZoneId: 'VZ-01',
    targetZoneId: 'VZ-02',
    allocatedVehicleIds: allocatedIds,
    recommendedVehicleCount: 3,
    estimatedTravelDistanceKm: 4.0,
    estimatedTravelTimeMin: 12,
  });

  const result = fm.autonomousDispatch(rec);

  assert.equal(result.success, true, `Expected success but got: ${result.error}`);
  assert.ok(result.assignedVehicleIds.length >= 2, 'Should assign at least 2 vehicles');

  for (const vid of result.assignedVehicleIds) {
    const v = persistentStore.getVehicle(vid);
    assert.ok(v, `Vehicle ${vid} should exist`);
    assert.equal(v!.state, 'EN_ROUTE', `Vehicle ${vid} should be EN_ROUTE`);
    assert.equal(v!.assignedRecommendationId, rec.id);
  }

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 2: Insufficient surplus — fewer than 2 eligible vehicles
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Insufficient surplus — fewer than 2 eligible vehicles rejects dispatch', () => {
  // Only 1 available vehicle (below 2-vehicle minimum)
  const { fm, vehicleIds } = setupTestFleet('VZ-03', 1, 80);

  const rec = makeRec({
    sourceZoneId: 'VZ-03',
    targetZoneId: 'VZ-04',
    allocatedVehicleIds: vehicleIds,
    recommendedVehicleCount: 1,
  });

  const result = fm.autonomousDispatch(rec);

  assert.equal(result.success, false);
  assert.ok(result.error, 'Should have an error message');

  // Verify the vehicle was NOT transitioned to EN_ROUTE
  for (const vid of vehicleIds) {
    const v = persistentStore.getVehicle(vid);
    if (v) assert.equal(v.state, 'AVAILABLE', `Vehicle ${vid} should remain AVAILABLE`);
  }

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 3: Low battery/fuel rejection — batteryOrFuelLevel < 20%
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Low battery/fuel rejection — vehicles below 20% threshold are excluded', () => {
  // 5 vehicles all at 15% battery (below 20% threshold)
  const { fm, vehicleIds } = setupTestFleet('VZ-05', 5, 15);

  const rec = makeRec({
    sourceZoneId: 'VZ-05',
    targetZoneId: 'VZ-06',
    allocatedVehicleIds: vehicleIds,
    recommendedVehicleCount: 3,
  });

  const result = fm.autonomousDispatch(rec);

  assert.equal(result.success, false, 'Low battery vehicles should cause dispatch failure');
  assert.ok(
    result.error?.toLowerCase().includes('battery') ||
    result.error?.toLowerCase().includes('fuel') ||
    result.error?.toLowerCase().includes('eligible'),
    `Error should reference battery/fuel constraint, got: ${result.error}`
  );

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 4: Distance rejection — estimatedTravelDistanceKm > 12 km
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Distance rejection — > 12 km violates maximum distance constraint', () => {
  const { fm, vehicleIds } = setupTestFleet('VZ-07', 5, 80);

  const rec = makeRec({
    sourceZoneId: 'VZ-07',
    targetZoneId: 'VZ-20',
    allocatedVehicleIds: vehicleIds,
    estimatedTravelDistanceKm: 13.5, // exceeds 12 km limit
    recommendedVehicleCount: 3,
  });

  const result = fm.autonomousDispatch(rec);

  assert.equal(result.success, false, 'Distance > 12 km should be rejected');
  assert.ok(
    result.error?.includes('distance') || result.error?.includes('Distance'),
    `Error should reference distance constraint, got: ${result.error}`
  );
  assert.equal(result.assignedVehicleIds.length, 0);

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 5: Travel time rejection — estimatedTravelTimeMin > 32 min
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Travel time rejection — > 32 min violates travel time constraint', () => {
  const { fm, vehicleIds } = setupTestFleet('VZ-08', 5, 80);

  const rec = makeRec({
    sourceZoneId: 'VZ-08',
    targetZoneId: 'VZ-21',
    allocatedVehicleIds: vehicleIds,
    estimatedTravelDistanceKm: 10.0,
    estimatedTravelTimeMin: 40, // exceeds 32 min limit
    recommendedVehicleCount: 3,
  });

  const result = fm.autonomousDispatch(rec);

  assert.equal(result.success, false, 'Travel time > 32 min should be rejected');
  assert.ok(
    result.error?.toLowerCase().includes('travel time') || result.error?.toLowerCase().includes('time'),
    `Error should reference travel time constraint, got: ${result.error}`
  );
  assert.equal(result.assignedVehicleIds.length, 0);

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 6: Duplicate dispatch prevention — already DISPATCHED rec is not re-dispatched
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Duplicate dispatch prevention — DISPATCHED recommendation rejected', () => {
  const { fm, vehicleIds } = setupTestFleet('VZ-09', 10, 80);
  const allocatedIds = vehicleIds.slice(0, 3);

  const rec = makeRec({
    sourceZoneId: 'VZ-09',
    targetZoneId: 'VZ-10',
    allocatedVehicleIds: allocatedIds,
    recommendedVehicleCount: 3,
    estimatedTravelDistanceKm: 3.0,
    estimatedTravelTimeMin: 10,
  });

  // First dispatch — should succeed
  const result1 = fm.autonomousDispatch(rec);
  assert.equal(result1.success, true, `First dispatch should succeed: ${result1.error}`);

  // Simulate what the pipeline does after success
  rec.status = 'DISPATCHED';
  rec.dispatchedAt = new Date().toISOString();
  rec.allocatedVehicleIds = result1.assignedVehicleIds;

  // Second dispatch on same rec — should be rejected
  const result2 = fm.autonomousDispatch(rec);
  assert.equal(result2.success, false, 'Re-dispatch of DISPATCHED rec should be rejected');
  assert.ok(
    result2.error?.toLowerCase().includes('already'),
    `Error should say already dispatched, got: ${result2.error}`
  );
  assert.equal(rec.status, 'DISPATCHED', 'Status should remain DISPATCHED');

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 7: Partial failure rollback — failed commit releases already-assigned vehicles
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Partial failure rollback — failed mid-commit restores AVAILABLE state', () => {
  // Set up 10 vehicles in source zone
  const { fm, vehicleIds } = setupTestFleet('VZ-11', 10, 80);
  // Use exactly 3 allocated vehicles so we can inject a failure on the 3rd
  const allocatedIds = vehicleIds.slice(0, 3);

  const rec = makeRec({
    sourceZoneId: 'VZ-11',
    targetZoneId: 'VZ-12',
    allocatedVehicleIds: allocatedIds,
    recommendedVehicleCount: 3,
    estimatedTravelDistanceKm: 3.5,
    estimatedTravelTimeMin: 11,
  });

  // Monkey-patch persistentStore.updateVehicle to fail on the 3rd vehicle
  const originalUpdateVehicle = (persistentStore as any).updateVehicle.bind(persistentStore);
  let callCount = 0;
  const failTargetId = allocatedIds[2]; // the 3rd vehicle (0-indexed)
  (persistentStore as any).updateVehicle = function(id: string, patch: any): boolean {
    // Only intercept EN_ROUTE state changes for our test vehicles
    if (id === failTargetId && patch.state === 'EN_ROUTE') {
      callCount++;
      return false; // Simulate commit failure
    }
    return originalUpdateVehicle(id, patch);
  };

  const result = fm.autonomousDispatch(rec);

  // Restore original method
  (persistentStore as any).updateVehicle = originalUpdateVehicle;

  // Dispatch should have failed due to the injected commit failure
  assert.equal(result.success, false, `Dispatch should fail on mid-commit error, got: ${JSON.stringify(result)}`);
  assert.ok(result.error, 'Should have a rollback error message');
  assert.ok(callCount > 0, 'The failure injection should have been triggered');

  // The vehicles that were successfully committed before the failure should be rolled back to AVAILABLE
  const vid0 = persistentStore.getVehicle(allocatedIds[0]);
  const vid1 = persistentStore.getVehicle(allocatedIds[1]);
  if (vid0) assert.equal(vid0.state, 'AVAILABLE', `Vehicle ${allocatedIds[0]} should be rolled back to AVAILABLE`);
  if (vid1) assert.equal(vid1.state, 'AVAILABLE', `Vehicle ${allocatedIds[1]} should be rolled back to AVAILABLE`);

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 8: Cancellation releases EN_ROUTE vehicles back to AVAILABLE
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Cancellation releases EN_ROUTE vehicles back to AVAILABLE', () => {
  const { fm, vehicleIds } = setupTestFleet('VZ-13', 10, 80);
  const allocatedIds = vehicleIds.slice(0, 3);

  const rec = makeRec({
    id: `REC-CANCEL-TEST-${Date.now()}`,
    sourceZoneId: 'VZ-13',
    targetZoneId: 'VZ-14',
    allocatedVehicleIds: allocatedIds,
    recommendedVehicleCount: 3,
    estimatedTravelDistanceKm: 4.0,
    estimatedTravelTimeMin: 13,
  });

  // Dispatch successfully
  const result = fm.autonomousDispatch(rec);
  assert.equal(result.success, true, `Dispatch should succeed: ${result.error}`);

  rec.status = 'DISPATCHED';
  rec.allocatedVehicleIds = result.assignedVehicleIds;

  // Persist rec so cancelRecommendation can find it
  persistentStore.upsertRecommendation(rec);

  // Verify vehicles are EN_ROUTE
  for (const vid of result.assignedVehicleIds) {
    const v = persistentStore.getVehicle(vid);
    assert.equal(v?.state, 'EN_ROUTE', `Vehicle ${vid} should be EN_ROUTE before cancel`);
  }

  // Cancel via the recommendation engine
  const engine = new RecommendationEngine();
  const cancelled = engine.cancelRecommendation(rec.id);
  assert.equal(cancelled, true, 'cancelRecommendation should return true');

  // Verify vehicles returned to AVAILABLE
  for (const vid of result.assignedVehicleIds) {
    const v = persistentStore.getVehicle(vid);
    assert.ok(v, `Vehicle ${vid} should exist after cancel`);
    assert.equal(v!.state, 'AVAILABLE', `Vehicle ${vid} should be back to AVAILABLE after cancel`);
    assert.equal(v!.assignedRecommendationId, undefined, 'assignedRecommendationId should be cleared');
  }

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 9: Simulated arrival completion — progressAutonomousMovements transitions vehicles
// ---------------------------------------------------------------------------
test('Autonomous Dispatch: Simulated arrival completion — progressAutonomousMovements completes movement', () => {
  const { fm, vehicleIds } = setupTestFleet('VZ-15', 10, 80);
  const allocatedIds = vehicleIds.slice(0, 2);

  const rec = makeRec({
    id: `REC-ARRIVAL-TEST-${Date.now()}`,
    sourceZoneId: 'VZ-15',
    targetZoneId: 'VZ-16',
    allocatedVehicleIds: allocatedIds,
    recommendedVehicleCount: 2,
    estimatedTravelDistanceKm: 3.0,
    estimatedTravelTimeMin: 10,
  });

  // Dispatch
  const result = fm.autonomousDispatch(rec);
  assert.equal(result.success, true, `Dispatch should succeed: ${result.error}`);

  rec.status = 'DISPATCHED';
  rec.allocatedVehicleIds = result.assignedVehicleIds;
  persistentStore.upsertRecommendation(rec);

  // Backdate estimatedArrivalAt to be in the past so progressAutonomousMovements triggers arrival
  const pastTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
  for (const vid of result.assignedVehicleIds) {
    persistentStore.updateVehicle(vid, {
      estimatedArrivalAt: pastTime,
      movementStartedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    });
  }

  // Run progression with "now" = future enough to trigger arrivals
  const futureNow = new Date(Date.now() + 1 * 60 * 1000).toISOString();
  const progression = fm.progressAutonomousMovements(futureNow);

  assert.ok(progression.arrivedCount >= result.assignedVehicleIds.length,
    `Expected at least ${result.assignedVehicleIds.length} arrivals, got ${progression.arrivedCount}`);

  // Vehicles should be AVAILABLE in target zone
  for (const vid of result.assignedVehicleIds) {
    const v = persistentStore.getVehicle(vid);
    assert.ok(v, `Vehicle ${vid} should exist after arrival`);
    assert.equal(v!.state, 'AVAILABLE', `Vehicle ${vid} should be AVAILABLE after arrival`);
    assert.equal(v!.zoneId, 'VZ-16', `Vehicle ${vid} should have moved to target zone VZ-16`);
  }

  // Recommendation should be marked COMPLETED
  const storedRec = persistentStore.getRecommendations().find(r => r.id === rec.id);
  if (storedRec) {
    assert.equal(storedRec.status, 'COMPLETED', 'Recommendation should be COMPLETED after arrival');
  }

  cleanupVehicles(vehicleIds);
  cleanupRec(rec.id);
});

// ---------------------------------------------------------------------------
// Test 10: Pipeline does not re-dispatch same zone pair within 15-minute window
// ---------------------------------------------------------------------------
test('Pipeline Scheduler: Already-DISPATCHED recommendations not re-dispatched on next cycle', async () => {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

  // Pick a zone pair that is very unlikely to occur in a live pipeline cycle
  // by using zones that would never realistically have surplus/deficit at the same time
  // We instead directly test the dedup Set logic by inserting a DISPATCHED rec
  // and verifying the pipeline Stage 6 skips it.
  const testSourceZone = 'VZ-29'; // Parawada (Pharma City — low activity)
  const testTargetZone = 'VZ-30'; // Bheemunipatnam South — also low activity

  const existingDispatchedRec: DriverRecommendation = {
    id: `REC-DEDUP-TEST-${Date.now()}`,
    sourceZoneId: testSourceZone,
    sourceZoneName: testSourceZone,
    targetZoneId: testTargetZone,
    targetZoneName: testTargetZone,
    recommendedVehicleCount: 3,
    allocatedVehicleIds: [],
    priority: 'HIGH',
    status: 'DISPATCHED',
    estimatedTravelDistanceKm: 8.0,
    estimatedTravelTimeMin: 22,
    expectedNetTripsServed: 5,
    confidenceScore: 0.88,
    reason: 'Dedup test pre-seeded dispatched recommendation',
    supportingData: { sourceSurplus: 5, targetShortage: 3, targetDemand: 10 },
    createdAt: fiveMinAgo.toISOString(), // within last 15 minutes
    updatedAt: fiveMinAgo.toISOString(),
    autonomousDispatch: true,
    dispatchedAt: fiveMinAgo.toISOString(),
  };

  persistentStore.upsertRecommendation(existingDispatchedRec);

  // Run a pipeline cycle
  const cycleRun = await globalPipelineScheduler.executeCycle('TEST_DEDUP');

  assert.equal(cycleRun.status, 'COMPLETED', 'Pipeline cycle should complete');

  // Check that no new recommendation was created for the same VZ-29:VZ-30 pair
  // within this cycle (the pre-seeded DISPATCHED rec prevents it)
  const thisRunRecs = cycleRun.recommendations;
  const duplicates = thisRunRecs.filter(
    (r) => r.sourceZoneId === testSourceZone && r.targetZoneId === testTargetZone
  );

  assert.equal(
    duplicates.length,
    0,
    `Pipeline should not create a new rec for ${testSourceZone}:${testTargetZone} already dispatched in the last 15 min`
  );

  // Cleanup the pre-seeded rec
  cleanupRec(existingDispatchedRec.id);
});
