-- ViziMove AI — PostgreSQL Relational Schema
-- Visakhapatnam Metropolitan Mobility Operations Platform

CREATE TABLE IF NOT EXISTS zones (
  id VARCHAR(10) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(50) NOT NULL,
  centroid_lat NUMERIC(8, 4) NOT NULL,
  centroid_lng NUMERIC(8, 4) NOT NULL,
  boundary_geojson JSONB NOT NULL,
  area_km2 NUMERIC(6, 2) NOT NULL,
  activity_density_score NUMERIC(4, 2) NOT NULL,
  commercial_weight NUMERIC(4, 2) NOT NULL,
  residential_weight NUMERIC(4, 2) NOT NULL,
  transit_weight NUMERIC(4, 2) NOT NULL,
  tourism_weight NUMERIC(4, 2) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_zones_category ON zones(category);

-- Event Sources Registry: Configured, Documented Ingestion Providers
CREATE TABLE IF NOT EXISTS event_sources (
  source_id VARCHAR(50) PRIMARY KEY,
  source_name VARCHAR(255) NOT NULL,
  source_url TEXT NOT NULL,
  adapter_type VARCHAR(100) NOT NULL,
  rate_limit_per_minute INTEGER DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  last_error_message TEXT,
  total_events_ingested INTEGER DEFAULT 0,
  provenance_notes TEXT,
  source_freshness_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  venue_name VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  latitude NUMERIC(8, 4), -- Nullable when venue coordinates unknown (Req 7)
  longitude NUMERIC(8, 4), -- Nullable when venue coordinates unknown (Req 7)
  associated_zone_id VARCHAR(10) REFERENCES zones(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  estimated_attendance INTEGER, -- Nullable when attendance unknown (Req 7)
  attendance_type VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  status VARCHAR(20) NOT NULL CHECK (status IN ('UPCOMING', 'ACTIVE', 'CONCLUDED', 'CANCELLED', 'EXPIRED')),
  source_name VARCHAR(150) NOT NULL,
  source_url TEXT NOT NULL,
  source_id VARCHAR(50) REFERENCES event_sources(source_id),
  source_event_id VARCHAR(100),
  radius_km NUMERIC(5, 2) NOT NULL DEFAULT 4.0,
  peak_demand_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.3,
  verified BOOLEAN DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  validation_status VARCHAR(20) NOT NULL DEFAULT 'VALIDATED' CHECK (validation_status IN ('VALIDATED', 'PROVISIONAL', 'INVALID', 'FLAGGED')),
  validation_errors JSONB DEFAULT '[]'::jsonb,
  source_freshness_seconds INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_zone ON events(associated_zone_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_time);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_id);
CREATE INDEX IF NOT EXISTS idx_events_source_evt ON events(source_id, source_event_id);
CREATE INDEX IF NOT EXISTS idx_events_validation ON events(validation_status);

-- Event Ingestion Runs: Audit Log of Ingestion Batches & Circuit-Breaker State
CREATE TABLE IF NOT EXISTS event_ingestion_runs (
  run_id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(50) REFERENCES event_sources(source_id),
  source_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
  events_ingested INTEGER DEFAULT 0,
  events_updated INTEGER DEFAULT 0,
  events_skipped INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  duration_ms INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON event_ingestion_runs(source_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_time ON event_ingestion_runs(timestamp DESC);

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id VARCHAR(20) PRIMARY KEY,
  zone_id VARCHAR(10) REFERENCES zones(id),
  state VARCHAR(20) NOT NULL CHECK (state IN ('AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'BUSY', 'OFFLINE')),
  battery_or_fuel_level INTEGER NOT NULL CHECK (battery_or_fuel_level BETWEEN 0 AND 100),
  last_state_change TIMESTAMPTZ NOT NULL,
  trips_completed_today INTEGER DEFAULT 0,
  reposition_count_today INTEGER DEFAULT 0,
  assigned_recommendation_id VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fleet_zone ON fleet_vehicles(zone_id);
CREATE INDEX IF NOT EXISTS idx_fleet_state ON fleet_vehicles(state);

CREATE TABLE IF NOT EXISTS demand_forecasts (
  id SERIAL PRIMARY KEY,
  zone_id VARCHAR(10) REFERENCES zones(id),
  target_hour TIMESTAMPTZ NOT NULL,
  predicted_demand NUMERIC(8, 2) NOT NULL,
  event_adjusted_demand NUMERIC(8, 2) NOT NULL,
  lower_confidence_bound NUMERIC(8, 2) NOT NULL,
  upper_confidence_bound NUMERIC(8, 2) NOT NULL,
  confidence_score NUMERIC(4, 2) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_forecasts_zone_hour ON demand_forecasts(zone_id, target_hour);

-- Forecast Runs: Idempotent Execution Metadata & State Tracking
CREATE TABLE IF NOT EXISTS forecast_runs (
  run_id VARCHAR(64) PRIMARY KEY,
  model_version VARCHAR(50) NOT NULL,
  temporal_resolution VARCHAR(20) NOT NULL CHECK (temporal_resolution IN ('HOURLY', '15-MINUTE', 'SUBHOURLY')),
  forecast_horizon_hours INTEGER NOT NULL,
  generation_timestamp TIMESTAMPTZ NOT NULL,
  data_freshness_seconds INTEGER NOT NULL,
  input_freshness_status VARCHAR(20) NOT NULL DEFAULT 'VALID',
  zones_configured_count INTEGER NOT NULL,
  zones_forecasted_count INTEGER NOT NULL,
  expected_predictions_count INTEGER NOT NULL,
  actual_predictions_count INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('COMPLETED', 'PARTIAL', 'INCOMPLETE', 'FAILED')),
  missing_zones JSONB DEFAULT '[]'::jsonb,
  failures JSONB DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_gen ON forecast_runs(generation_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_runs_status ON forecast_runs(status);

-- Zone Demand Predictions: Distinguishing Raw vs Geographically Calibrated Predictions
CREATE TABLE IF NOT EXISTS zone_demand_predictions (
  id VARCHAR(120) PRIMARY KEY, -- Composite key: {run_id}:{zone_id}:{target_timestamp}
  run_id VARCHAR(64) REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  zone_id VARCHAR(10) REFERENCES zones(id),
  target_timestamp TIMESTAMPTZ NOT NULL,
  temporal_resolution VARCHAR(20) NOT NULL,
  raw_model_prediction NUMERIC(8, 2) NOT NULL,
  calibrated_prediction NUMERIC(8, 2) NOT NULL,
  calibration_factor NUMERIC(6, 4) NOT NULL,
  calibration_source VARCHAR(255) NOT NULL,
  lower_confidence_bound NUMERIC(8, 2) NOT NULL,
  upper_confidence_bound NUMERIC(8, 2) NOT NULL,
  confidence_score NUMERIC(4, 2) NOT NULL,
  features_used JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_run_zone_target UNIQUE (run_id, zone_id, target_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_zone_preds_run ON zone_demand_predictions(run_id);
CREATE INDEX IF NOT EXISTS idx_zone_preds_zone_target ON zone_demand_predictions(zone_id, target_timestamp);

CREATE TABLE IF NOT EXISTS driver_recommendations (
  id VARCHAR(50) PRIMARY KEY,
  source_zone_id VARCHAR(10) REFERENCES zones(id),
  target_zone_id VARCHAR(10) REFERENCES zones(id),
  recommended_vehicle_count INTEGER NOT NULL,
  allocated_vehicle_ids JSONB NOT NULL,
  priority VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'DISPATCHED', 'COMPLETED', 'CANCELLED')),
  estimated_travel_distance_km NUMERIC(6, 2) NOT NULL,
  estimated_travel_time_min INTEGER NOT NULL,
  expected_net_trips_served NUMERIC(6, 2) NOT NULL,
  confidence_score NUMERIC(4, 2) NOT NULL,
  reason TEXT NOT NULL,
  supporting_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recs_status ON driver_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_recs_created ON driver_recommendations(created_at);

CREATE TABLE IF NOT EXISTS data_source_provenance (
  source_id VARCHAR(50) PRIMARY KEY,
  source_name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  provider VARCHAR(150) NOT NULL,
  portal_url TEXT NOT NULL,
  last_updated TIMESTAMPTZ NOT NULL,
  record_count INTEGER NOT NULL,
  coverage TEXT NOT NULL,
  quality_status VARCHAR(20) NOT NULL,
  notes TEXT NOT NULL
);

-- 15-Minute Sub-Hourly Operational Demand Forecasts
CREATE TABLE IF NOT EXISTS demand_forecasts_15m (
  id SERIAL PRIMARY KEY,
  zone_id VARCHAR(10) REFERENCES zones(id),
  target_interval TIMESTAMPTZ NOT NULL,
  quarter_hour_of_day INTEGER NOT NULL CHECK (quarter_hour_of_day BETWEEN 0 AND 95),
  minute_of_hour INTEGER NOT NULL CHECK (minute_of_hour IN (0, 15, 30, 45)),
  baseline_demand INTEGER NOT NULL,
  event_adjusted_demand INTEGER NOT NULL,
  lower_confidence_bound INTEGER NOT NULL,
  upper_confidence_bound INTEGER NOT NULL,
  confidence_score NUMERIC(4, 2) NOT NULL,
  subhourly_weight NUMERIC(4, 2) NOT NULL,
  model_version VARCHAR(50) NOT NULL DEFAULT 'v2.4.2-subhourly-15min',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_forecasts_15m_zone_int ON demand_forecasts_15m(zone_id, target_interval);
CREATE INDEX IF NOT EXISTS idx_forecasts_15m_interval ON demand_forecasts_15m(target_interval);

-- Spatial Event-to-Zone Associations & Distance Decay Estimates
CREATE TABLE IF NOT EXISTS event_zone_impacts (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(50) REFERENCES events(id),
  zone_id VARCHAR(10) REFERENCES zones(id),
  distance_km NUMERIC(6, 2) NOT NULL,
  travel_time_min INTEGER NOT NULL,
  radius_km NUMERIC(5, 2) NOT NULL,
  is_within_radius BOOLEAN NOT NULL,
  temporal_status VARCHAR(30) NOT NULL,
  baseline_demand_15m INTEGER NOT NULL,
  event_lift_multiplier NUMERIC(4, 2) NOT NULL,
  event_adjusted_demand_15m INTEGER NOT NULL,
  additional_trips_expected INTEGER NOT NULL,
  documentation_method TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evt_impact_event ON event_zone_impacts(event_id);
CREATE INDEX IF NOT EXISTS idx_evt_impact_zone ON event_zone_impacts(zone_id);

-- 15-Minute Operational Pipeline Cycle Execution Runs
CREATE TABLE IF NOT EXISTS pipeline_cycle_runs (
  run_id VARCHAR(50) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  cycle_interval_minutes INTEGER DEFAULT 15,
  status VARCHAR(20) NOT NULL CHECK (status IN ('COMPLETED', 'FAILED', 'RUNNING')),
  duration_ms INTEGER NOT NULL,
  zones_forecasted_count INTEGER NOT NULL,
  total_baseline_demand_15m INTEGER NOT NULL,
  total_event_adjusted_demand_15m INTEGER NOT NULL,
  affected_zones_count INTEGER NOT NULL,
  active_events_evaluated INTEGER NOT NULL,
  supply_capacity_assumption NUMERIC(4, 2) NOT NULL DEFAULT 0.55,
  total_available_fleet INTEGER NOT NULL,
  deficit_zones_count INTEGER NOT NULL,
  surplus_zones_count INTEGER NOT NULL,
  recommendations_generated_count INTEGER NOT NULL,
  input_freshness JSONB NOT NULL,
  failures JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cycle_runs_timestamp ON pipeline_cycle_runs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_runs_status ON pipeline_cycle_runs(status);

