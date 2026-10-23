/**
 * ViziMove AI — Domain Types & Data Contracts
 * Visakhapatnam Urban Mobility Operations Platform
 */

export type ZoneCategory =
  | 'Transit'
  | 'Commercial'
  | 'Transit & Commercial'
  | 'Tourism & Leisure'
  | 'Education & Culture'
  | 'High-Density Residential'
  | 'Heavy Industry & Commercial'
  | 'IT / Tech & Suburb';

export interface GeoCoordinate {
  lat: number;
  lng: number;
}

export interface ZoneRecord {
  id: string; // e.g., 'VZ-01'
  name: string;
  category: ZoneCategory;
  centroid: GeoCoordinate;
  boundary: GeoCoordinate[]; // Polygon boundary coordinates
  areaKm2: number;
  activityDensityScore: number; // 0.1 to 1.0 baseline activity weight
  commercialWeight: number;
  residentialWeight: number;
  transitWeight: number;
  tourismWeight: number;
  description: string;
}

export interface HistoricalDemandObservation {
  timestamp: string; // ISO 8601 UTC
  zoneId: string;
  pickupCount: number;
  hourOfDay: number;
  dayOfWeek: number; // 0=Sun, 6=Sat
  isWeekend: boolean;
  sourceDataset: string;
}

export interface ForecastRecord {
  zoneId: string;
  zoneName: string;
  targetHour: string; // ISO timestamp
  predictedDemand: number; // Base trips / hr
  eventAdjustedDemand: number;
  lowerConfidenceBound: number;
  upperConfidenceBound: number;
  confidenceScore: number; // 0.0 to 1.0
  featuresUsed: {
    hourOfDay: number;
    dayOfWeek: number;
    lag1h: number;
    lag24h: number;
    rollingMean7d: number;
    zoneCalibrationWeight: number;
    activeEventCount: number;
  };
}

export type TemporalResolution = 'HOURLY' | '15-MINUTE' | 'SUBHOURLY';
export type ForecastRunStatus = 'COMPLETED' | 'PARTIAL' | 'INCOMPLETE' | 'FAILED';

export interface ZoneDemandPredictionRecord {
  id: string; // Unique composite key `${runId}:${zoneId}:${targetTimestamp}`
  runId: string;
  zoneId: string;
  zoneName: string;
  targetTimestamp: string; // ISO 8601 aligned timestamp
  temporalResolution: TemporalResolution; // Actual temporal resolution of model ('HOURLY')
  rawModelPrediction: number; // Pure uncalibrated model output
  calibratedPrediction: number; // Geographically calibrated prediction for Visakhapatnam
  calibrationFactor: number; // Source transfer factor (e.g. 0.88)
  calibrationSource: string; // Local empirical evidence source
  lowerConfidenceBound: number;
  upperConfidenceBound: number;
  confidenceScore: number; // 0.0 to 1.0
  featuresUsed: {
    hourOfDay: number;
    dayOfWeek: number;
    isWeekend: boolean;
    hourFactor: number;
    dayFactor: number;
    categoryAdjustment: number;
    activityDensityScore: number;
    lag1hDemand: number;
    lag24hDemand: number;
    rollingMean7d: number;
  };
}

export interface ForecastRunRecord {
  runId: string;
  modelVersion: string; // e.g. 'v2.4.1-calibrated'
  temporalResolution: TemporalResolution; // Actual model resolution ('HOURLY')
  forecastHorizonHours: number; // e.g. 12 or 24
  generationTimestamp: string; // ISO 8601
  dataFreshnessSeconds: number;
  inputFreshnessStatus: 'VALID' | 'STALE';
  zonesConfiguredCount: number;
  zonesForecastedCount: number;
  expectedPredictionsCount: number;
  actualPredictionsCount: number;
  status: ForecastRunStatus;
  missingZones: string[];
  failures: string[];
  summary: {
    totalRawPredictedDemand: number;
    totalCalibratedPredictedDemand: number;
    avgConfidenceScore: number;
  };
  metadata: Record<string, any>;
  createdAt: string;
}

export interface Genuine15mRequirementAnalysis {
  isGenuine15mAvailable: boolean;
  currentApproach: string;
  minimumAdditionalData: string[];
  featureEngineeringRequired: string[];
  modelTrainingRequired: string[];
  validationMethodologyRequired: string[];
  antiSlopDeclaration: string;
}

export interface ModelEvaluationMetrics {
  modelName: string;
  version: string;
  trainedAt: string;
  mae: number;
  rmse: number;
  wape: number; // Weighted Absolute Percentage Error
  baselineWape: number; // Against seasonal naive
  trainingObservations: number;
  testObservations: number;
  features: string[];
}

export type EventStatus = 'UPCOMING' | 'ACTIVE' | 'CONCLUDED' | 'CANCELLED' | 'EXPIRED';
export type AttendanceType = 'CONFIRMED' | 'ORGANIZER_ESTIMATE' | 'VENUE_CAPACITY' | 'HISTORICAL_ESTIMATE' | 'UNKNOWN';
export type EventValidationStatus = 'VALIDATED' | 'PROVISIONAL' | 'INVALID' | 'FLAGGED';
export type EventCategory =
  | 'Sports'
  | 'Festival & Cultural'
  | 'Conference & Tech'
  | 'Exhibition'
  | 'Civic & Tourism'
  | 'General';

export interface EventRecord {
  id: string; // Stable deterministic event identifier
  name: string;
  venueName: string;
  eventType: EventCategory;
  latitude: number | null; // Nullable when venue coordinates unknown (Req 7)
  longitude: number | null; // Nullable when venue coordinates unknown (Req 7)
  associatedZoneId?: string | null;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  estimatedAttendance: number | null; // Nullable when attendance unknown (Req 7)
  attendanceType: AttendanceType;
  status: EventStatus;
  sourceName: string;
  sourceUrl: string;
  sourceId?: string; // Stable source registry key (e.g. 'SRC-ACA-01')
  sourceEventId?: string; // Native event ID from source provider
  radiusKm: number;
  peakDemandMultiplier: number; // Demand surge multiplier at peak (1.0 = baseline/no lift)
  verified: boolean;
  firstSeenAt?: string;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
  validationStatus?: EventValidationStatus;
  validationErrors?: string[];
  sourceFreshnessSeconds?: number;
  metadata?: Record<string, any>;
}

export interface EventSourceStatus {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  adapterType: string;
  rateLimitPerMinute: number;
  isActive: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastErrorMessage?: string | null;
  totalEventsIngested: number;
  provenanceNotes: string;
  sourceFreshnessSeconds: number;
}

export interface IngestionResult {
  sourceId: string;
  sourceName: string;
  success: boolean;
  eventsIngested: number;
  eventsUpdated: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
  timestamp: string;
}

export type VehicleState = 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'BUSY' | 'OFFLINE';

export interface VirtualVehicle {
  id: string; // e.g., 'VM-101'
  zoneId: string;
  state: VehicleState;
  batteryOrFuelLevel: number; // %
  lastStateChange: string;
  assignedRecommendationId?: string;
  targetZoneId?: string;
  targetZoneName?: string;
  movementStartedAt?: string;
  estimatedArrivalAt?: string;
  movementProgressPct?: number;
  tripsCompletedToday: number;
  repositionCountToday: number;
}

export interface SupplyDemandAnalysis {
  zoneId: string;
  zoneName: string;
  timestamp: string;
  baseDemand: number;
  eventAdjustedDemand: number;
  availableVehicles: number;
  busyVehicles: number;
  enRouteVehicles: number;
  totalFleetInZone: number;
  tripsPerVehiclePerHourAssumption: number; // Default 2.2
  hourlySupplyCapacity: number; // availableVehicles * tripsPerVehiclePerHour
  unmetDemand: number; // max(0, eventAdjustedDemand - hourlySupplyCapacity)
  excessVehicles: number; // max(0, availableVehicles - ceil(demand / tripsPerVehiclePerHour))
  demandSupplyRatio: number;
  shortageSeverity: 'CRITICAL' | 'MODERATE' | 'BALANCED' | 'SURPLUS';
}

export type RecommendationStatus = 'PENDING' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED';
export type RecommendationPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DriverRecommendation {
  id: string;
  sourceZoneId: string;
  sourceZoneName: string;
  targetZoneId: string;
  targetZoneName: string;
  recommendedVehicleCount: number;
  allocatedVehicleIds: string[];
  priority: RecommendationPriority;
  status: RecommendationStatus;
  estimatedTravelDistanceKm: number;
  estimatedTravelTimeMin: number;
  expectedNetTripsServed: number;
  confidenceScore: number;
  reason: string;
  supportingData: {
    sourceSurplus: number;
    targetShortage: number;
    targetDemand: number;
    activeEvent?: string;
  };
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when autonomous dispatch completed */
  dispatchedAt?: string;
  /** Last actionable error message if dispatch failed */
  dispatchError?: string;
  /** true = dispatched by pipeline without human approval */
  autonomousDispatch?: boolean;
}

export interface OperationsSummary {
  timestamp: string;
  activeFleetCount: number;
  availableFleetCount: number;
  busyFleetCount: number;
  fleetUtilizationRate: number; // %
  totalPredictedDemandNextHour: number;
  totalUnmetDemand: number;
  criticalDeficitZones: string[];
  topSurplusZones: string[];
  activeEventsCount: number;
  pendingRecommendationsCount: number;
  executiveBriefing: string[];
}

export interface DataSourceProvenance {
  sourceId: string;
  sourceName: string;
  category: 'Trip Records' | 'Geography & Boundaries' | 'Event Listings' | 'Fleet Configuration';
  provider: string;
  portalUrl: string;
  lastUpdated: string;
  recordCount: number;
  coverage: string;
  qualityStatus: 'VALIDATED' | 'PROVISIONAL' | 'MONITORED';
  notes: string;
}

// --- 15-MINUTE OPERATIONAL PIPELINE CONTRACTS ---

export interface Forecast15mRecord {
  zoneId: string;
  zoneName: string;
  targetInterval: string; // ISO timestamp for the 15-minute window
  quarterHourOfDay: number; // 0 to 95
  minuteOfHour: number; // 0, 15, 30, 45
  baselineDemand: number; // Trips in this 15-minute interval (unadjusted)
  eventAdjustedDemand: number; // Trips in this 15-minute interval with event lift
  lowerConfidenceBound: number;
  upperConfidenceBound: number;
  confidenceScore: number;
  featuresUsed: {
    quarterHourOfDay: number;
    minuteOfHour: number;
    subHourlyWeight: number;
    hourlyBaseDemand: number;
    activeEventCount: number;
    eventLiftMultiplier: number;
  };
}

export interface SubhourlyModelEvaluationMetrics extends ModelEvaluationMetrics {
  subhourlyResolutionMinutes: number; // 15
  quarterHourBuckets: number; // 96
  intraHourR2: number;
}

export interface EventZoneAssociation {
  eventId: string;
  eventName: string;
  eventType: string;
  zoneId: string;
  zoneName: string;
  distanceKm: number;
  travelTimeMin: number;
  radiusKm: number;
  isWithinRadius: boolean;
  temporalStatus: 'UPCOMING_INFLOW' | 'ACTIVE_PEAK' | 'DISPERSAL_OUTFLOW' | 'INACTIVE';
  baselineDemand15m: number;
  eventLiftMultiplier: number;
  eventAdjustedDemand15m: number;
  additionalTripsExpected: number;
  documentationMethod: string;
}

export interface PipelineCycleRun {
  runId: string;
  timestamp: string;
  cycleIntervalMinutes: number; // 15
  status: 'COMPLETED' | 'FAILED' | 'RUNNING';
  durationMs: number;
  inputFreshness: {
    zonesRegistryCount: number;
    zonesFreshness: 'VALID' | 'STALE';
    eventsCount: number;
    eventsLastRetrieved: string;
    fleetVehiclesCount: number;
    fleetLastStateChange: string;
    dataFreshnessSeconds: number;
    forecastFreshness?: 'VALID' | 'STALE' | 'MISSING';
    forecastLastGenerated?: string;
    forecastAgeSeconds?: number;
  };
  fleetProgression?: {
    arrivedCount: number;
    tripsCompletedCount: number;
    rechargedCount: number;
    activeEnRouteCount: number;
    timestamp: string;
  };
  zonesForecastedCount: number;
  totalBaselineDemand15m: number;
  totalEventAdjustedDemand15m: number;
  affectedZonesCount: number;
  activeEventsEvaluated: number;
  supplyCapacityAssumption: number; // e.g. 0.55 trips/vehicle in 15 mins
  totalAvailableFleet: number;
  deficitZonesCount: number;
  surplusZonesCount: number;
  recommendationsGeneratedCount: number;
  recommendations: DriverRecommendation[];
  failures?: string[];
}

