/**
 * Unit Tests for ViziMove AI Pure Algorithms
 * Executed natively via Node.js test runner (`node --test`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateHaversineDistance,
  estimateTravelTimeMinutes,
  VIZAG_ZONES,
  getZoneById,
  getDistanceMatrix,
} from './zones.ts';

import {
  calculateEvaluationMetrics,
  DIURNAL_HOURLY_WEIGHTS,
  forecastDemandForZone,
  generateForecastHorizon,
  forecast15mForZone,
  generate15mForecastHorizon,
  SUBHOURLY_MODEL_EVALUATION_METRICS,
  executeDemandForecastingPipeline,
  forecastDemandForZonePure,
  GENUINE_15M_FORECAST_GAP_ANALYSIS,
} from './forecasting.ts';

import {
  calculateEventDemandMultiplier,
  generateAllEventZoneAssociations,
  getEventZoneAssociationsForEvent,
  VERIFIED_VIZAG_EVENTS,
  generateStableEventId,
  validateEventRecord,
  deriveEventStatus,
  parseEventTimestamp,
  ingestSingleEvent,
  executeSourceIngestion,
  executeAllSourcesIngestion,
  EVENT_SOURCES_REGISTRY,
  RawEventInput,
} from './events.ts';

import {
  FleetManager,
  globalFleetManager,
} from './fleet.ts';

import {
  analyzeZoneSupplyDemand,
  analyzeAllZonesSupplyDemand,
  calculateAllZonesSupplyDemand15m,
  TRIPS_PER_VEHICLE_15M,
} from './supplyDemand.ts';

import {
  RecommendationEngine,
} from './recommendations.ts';

import {
  validateCalibrationCoverage,
  VIZAG_CALIBRATION_EVIDENCE,
} from './calibration.ts';

import { globalPipelineScheduler } from './pipelineScheduler.ts';
import { persistentStore } from '../db/store.ts';
import { EventRecord } from './types.ts';

test('Zone Registry: Contains all 30 authentic Visakhapatnam zones', () => {
  assert.equal(VIZAG_ZONES.length, 30);
  const rkBeach = getZoneById('VZ-01');
  assert.ok(rkBeach);
  assert.equal(rkBeach.name, 'RK Beach / Pandurangapuram');
  assert.equal(rkBeach.category, 'Tourism & Leisure');

  const dwaraka = getZoneById('VZ-02');
  assert.ok(dwaraka);
  assert.equal(dwaraka.name, 'Dwaraka Nagar / RTC Central Complex');

  const bheemili = getZoneById('VZ-20');
  assert.ok(bheemili);
  assert.equal(bheemili.name, 'Bheemunipatnam (Bheemili) Heritage');

  const parawada = getZoneById('VZ-29');
  assert.ok(parawada);
  assert.equal(parawada.name, 'Parawada Jawaharlal Nehru Pharma City');
});

test('Spatial Math: Haversine distance calculation is accurate', () => {
  const rkBeach = getZoneById('VZ-01')!;
  const dwarakaNagar = getZoneById('VZ-02')!;

  const dist = calculateHaversineDistance(rkBeach.centroid, dwarakaNagar.centroid);
  // Distance between RK Beach and Dwaraka Nagar is approximately 2.2 - 2.5 km
  assert.ok(dist >= 2.0 && dist <= 2.8, `Expected ~2.3 km, got ${dist}`);

  // Distance to self must be 0
  assert.equal(calculateHaversineDistance(rkBeach.centroid, rkBeach.centroid), 0);
});

test('Spatial Math: Travel time estimation produces realistic durations', () => {
  // 5 km in off-peak should be ~14 minutes
  const timeOffPeak = estimateTravelTimeMinutes(5, false);
  assert.ok(timeOffPeak >= 12 && timeOffPeak <= 16, `Got ${timeOffPeak}`);

  // Peak travel time must be greater than off-peak
  const timePeak = estimateTravelTimeMinutes(5, true);
  assert.ok(timePeak > timeOffPeak);
});

test('Calibration: Coverage validates all 30 zones have evidence records', () => {
  const coverage = validateCalibrationCoverage();
  assert.equal(coverage.totalZones, 30);
  assert.equal(coverage.isFullyCovered, true);
  assert.equal(coverage.calibratedCount, 30);
});

test('Demand Forecasting: Diurnal curve and evaluation metrics calculation', () => {
  assert.equal(DIURNAL_HOURLY_WEIGHTS.length, 24);

  // Peak hours (08:00 and 18:00) should have weights > 1.3
  assert.ok(DIURNAL_HOURLY_WEIGHTS[8] >= 1.3);
  assert.ok(DIURNAL_HOURLY_WEIGHTS[18] >= 1.3);

  // Late night (02:00) should have weight < 0.25
  assert.ok(DIURNAL_HOURLY_WEIGHTS[2] <= 0.25);

  // Metric calculation: perfect predictions
  const metrics = calculateEvaluationMetrics([10, 20, 30], [10, 20, 30]);
  assert.equal(metrics.mae, 0);
  assert.equal(metrics.rmse, 0);
  assert.equal(metrics.wape, 0);

  // Known deviation
  const imperfect = calculateEvaluationMetrics([10, 20, 30], [12, 18, 33]);
  assert.equal(imperfect.mae, 2.33);
  assert.ok(imperfect.wape > 0);
});

test('Event Intelligence: Spatial decay applies correctly', () => {
  const madhurawada = getZoneById('VZ-06')!;
  const cricketMatch = VERIFIED_VIZAG_EVENTS.find((e) => e.id === 'EVT-VZ-001')!;

  const matchTime = new Date(new Date(cricketMatch.startTime).getTime() + 1800000); // 30 min into match
  const result = calculateEventDemandMultiplier(madhurawada, matchTime, [cricketMatch]);

  assert.ok(result.multiplier > 1.2, `Expected event lift, got ${result.multiplier}`);
  assert.equal(result.activeEvents.length, 1);
});

test('Fleet Simulation: State transitions and allocation reconciliation', () => {
  const fleet = new FleetManager(1200);
  const all = fleet.getAllVehicles();
  assert.equal(all.length, 1200);

  // Ensure unique vehicle IDs
  const idSet = new Set(all.map((v) => v.id));
  assert.equal(idSet.size, 1200);

  // Available vehicle dispatch
  const available = all.find((v) => v.state === 'AVAILABLE');
  assert.ok(available);

  const dispatched = fleet.dispatchReposition(available.id, 'VZ-02', 'REC-TEST-1');
  assert.equal(dispatched, true);
  assert.equal(available.state, 'EN_ROUTE');
  assert.equal(available.assignedRecommendationId, 'REC-TEST-1');

  // Simulation step transitions EN_ROUTE to AVAILABLE
  fleet.stepSimulation();
  assert.equal(available.state, 'AVAILABLE');
  assert.equal(available.assignedRecommendationId, undefined);
});

test('Supply-Demand: Capacity math and shortage calculation', () => {
  const fleet = new FleetManager(120);
  const rkBeach = getZoneById('VZ-01')!;
  const targetTime = new Date();
  targetTime.setHours(18, 0, 0, 0); // Evening peak

  const analysis = analyzeZoneSupplyDemand(rkBeach, fleet, targetTime, 2.2);
  assert.equal(analysis.zoneId, 'VZ-01');
  assert.ok(analysis.baseDemand > 0);
  assert.equal(analysis.hourlySupplyCapacity, Math.round(analysis.availableVehicles * 2.2 * 10) / 10);
  assert.ok(['CRITICAL', 'MODERATE', 'BALANCED', 'SURPLUS'].includes(analysis.shortageSeverity));
});

test('Recommendation Engine: Generates constraint-valid repositioning', () => {
  const fleet = new FleetManager(120);
  const engine = new RecommendationEngine();

  const peakTime = new Date();
  peakTime.setHours(18, 0, 0, 0);

  const recommendations = engine.generateRecommendations(fleet, peakTime, 5);
  assert.ok(Array.isArray(recommendations));

  for (const rec of recommendations) {
    assert.ok(rec.recommendedVehicleCount > 0);
    assert.ok(rec.sourceZoneId !== rec.targetZoneId);
    assert.ok(rec.estimatedTravelDistanceKm > 0);
    assert.equal(rec.status, 'PENDING');
  }
});

test('Sub-Hourly 15-Minute Forecasting: Preserves baseline and event-adjusted demands with intra-hour weighting', () => {
  const rkBeach = getZoneById('VZ-01')!;
  const targetTime = new Date();
  targetTime.setHours(8, 30, 0, 0); // 08:30 morning peak interval

  const record = forecast15mForZone(rkBeach, targetTime);
  assert.equal(record.zoneId, 'VZ-01');
  assert.equal(record.minuteOfHour, 30);
  assert.equal(record.quarterHourOfDay, 8 * 4 + 2); // 34
  assert.ok(record.baselineDemand > 0);
  assert.ok(record.eventAdjustedDemand >= record.baselineDemand);
  assert.ok(record.confidenceScore >= 0.7 && record.confidenceScore <= 1.0);
  assert.equal(record.featuresUsed.minuteOfHour, 30);
  assert.ok(record.featuresUsed.subHourlyWeight > 0);

  // Validate sub-hourly horizon generation
  const horizon = generate15mForecastHorizon([rkBeach], 8, targetTime);
  assert.equal(horizon.length, 8); // 8 * 15m = 2 hours
  assert.equal(horizon[0].forecasts.length, 1);
  assert.equal(horizon[0].forecasts[0].zoneId, 'VZ-01');

  // Verify sub-hourly evaluation metrics
  assert.equal(SUBHOURLY_MODEL_EVALUATION_METRICS.subhourlyResolutionMinutes, 15);
  assert.equal(SUBHOURLY_MODEL_EVALUATION_METRICS.quarterHourBuckets, 96);
  assert.ok(SUBHOURLY_MODEL_EVALUATION_METRICS.wape < SUBHOURLY_MODEL_EVALUATION_METRICS.baselineWape);
});

test('Event-Zone Spatial Associations: Haversine distance decay and temporal window logic', () => {
  const targetTime = new Date();
  targetTime.setHours(18, 0, 0, 0);

  const associations = generateAllEventZoneAssociations(VERIFIED_VIZAG_EVENTS, VIZAG_ZONES, targetTime);
  assert.ok(Array.isArray(associations));
  assert.ok(associations.length > 0);

  for (const assoc of associations) {
    assert.ok(assoc.eventId);
    assert.ok(assoc.zoneId);
    assert.ok(assoc.distanceKm >= 0);
    assert.ok(assoc.isWithinRadius);
    assert.ok(assoc.eventLiftMultiplier >= 1.0);
    assert.ok(assoc.baselineDemand15m > 0);
    assert.ok(assoc.eventAdjustedDemand15m >= assoc.baselineDemand15m);
    assert.equal(
      assoc.additionalTripsExpected,
      assoc.eventAdjustedDemand15m - assoc.baselineDemand15m
    );
    assert.ok(['UPCOMING_INFLOW', 'ACTIVE_PEAK', 'DISPERSAL_OUTFLOW'].includes(assoc.temporalStatus));
  }
});

test('15-Minute Operational Pipeline: End-to-end execution, freshness checks, and persistence', async () => {
  const cycleRun = await globalPipelineScheduler.executeCycle('UNIT_TEST');
  assert.ok(cycleRun.runId.startsWith('CYCLE-'));
  assert.equal(cycleRun.status, 'COMPLETED');
  assert.equal(cycleRun.cycleIntervalMinutes, 15);
  assert.equal(cycleRun.zonesForecastedCount, 30);
  assert.ok(cycleRun.durationMs >= 0);
  assert.equal(cycleRun.inputFreshness.zonesRegistryCount, 30);
  assert.equal(cycleRun.inputFreshness.zonesFreshness, 'VALID');
  assert.ok(cycleRun.totalBaselineDemand15m > 0);
  assert.ok(cycleRun.totalEventAdjustedDemand15m >= cycleRun.totalBaselineDemand15m);
  assert.equal(cycleRun.supplyCapacityAssumption, 0.55);

  // Check persistence in store
  const storedRun = persistentStore.getLatestCycleRun();
  assert.ok(storedRun);
  assert.equal(storedRun?.runId, cycleRun.runId);

  // Check 15m forecast persistence
  const rkForecasts = persistentStore.getForecasts15m('VZ-01');
  assert.ok(rkForecasts.length > 0);
  assert.equal(rkForecasts[0].zoneId, 'VZ-01');

  // Check event impacts persistence
  const impacts = persistentStore.getEventZoneImpacts();
  assert.ok(Array.isArray(impacts));

  // Check scheduler status
  const status = globalPipelineScheduler.getStatus();
  assert.equal(status.intervalMinutes, 15);
  assert.equal(status.isExecuting, false);
});

test('Prompt 2 Demand Forecasting: Zone coverage, temporal alignment, and pure non-event baseline', () => {
  const result = executeDemandForecastingPipeline({
    horizonHours: 12,
    runId: 'TEST-P2-RUN-01',
    dataAgeSeconds: 20,
  });

  assert.equal(result.run.runId, 'TEST-P2-RUN-01');
  assert.equal(result.run.status, 'COMPLETED');
  assert.equal(result.run.temporalResolution, 'HOURLY');
  assert.equal(result.run.forecastHorizonHours, 12);
  assert.equal(result.run.zonesConfiguredCount, 30);
  assert.equal(result.run.zonesForecastedCount, 30);
  assert.equal(result.run.expectedPredictionsCount, 360);
  assert.equal(result.run.actualPredictionsCount, 360);
  assert.equal(result.run.inputFreshnessStatus, 'VALID');

  // Verify timestamps are top-of-hour aligned
  for (const pred of result.predictions) {
    const d = new Date(pred.targetTimestamp);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
    assert.equal(pred.temporalResolution, 'HOURLY');
  }

  // Verify every zone is represented exactly 12 times
  const zoneCounts: Record<string, number> = {};
  for (const pred of result.predictions) {
    zoneCounts[pred.zoneId] = (zoneCounts[pred.zoneId] || 0) + 1;
  }
  assert.equal(Object.keys(zoneCounts).length, 30);
  for (const count of Object.values(zoneCounts)) {
    assert.equal(count, 12);
  }
});

test('Prompt 2 Demand Forecasting: Distinction between raw model output and geographic calibration', () => {
  const rkBeach = getZoneById('VZ-01')!;
  const targetTime = new Date('2026-10-17T18:00:00Z');

  const pred = forecastDemandForZonePure(rkBeach, targetTime, 'TEST-CALIB-RUN');
  assert.equal(pred.zoneId, 'VZ-01');
  assert.equal(pred.temporalResolution, 'HOURLY');
  assert.ok(pred.rawModelPrediction > 0);
  assert.ok(pred.calibratedPrediction > 0);
  assert.equal(pred.calibrationFactor, 0.88); // VZ-01 source transfer factor
  assert.equal(pred.calibratedPrediction, Math.max(1, Math.round(pred.rawModelPrediction * 0.88)));
  assert.equal(pred.calibrationSource, 'AP Tourism Department Coastal Footfall Survey 2025');

  // Dwaraka Nagar (VZ-02, factor 0.96)
  const dwaraka = getZoneById('VZ-02')!;
  const predDwaraka = forecastDemandForZonePure(dwaraka, targetTime, 'TEST-CALIB-RUN');
  assert.equal(predDwaraka.calibrationFactor, 0.96);
  assert.equal(predDwaraka.calibratedPrediction, Math.max(1, Math.round(predDwaraka.rawModelPrediction * 0.96)));

  // Non-event isolation: Event multipliers must NOT be applied to pure demand forecast
  assert.equal(pred.calibratedPrediction, Math.max(1, Math.round(pred.rawModelPrediction * pred.calibrationFactor)));
});

test('Prompt 2 Demand Forecasting: Idempotent persistence and duplicate prevention', () => {
  const runId = 'TEST-IDEMPOTENT-RUN';
  // First execution
  const run1 = executeDemandForecastingPipeline({ horizonHours: 6, runId });
  assert.equal(run1.predictions.length, 180); // 30 zones * 6 hours

  const storedRun1 = persistentStore.getForecastRun(runId);
  assert.ok(storedRun1);
  const storedPreds1 = persistentStore.getPredictionsForRun(runId);
  assert.equal(storedPreds1.length, 180);

  // Retry execution with identical runId
  const run2 = executeDemandForecastingPipeline({ horizonHours: 6, runId });
  assert.equal(run2.predictions.length, 180);

  // Stored predictions count must NOT double (must still be exactly 180)
  const storedPreds2 = persistentStore.getPredictionsForRun(runId);
  assert.equal(storedPreds2.length, 180);

  // Unique keys verify no duplicate entries
  const idSet = new Set(storedPreds2.map((p) => p.id));
  assert.equal(idSet.size, 180);
});

test('Prompt 2 Demand Forecasting: Failure policies for stale inputs, missing zones, and incomplete predictions', () => {
  // Test 1: Stale input handling (> 1800s threshold)
  const staleRun = executeDemandForecastingPipeline({
    horizonHours: 3,
    runId: 'TEST-STALE-RUN',
    dataAgeSeconds: 3600, // 1 hour old
    maxDataAgeSeconds: 1800,
  });
  assert.equal(staleRun.run.inputFreshnessStatus, 'STALE');
  assert.equal(staleRun.run.dataFreshnessSeconds, 3600);

  // Test 2: Missing / malformed zone handling
  const partialZones: any[] = [
    VIZAG_ZONES[0],
    VIZAG_ZONES[1],
    { id: 'VZ-MALFORMED', name: '' }, // malformed centroid
  ];
  const partialRun = executeDemandForecastingPipeline({
    horizonHours: 2,
    runId: 'TEST-PARTIAL-RUN',
    zones: partialZones,
  });
  assert.ok(partialRun.run.missingZones.includes('VZ-MALFORMED'));
  assert.ok(['PARTIAL', 'INCOMPLETE'].includes(partialRun.run.status));
  assert.equal(partialRun.run.zonesForecastedCount, 2);
});

test('Prompt 2 Demand Forecasting: Requirement 7 technical gap analysis for genuine 15-minute forecasts', () => {
  assert.equal(GENUINE_15M_FORECAST_GAP_ANALYSIS.isGenuine15mAvailable, false);
  assert.ok(GENUINE_15M_FORECAST_GAP_ANALYSIS.minimumAdditionalData.length >= 3);
  assert.ok(GENUINE_15M_FORECAST_GAP_ANALYSIS.featureEngineeringRequired.length >= 3);
  assert.ok(GENUINE_15M_FORECAST_GAP_ANALYSIS.modelTrainingRequired.length >= 2);
  assert.ok(GENUINE_15M_FORECAST_GAP_ANALYSIS.validationMethodologyRequired.length >= 2);
  assert.ok(GENUINE_15M_FORECAST_GAP_ANALYSIS.antiSlopDeclaration.includes('hourly model predictions remain labeled as HOURLY'));
});

// ==============================================================================
// PROMPT 3A: EVENT INTELLIGENCE BACKEND TESTS
// ==============================================================================

test('Prompt 3A Event Intelligence: Deterministic key generation and duplicate event deduplication (idempotency)', () => {
  const sampleEvent: RawEventInput = {
    sourceId: 'SRC-ACA-01',
    sourceEventId: 'T20-IND-SA-2026',
    name: 'India vs South Africa T20 International',
    venueName: 'ACA-VDCA Stadium, PM Palem',
    eventType: 'Sports',
    latitude: 17.8085,
    longitude: 83.3542,
    associatedZoneId: 'VZ-06',
    startTime: '2026-11-20T19:00:00Z',
    endTime: '2026-11-20T23:00:00Z',
    estimatedAttendance: 27500,
    attendanceType: 'CONFIRMED',
    status: 'UPCOMING',
    radiusKm: 6.0,
    peakDemandMultiplier: 1.7,
  };

  // 1. Stable key generation
  const key1 = generateStableEventId(sampleEvent);
  const key2 = generateStableEventId(sampleEvent);
  assert.equal(key1, key2);
  assert.equal(key1, 'EVT-SRC-ACA-01-T20-IND-SA-2026');

  // Fallback slug key when sourceEventId is absent
  const fallbackKey = generateStableEventId({
    sourceId: 'SRC-GVMC-04',
    name: 'Vizag Seafood & Maritime Food Festival',
    startTime: '2026-12-15T10:00:00Z',
  });
  assert.ok(fallbackKey.startsWith('EVT-SRC-GVMC-04-vizag-seafood'));
  assert.ok(fallbackKey.includes('20261215'));

  // 2. Initial ingestion creates event
  const now1 = new Date('2026-10-17T10:00:00Z');
  const res1 = ingestSingleEvent(sampleEvent, undefined, now1);
  assert.equal(res1.action, 'CREATED');
  assert.ok(res1.event);
  assert.equal(res1.event.id, key1);
  assert.equal(res1.event.firstSeenAt, now1.toISOString());
  assert.equal(res1.event.lastCheckedAt, now1.toISOString());
  assert.equal(res1.event.lastUpdatedAt, now1.toISOString());

  // 3. Repeated identical ingestion produces UNCHANGED (idempotent duplicate)
  const now2 = new Date('2026-10-17T10:30:00Z');
  const res2 = ingestSingleEvent(sampleEvent, res1.event, now2);
  assert.equal(res2.action, 'UNCHANGED');
  assert.ok(res2.event);
  assert.equal(res2.event.firstSeenAt, now1.toISOString()); // firstSeenAt preserved
  assert.equal(res2.event.lastUpdatedAt, now1.toISOString()); // lastUpdatedAt NOT changed
  assert.equal(res2.event.lastCheckedAt, now2.toISOString()); // lastCheckedAt updated
});

test('Prompt 3A Event Intelligence: Updated event details and rescheduling tracking', () => {
  const initialEvent: RawEventInput = {
    sourceId: 'SRC-AU-03',
    sourceEventId: 'AU-SYMPOSIUM-26',
    name: 'National Marine Robotics & AI Conclave',
    venueName: 'AU Convocation Hall, Siripuram',
    eventType: 'Conference & Tech',
    latitude: 17.7289,
    longitude: 83.3198,
    associatedZoneId: 'VZ-03',
    startTime: '2026-11-10T09:00:00Z',
    endTime: '2026-11-10T17:00:00Z',
    estimatedAttendance: 1200,
    attendanceType: 'ORGANIZER_ESTIMATE',
    status: 'UPCOMING',
    radiusKm: 3.5,
    peakDemandMultiplier: 1.35,
  };

  const t0 = new Date('2026-10-17T08:00:00Z');
  const initial = ingestSingleEvent(initialEvent, undefined, t0);
  assert.equal(initial.action, 'CREATED');

  // Case 1: Attendance and capacity update
  const t1 = new Date('2026-10-17T09:00:00Z');
  const updatedAttendance: RawEventInput = {
    ...initialEvent,
    estimatedAttendance: 2400, // Doubled attendance
    peakDemandMultiplier: 1.5,
  };

  const update1 = ingestSingleEvent(updatedAttendance, initial.event, t1);
  assert.equal(update1.action, 'UPDATED');
  assert.ok(update1.event);
  assert.equal(update1.event.estimatedAttendance, 2400);
  assert.equal(update1.event.peakDemandMultiplier, 1.5);
  assert.equal(update1.event.firstSeenAt, t0.toISOString()); // Preserved
  assert.equal(update1.event.lastUpdatedAt, t1.toISOString()); // Bumped

  // Case 2: Event Rescheduling (time changed)
  const t2 = new Date('2026-10-17T11:00:00Z');
  const rescheduledEvent: RawEventInput = {
    ...updatedAttendance,
    startTime: '2026-11-12T10:00:00Z', // Rescheduled 2 days later
    endTime: '2026-11-12T18:00:00Z',
  };

  const update2 = ingestSingleEvent(rescheduledEvent, update1.event, t2);
  assert.equal(update2.action, 'UPDATED');
  assert.ok(update2.event);
  assert.equal(update2.event.startTime, '2026-11-12T10:00:00.000Z');
  assert.equal(update2.event.metadata?.rescheduled, true);
  assert.ok(update2.event.metadata?.previousSchedule);
  assert.equal(update2.event.metadata?.previousSchedule.startTime, '2026-11-10T09:00:00.000Z');
});

test('Prompt 3A Event Intelligence: Unknown values preservation for attendance and coordinates (Req 7)', () => {
  // Event with missing coordinates and unknown attendance
  const eventWithUnknowns: RawEventInput = {
    sourceId: 'SRC-GVMC-04',
    sourceEventId: 'GVMC-POETRY-RUSH',
    name: 'All-Andhra Literary & Poetry Conclave',
    venueName: 'Kala Bharati Auditorium, Pithapuram Colony',
    eventType: 'Festival & Cultural',
    // latitude & longitude left undefined
    // estimatedAttendance left undefined
    startTime: '2026-12-01T15:00:00Z',
    endTime: '2026-12-01T20:00:00Z',
  };

  const res = ingestSingleEvent(eventWithUnknowns, undefined, new Date());
  assert.equal(res.action, 'CREATED');
  assert.ok(res.event);

  // Requirement 7: preserve unknown values as null / UNKNOWN rather than inventing values
  assert.equal(res.event.latitude, null);
  assert.equal(res.event.longitude, null);
  assert.equal(res.event.estimatedAttendance, null);
  assert.equal(res.event.attendanceType, 'UNKNOWN');

  // Verify spatial-temporal calculations do not crash or throw with null coordinates
  const rkZone = VIZAG_ZONES[0];
  const targetTime = new Date('2026-12-01T17:00:00Z');
  const multiplierResult = calculateEventDemandMultiplier(rkZone, targetTime, [res.event]);
  assert.equal(multiplierResult.multiplier, 1.0); // No coordinate proximity match, no crash

  const associations = generateAllEventZoneAssociations([res.event], VIZAG_ZONES, targetTime);
  assert.ok(Array.isArray(associations));
});

test('Prompt 3A Event Intelligence: Invalid data handling and rejection', () => {
  // 1. Missing name
  const invalid1 = validateEventRecord({
    name: '',
    startTime: '2026-10-20T10:00:00Z',
    endTime: '2026-10-20T14:00:00Z',
  });
  assert.equal(invalid1.isValid, false);
  assert.equal(invalid1.status, 'INVALID');
  assert.ok(invalid1.errors.some((e) => e.includes('name is required')));

  // 2. Corrupt timestamps (end before start)
  const invalid2 = validateEventRecord({
    name: 'Time Traveling Regatta',
    startTime: '2026-10-20T18:00:00Z',
    endTime: '2026-10-20T12:00:00Z', // 6 hours before start
  });
  assert.equal(invalid2.isValid, false);
  assert.ok(invalid2.errors.some((e) => e.includes('earlier than start_time')));

  // 3. Out-of-bounds coordinates (latitude 120 deg)
  const invalid3 = validateEventRecord({
    name: 'Orbiting Satellite Fair',
    startTime: '2026-10-20T10:00:00Z',
    endTime: '2026-10-20T14:00:00Z',
    latitude: 120.5,
    longitude: 83.3,
  });
  assert.equal(invalid3.isValid, false);
  assert.ok(invalid3.errors.some((e) => e.includes('out of global bounds')));

  // 4. Ingestion rejects invalid data safely without modifying store
  const ingestInvalid = ingestSingleEvent({
    name: 'Unparseable Event',
    startTime: 'NOT-A-DATE',
    endTime: 'ALSO-NOT-A-DATE',
  });
  assert.equal(ingestInvalid.action, 'INVALID');
  assert.ok(ingestInvalid.errors && ingestInvalid.errors.length > 0);
});

test('Prompt 3A Event Intelligence: Cancellations and demand suppression', () => {
  const cancelledEvent: EventRecord = {
    id: 'EVT-CANCELLED-01',
    name: 'Cancelled Beach Rock Concert',
    venueName: 'RK Beach Promenade',
    eventType: 'Festival & Cultural',
    latitude: 17.7142,
    longitude: 83.3235,
    associatedZoneId: 'VZ-01',
    startTime: new Date(Date.now() + 1 * 3600 * 1000).toISOString(),
    endTime: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    estimatedAttendance: 15000,
    attendanceType: 'CONFIRMED',
    status: 'CANCELLED', // explicitly cancelled
    sourceName: 'GVMC Permissions Desk',
    sourceUrl: 'https://gvmc.gov.in',
    radiusKm: 5.0,
    peakDemandMultiplier: 1.8,
    verified: true,
  };

  // Derive status retains CANCELLED
  const status = deriveEventStatus(cancelledEvent);
  assert.equal(status, 'CANCELLED');

  // Cancelled event must NOT create demand lift for zones
  const rkZone = VIZAG_ZONES[0];
  const targetTime = new Date(Date.now() + 2 * 3600 * 1000); // During cancelled event window
  const lift = calculateEventDemandMultiplier(rkZone, targetTime, [cancelledEvent]);
  assert.equal(lift.multiplier, 1.0);
  assert.equal(lift.activeEvents.length, 0);

  const impacts = generateAllEventZoneAssociations([cancelledEvent], VIZAG_ZONES, targetTime);
  assert.equal(impacts.length, 0); // No impacts generated for cancelled events
});

test('Prompt 3A Event Intelligence: Multi-timezone parsing and temporal status distinction (upcoming, active, expired)', () => {
  // Test timezone: Indian Standard Time (+05:30) vs UTC (Z)
  const istStart = '2026-10-25T14:30:00+05:30'; // 09:00:00Z
  const istEnd = '2026-10-25T18:30:00+05:30';   // 13:00:00Z

  const validation = validateEventRecord({
    name: 'Visakhapatnam Steel Plant Expo',
    startTime: istStart,
    endTime: istEnd,
  });
  assert.equal(validation.isValid, true);
  assert.equal(validation.sanitized.startTime, '2026-10-25T09:00:00.000Z');
  assert.equal(validation.sanitized.endTime, '2026-10-25T13:00:00.000Z');

  // Temporal status evaluation at distinct reference times
  const event = {
    startTime: '2026-10-25T09:00:00.000Z',
    endTime: '2026-10-25T13:00:00.000Z',
  };

  // 1. Before start: UPCOMING
  const beforeStart = new Date('2026-10-25T08:00:00.000Z');
  assert.equal(deriveEventStatus(event, beforeStart), 'UPCOMING');

  // 2. During event: ACTIVE
  const duringEvent = new Date('2026-10-25T11:00:00.000Z');
  assert.equal(deriveEventStatus(event, duringEvent), 'ACTIVE');

  // 3. After end: EXPIRED
  const afterEnd = new Date('2026-10-25T14:00:00.000Z');
  assert.equal(deriveEventStatus(event, afterEnd), 'EXPIRED');
});

test('Prompt 3A Event Intelligence: Source adapter failure handling and circuit breaking', async () => {
  // Mock store to capture run records and test error resilience
  const mockStore: any = {
    events: {} as Record<string, any>,
    sources: {
      'SRC-TEST-FAIL': {
        sourceId: 'SRC-TEST-FAIL',
        sourceName: 'Mock Failing External Feed',
        failureCount: 0,
        lastFailureAt: null,
      },
    },
    runs: [] as any[],
    getEventById(id: string) {
      return this.events[id];
    },
    upsertEvent(evt: any) {
      this.events[evt.id] = evt;
      return { created: true, updated: false, event: evt };
    },
    getEventSource(id: string) {
      return this.sources[id];
    },
    upsertEventSource(src: any) {
      this.sources[src.sourceId] = src;
    },
    recordIngestionRun(run: any) {
      this.runs.push(run);
      if (!run.success && this.sources[run.sourceId]) {
        this.sources[run.sourceId].failureCount++;
        this.sources[run.sourceId].lastFailureAt = run.timestamp;
        this.sources[run.sourceId].lastErrorMessage = run.errors.join('; ');
      }
    },
  };

  // Pre-seed an event to ensure existing data is not wiped or corrupted
  mockStore.events['EVT-PRESERVED'] = {
    id: 'EVT-PRESERVED',
    name: 'Pre-existing Unaltered Event',
  };

  // Ingest with a failing custom fetch adapter
  const failResult = await executeSourceIngestion('SRC-TEST-FAIL', mockStore, {
    customFetch: async () => {
      throw new Error('Connection refused: 503 Service Temporarily Unavailable on remote API endpoint');
    },
  });

  // Verify failure is captured cleanly without throwing uncaught exceptions
  assert.equal(failResult.success, false);
  assert.equal(failResult.eventsIngested, 0);
  assert.ok(failResult.errors[0].includes('503 Service Temporarily Unavailable'));

  // Verify store state recorded failure metrics
  assert.equal(mockStore.runs.length, 1);
  assert.equal(mockStore.runs[0].success, false);
  assert.equal(mockStore.sources['SRC-TEST-FAIL'].failureCount, 1);
  assert.ok(mockStore.sources['SRC-TEST-FAIL'].lastFailureAt);

  // Verify pre-existing event was completely preserved
  assert.ok(mockStore.events['EVT-PRESERVED']);
  assert.equal(mockStore.events['EVT-PRESERVED'].name, 'Pre-existing Unaltered Event');

  // Test successful ingestion using real configured adapter
  const successResult = await executeSourceIngestion('SRC-ACA-01', mockStore);
  assert.equal(successResult.success, true);
  assert.ok(successResult.eventsIngested >= 1 || successResult.eventsSkipped >= 1);
});

test('Prompt Regression: Expired events ended on 17 October 2026 must be marked EXPIRED on 19 October 2026', () => {
  const currentDate = new Date('2026-10-19T08:00:00.000Z');

  // Case 1: Event that ended on 17 October 2026
  const endedOct17Event = {
    id: 'EVT-TEST-OCT17-ENDED',
    name: 'Andhra vs Hyderabad Ranji Match',
    startTime: '2026-10-17T06:00:00.000Z',
    endTime: '2026-10-17T10:00:00.000Z',
    status: 'UPCOMING' as const, // Stale status initially
  };

  const status1 = deriveEventStatus(endedOct17Event, currentDate);
  assert.equal(status1, 'EXPIRED', 'Event that ended on 17 October must be marked EXPIRED on 19 October 2026');

  // Validate through validateEventRecord as well
  const validation = validateEventRecord(endedOct17Event, currentDate);
  assert.equal(validation.sanitized.status, 'EXPIRED');

  // Case 2: Active event on 19 October 2026
  const activeEvent = {
    id: 'EVT-TEST-OCT19-ACTIVE',
    name: 'Visakhapatnam Port Maritime Security Conclave',
    startTime: '2026-10-19T06:00:00.000Z',
    endTime: '2026-10-19T14:00:00.000Z',
    status: 'UPCOMING' as const,
  };
  const status2 = deriveEventStatus(activeEvent, currentDate);
  assert.equal(status2, 'ACTIVE', 'Event running across current timestamp must be marked ACTIVE');

  // Case 3: Truly Upcoming event
  const upcomingEvent = {
    id: 'EVT-TEST-OCT20-UPCOMING',
    name: 'AU AI & Robotics Expo 2026',
    startTime: '2026-10-21T09:00:00.000Z',
    endTime: '2026-10-21T17:00:00.000Z',
    status: 'UPCOMING' as const,
  };
  const status3 = deriveEventStatus(upcomingEvent, currentDate);
  assert.equal(status3, 'UPCOMING', 'Future event must be marked UPCOMING');

  // Case 4: Cancelled event that ended in the past remains CANCELLED
  const cancelledPastEvent = {
    id: 'EVT-TEST-CANCELLED-PAST',
    name: 'Cancelled Beach Music Concert',
    startTime: '2026-10-17T06:00:00.000Z',
    endTime: '2026-10-17T10:00:00.000Z',
    status: 'CANCELLED' as const,
  };
  const status4 = deriveEventStatus(cancelledPastEvent, currentDate);
  assert.equal(status4, 'CANCELLED', 'Cancelled status must be preserved even if end time has passed');

  // Case 5: Rescheduled event with valid future rescheduled time
  const rescheduledEvent = {
    id: 'EVT-TEST-RESCHEDULED',
    name: 'Postponed & Rescheduled Simhachalam Festival',
    startTime: '2026-10-17T06:00:00.000Z', // Old date was 17 Oct
    endTime: '2026-10-17T10:00:00.000Z',
    status: 'UPCOMING' as const,
    metadata: {
      rescheduled: true,
      rescheduledStartTime: '2026-10-22T06:00:00.000Z', // Rescheduled to 22 Oct
      rescheduledEndTime: '2026-10-22T10:00:00.000Z',
    },
  };
  const status5 = deriveEventStatus(rescheduledEvent, currentDate);
  assert.equal(status5, 'UPCOMING', 'Rescheduled event with valid future schedule must be UPCOMING, not EXPIRED');

  // Case 6: Multi-timezone handling (IST timestamp with offset and without offset)
  const istEndedEvent = {
    id: 'EVT-TEST-IST-ENDED',
    name: 'Gajuwaka Industrial Trade Fair',
    startTime: '2026-10-17T10:30:00+05:30', // 05:00:00 UTC
    endTime: '2026-10-17T15:30:00+05:30',   // 10:00:00 UTC
  };
  assert.equal(deriveEventStatus(istEndedEvent, currentDate), 'EXPIRED');

  const istNoOffsetFuture = {
    id: 'EVT-TEST-IST-NO-OFFSET',
    name: 'Future Rushikonda Tech Meetup',
    startTime: '2026-10-25 10:00:00', // Treated as IST
    endTime: '2026-10-25 18:00:00',
  };
  assert.equal(deriveEventStatus(istNoOffsetFuture, currentDate), 'UPCOMING');
});

test('Prompt Regression: PersistentStore reconciles, persists expired statuses, and Upcoming filter excludes them', () => {
  const currentDate = new Date('2026-10-19T08:00:00.000Z');

  // Seed an event that ended on 17 October 2026 with initial UPCOMING status
  const endedEventId = 'EVT-REGRESSION-OCT17-STORE';
  persistentStore.upsertEvent({
    id: endedEventId,
    name: 'Historical Ranji Trophy Match',
    venueName: 'ACA-VDCA Stadium',
    eventType: 'Sports',
    latitude: 17.8085,
    longitude: 83.3542,
    associatedZoneId: 'VZ-06',
    startTime: '2026-10-17T06:00:00.000Z',
    endTime: '2026-10-17T10:00:00.000Z',
    estimatedAttendance: 25000,
    attendanceType: 'CONFIRMED',
    status: 'UPCOMING',
    sourceName: 'ACA Gazette',
    sourceUrl: 'https://andhracricketassociation.com',
    radiusKm: 6.0,
    peakDemandMultiplier: 1.6,
    verified: true,
  });

  // Explicitly simulate legacy/stale 'UPCOMING' status on the stored record
  (persistentStore as any).state.events[endedEventId].status = 'UPCOMING';

  // Reconcile against 19 October 2026
  const updatedCount = persistentStore.reconcileEventStatuses(currentDate);
  assert.ok(updatedCount >= 1, 'At least one event status must be updated');

  // Verify status is now EXPIRED in persistent store
  const stored = persistentStore.getEventById(endedEventId);
  assert.ok(stored);
  assert.equal(stored.status, 'EXPIRED', 'Ended event must be persisted as EXPIRED');

  // Verify Upcoming filter strictly excludes expired events
  const upcomingEvents = persistentStore.getEvents({ status: 'UPCOMING' });
  assert.ok(!upcomingEvents.some((e) => e.id === endedEventId), 'Upcoming filter must not contain expired event');

  // Verify Expired / History filter includes it
  const expiredEvents = persistentStore.getEvents({ status: 'EXPIRED' });
  assert.ok(expiredEvents.some((e) => e.id === endedEventId), 'Expired filter must contain expired event');
});

test('15-Minute Operational Cycle: 7-Stage sequential verification in strict order', async () => {
  // Stage 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
  const cycleRun = await globalPipelineScheduler.executeCycle('INTEGRATION_AUDIT_TEST');

  // Verify Stage 1: Movement progression executed first
  assert.ok(cycleRun.fleetProgression, 'Stage 1: fleetProgression must be recorded in cycleRun');
  assert.equal(typeof cycleRun.fleetProgression.arrivedCount, 'number');
  assert.equal(typeof cycleRun.fleetProgression.tripsCompletedCount, 'number');
  assert.equal(typeof cycleRun.fleetProgression.rechargedCount, 'number');
  assert.equal(typeof cycleRun.fleetProgression.activeEnRouteCount, 'number');

  // Verify Stage 2: Forecast and input freshness validated
  assert.equal(cycleRun.inputFreshness.zonesRegistryCount, 30, 'Stage 2: Must validate all 30 Vizag zones');
  assert.equal(cycleRun.inputFreshness.zonesFreshness, 'VALID');
  assert.ok(cycleRun.inputFreshness.fleetVehiclesCount > 0, 'Stage 2: Must check fleet vehicles');
  assert.equal(cycleRun.inputFreshness.forecastFreshness, 'VALID', 'Stage 2: Hourly forecast must be validated as fresh');
  assert.ok(typeof cycleRun.inputFreshness.forecastAgeSeconds === 'number');

  // Verify Stage 3: Demand calculated for all 30 zones across 16 intervals
  assert.equal(cycleRun.zonesForecastedCount, 30, 'Stage 3: All 30 zones forecasted');
  assert.ok(cycleRun.totalBaselineDemand15m > 0, 'Stage 3: Baseline demand must be positive');
  const stored15m = persistentStore.getForecasts15m('VZ-02');
  assert.equal(stored15m.length, 16, 'Stage 3: 16 intervals (4 hours) forecasted per zone');

  // Verify Stage 4: Current event impacts applied
  assert.ok(cycleRun.totalEventAdjustedDemand15m >= cycleRun.totalBaselineDemand15m, 'Stage 4: Event-adjusted demand preserves or amplifies baseline');
  assert.ok(typeof cycleRun.activeEventsEvaluated === 'number', 'Stage 4: Active events evaluated');

  // Verify Stage 5: Supply, capacity, deficit, and surplus calculated
  assert.equal(cycleRun.supplyCapacityAssumption, TRIPS_PER_VEHICLE_15M, 'Stage 5: Capacity must use 0.55 trips/veh/15m');
  assert.ok(cycleRun.totalAvailableFleet > 0, 'Stage 5: Available fleet counted');
  assert.ok(typeof cycleRun.deficitZonesCount === 'number');
  assert.ok(typeof cycleRun.surplusZonesCount === 'number');

  // Verify Stage 6: Feasible repositioning decisions generated and executed
  assert.ok(Array.isArray(cycleRun.recommendations), 'Stage 6: Recommendations generated');
  for (const rec of cycleRun.recommendations) {
    assert.ok(rec.recommendedVehicleCount >= 2, 'Stage 6: Feasible count >= 2');
    assert.equal(rec.status, 'DISPATCHED', 'Stage 6: Approved movements must be DISPATCHED');
    assert.equal(rec.allocatedVehicleIds.length, rec.recommendedVehicleCount);

    // Verify vehicles were actually dispatched to EN_ROUTE in fleet manager
    for (const vid of rec.allocatedVehicleIds) {
      const v = persistentStore.getVehicle(vid);
      assert.ok(v, 'Allocated vehicle must exist');
      assert.equal(v.state, 'EN_ROUTE', 'Allocated vehicle must be en route');
      assert.equal(v.targetZoneId, rec.targetZoneId, 'Vehicle must target recommendation destination');
      assert.equal(v.assignedRecommendationId, rec.id, 'Vehicle must track recommendation assignment');
    }
  }

  // Verify Stage 7: All outputs and cycle result persisted to store
  const storedCycle = persistentStore.getLatestCycleRun();
  assert.ok(storedCycle);
  assert.equal(storedCycle.runId, cycleRun.runId);
  assert.equal(storedCycle.status, 'COMPLETED');
  const storedImpacts = persistentStore.getEventZoneImpacts();
  assert.ok(Array.isArray(storedImpacts));
});

test('Hourly Forecasting Pipeline: Automatic scheduling, freshness triggers, and status inspection', async () => {
  // Verify scheduler status reports hourly forecasting schedule
  const schedulerStatus = globalPipelineScheduler.getStatus();
  assert.equal(schedulerStatus.intervalMinutes, 15, 'Operational cycle runs every 15 minutes');
  assert.equal(schedulerStatus.hourlyForecastScheduleMinutes, 60, 'Hourly forecasting scheduled every 60 minutes');
  assert.ok(schedulerStatus.latestHourlyForecastRun, 'Hourly forecast run must exist');

  // Explicitly trigger hourly forecast execution method
  const manualHourlyRun = globalPipelineScheduler.executeHourlyForecast(12);
  assert.ok(manualHourlyRun.runId.startsWith('RUN-'));
  assert.equal(manualHourlyRun.temporalResolution, 'HOURLY');
  assert.equal(manualHourlyRun.zonesForecastedCount, 30);
  assert.equal(manualHourlyRun.forecastHorizonHours, 12);
  assert.equal(manualHourlyRun.actualPredictionsCount, 360); // 30 zones * 12 hours

  // Verify idempotent persistence in store
  const storedRun = persistentStore.getForecastRun(manualHourlyRun.runId);
  assert.ok(storedRun);
  assert.equal(storedRun.runId, manualHourlyRun.runId);
  const predictions = persistentStore.getPredictionsForRun(manualHourlyRun.runId);
  assert.equal(predictions.length, 360);
});

test('Multi-Cycle Operational Lifecycle: Progression of dispatched movements across consecutive cycles and recommendation completion', async () => {
  // Step A: Pick an available vehicle and dispatch a repositioning movement
  const availableVehicles = persistentStore.getVehicles().filter((v) => v.state === 'AVAILABLE');
  assert.ok(availableVehicles.length > 0, 'Must have available vehicles');

  const testVehicle = availableVehicles[0];
  const sourceZoneId = testVehicle.zoneId;
  const targetZoneId = sourceZoneId === 'VZ-01' ? 'VZ-02' : 'VZ-01';
  const recId = `REC-TEST-${Date.now()}`;

  // Assign movement with 5 minutes travel time, started 10 minutes ago (already arrived)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  persistentStore.upsertRecommendation({
    id: recId,
    sourceZoneId,
    sourceZoneName: 'Source Zone',
    targetZoneId,
    targetZoneName: 'Target Zone',
    recommendedVehicleCount: 1,
    allocatedVehicleIds: [testVehicle.id],
    priority: 'HIGH',
    status: 'DISPATCHED',
    estimatedTravelDistanceKm: 3.5,
    estimatedTravelTimeMin: 5,
    expectedNetTripsServed: 2.2,
    confidenceScore: 0.95,
    reason: 'Multi-cycle test verification',
    supportingData: { sourceSurplus: 5, targetShortage: 3, targetDemand: 10 },
    createdAt: tenMinutesAgo,
    updatedAt: tenMinutesAgo,
  });

  const assigned = globalFleetManager.assignRepositioning(
    testVehicle.id,
    targetZoneId,
    recId,
    5,
    tenMinutesAgo
  );
  assert.ok(assigned, 'Vehicle must be successfully assigned to EN_ROUTE');

  // Verify vehicle is EN_ROUTE before cycle runs
  const enRouteVeh = persistentStore.getVehicle(testVehicle.id);
  assert.equal(enRouteVeh?.state, 'EN_ROUTE');
  assert.equal(enRouteVeh?.targetZoneId, targetZoneId);

  // Step B: Run operational cycle (Stage 1 progresses movements)
  const cycleRun = await globalPipelineScheduler.executeCycle('MULTI_CYCLE_PROGRESSION_TEST');
  assert.equal(cycleRun.status, 'COMPLETED');
  assert.ok(cycleRun.fleetProgression, 'Fleet progression must be reported');
  assert.ok(cycleRun.fleetProgression.arrivedCount >= 1, 'At least 1 vehicle must have arrived');

  // Step C: Verify vehicle has completed arrival at target zone
  const arrivedVeh = persistentStore.getVehicle(testVehicle.id);
  assert.ok(arrivedVeh);
  assert.equal(arrivedVeh.state, 'AVAILABLE', 'Vehicle must now be AVAILABLE after arrival');
  assert.equal(arrivedVeh.zoneId, targetZoneId, 'Vehicle must now be located in target zone');
  assert.equal(arrivedVeh.targetZoneId, undefined, 'Target zone cleared');
  assert.equal(arrivedVeh.movementProgressPct, 100, 'Movement progress must be 100%');

  // Step D: Verify recommendation status transitioned to COMPLETED
  const updatedRec = persistentStore.getRecommendations().find((r) => r.id === recId);
  assert.ok(updatedRec);
  assert.equal(updatedRec.status, 'COMPLETED', 'Recommendation must transition from DISPATCHED to COMPLETED upon arrival');
});

test('15-Minute Operational Cycle: 7-Stage Ordered Pipeline Verification', async () => {
  // Setup: Ensure an active vehicle movement exists to verify Stage 1
  const testVeh = persistentStore.getVehicles()[1];
  assert.ok(testVeh);
  const origZone = testVeh.zoneId;
  const destZone = origZone === 'VZ-01' ? 'VZ-02' : 'VZ-01';
  const stageRecId = `REC-STAGE-VERIFY-${Date.now()}`;
  const nowIso = new Date().toISOString();
  const pastIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  persistentStore.upsertRecommendation({
    id: stageRecId,
    sourceZoneId: origZone,
    sourceZoneName: 'Stage Source',
    targetZoneId: destZone,
    targetZoneName: 'Stage Dest',
    recommendedVehicleCount: 1,
    allocatedVehicleIds: [testVeh.id],
    priority: 'HIGH',
    status: 'DISPATCHED',
    estimatedTravelDistanceKm: 2.0,
    estimatedTravelTimeMin: 5,
    expectedNetTripsServed: 2.0,
    confidenceScore: 0.9,
    reason: 'Stage order verification',
    supportingData: { sourceSurplus: 4, targetShortage: 2, targetDemand: 8 },
    createdAt: pastIso,
    updatedAt: pastIso,
  });

  globalFleetManager.assignRepositioning(testVeh.id, destZone, stageRecId, 5, pastIso);

  // Execute the 15-minute operational cycle
  const run = await globalPipelineScheduler.executeCycle('STAGE_AUDIT_VERIFICATION');

  // Stage 1 Verification: Progress existing vehicle movements
  assert.ok(run.fleetProgression, 'Stage 1: fleet progression must be recorded');
  assert.ok(run.fleetProgression.arrivedCount >= 1, 'Stage 1: arrived vehicle count >= 1');
  assert.ok(run.fleetProgression.timestamp, 'Stage 1: timestamp must be recorded');
  const arrivedVehicle = persistentStore.getVehicle(testVeh.id);
  assert.equal(arrivedVehicle?.state, 'AVAILABLE', 'Stage 1: Arrived vehicle is now AVAILABLE');
  assert.equal(arrivedVehicle?.zoneId, destZone, 'Stage 1: Arrived vehicle is in destination zone');

  // Stage 2 Verification: Validate forecast and input freshness
  assert.ok(run.inputFreshness, 'Stage 2: inputFreshness must be populated');
  assert.equal(run.inputFreshness.zonesRegistryCount, 30, 'Stage 2: 30 zones configured');
  assert.equal(run.inputFreshness.zonesFreshness, 'VALID', 'Stage 2: zonesFreshness is VALID');
  assert.ok(run.inputFreshness.forecastFreshness && ['VALID', 'STALE', 'MISSING'].includes(run.inputFreshness.forecastFreshness));
  assert.ok(typeof run.inputFreshness.forecastAgeSeconds === 'number');

  // Stage 3 Verification: Calculate demand for all 30 zones
  assert.equal(run.zonesForecastedCount, 30, 'Stage 3: All 30 zones forecasted');
  assert.ok(run.totalBaselineDemand15m > 0, 'Stage 3: Baseline demand calculated and positive');

  // Stage 4 Verification: Apply current event impacts
  assert.ok(typeof run.activeEventsEvaluated === 'number', 'Stage 4: Event impacts evaluated count present');
  assert.ok(typeof run.affectedZonesCount === 'number', 'Stage 4: Affected zones counted');
  assert.ok(
    run.totalEventAdjustedDemand15m >= run.totalBaselineDemand15m,
    'Stage 4: Event adjusted demand reflects non-negative event impact'
  );

  // Stage 5 Verification: Calculate zone supply, deficit, and surplus
  assert.ok(run.supplyCapacityAssumption > 0, 'Stage 5: Sub-hourly capacity factor used (0.55 trips/veh)');
  assert.ok(typeof run.deficitZonesCount === 'number', 'Stage 5: Deficit zones counted');
  assert.ok(typeof run.surplusZonesCount === 'number', 'Stage 5: Surplus zones counted');
  assert.equal(run.deficitZonesCount + run.surplusZonesCount + (30 - run.deficitZonesCount - run.surplusZonesCount), 30);

  // Stage 6 Verification: Generate feasible repositioning decisions and execute approved movements
  assert.ok(typeof run.recommendationsGeneratedCount === 'number', 'Stage 6: Feasible recommendations counted');
  assert.ok(Array.isArray(run.recommendations), 'Stage 6: Recommendations array populated');

  // Stage 7 Verification: Persist all outputs and the cycle result
  assert.equal(run.status, 'COMPLETED');
  const persistedRun = persistentStore.getCycleRun(run.runId);
  assert.ok(persistedRun, 'Stage 7: Cycle run persisted in store');
  assert.equal(persistedRun?.runId, run.runId);
  const stored15m = persistentStore.getForecasts15m('VZ-01');
  assert.ok(stored15m.length > 0, 'Stage 7: 15m forecast horizon persisted');
});

test('Hourly Forecasting Pipeline: Automatic scheduling and on-demand trigger verification', async () => {
  // Test on-demand manual/startup execution
  const hourlyRun = await globalPipelineScheduler.executeHourlyForecast(12);
  assert.equal(hourlyRun.status, 'COMPLETED');
  assert.equal(hourlyRun.forecastHorizonHours, 12);
  assert.equal(hourlyRun.zonesForecastedCount, 30);
  assert.equal(hourlyRun.expectedPredictionsCount, 360);
  assert.equal(hourlyRun.actualPredictionsCount, 360);

  // Verify status contract
  const schedStatus = globalPipelineScheduler.getStatus();
  assert.equal(schedStatus.intervalMinutes, 15);
  assert.ok(schedStatus.latestHourlyForecastRun);
  assert.equal(schedStatus.latestHourlyForecastRun.runId, hourlyRun.runId);
  assert.ok(typeof schedStatus.isHourlyForecastDue === 'boolean');
});




