-- ==============================================================================
-- ViziMove AI — PostgreSQL Database Inspection & Visibility Suite
-- Visakhapatnam Metropolitan Mobility Operations Platform
-- ==============================================================================
-- 
-- CONNECTION CONFIGURATION FOR pgAdmin, DBeaver, psql:
-- ------------------------------------------------------------------------------
-- Host:        localhost (or ${POSTGRES_HOST:-localhost})
-- Port:        5432 (or ${POSTGRES_PORT:-5432})
-- Database:    vizimove_db (or ${POSTGRES_DB:-vizimove_db})
-- Username:    postgres (or ${POSTGRES_USER:-postgres})
-- Schema:      public
-- SSL Mode:    prefer / disable
-- psql Command: psql -h localhost -p 5432 -U postgres -d vizimove_db
-- ==============================================================================

-- 1. ALL CONFIGURED GEOGRAPHICAL ZONES (30 Authentic Visakhapatnam Zones)
-- Lists zone IDs, official names, urban categories, area in km², centroid coordinates, and baseline activity scores.
SELECT 
    z.id AS zone_id,
    z.name AS zone_name,
    z.category,
    z.area_km2,
    z.centroid_lat,
    z.centroid_lng,
    z.activity_density_score,
    z.commercial_weight,
    z.transit_weight,
    z.tourism_weight
FROM zones z
ORDER BY z.id ASC;


-- 2. LATEST DEMAND FORECAST PER ZONE (15-Minute Operational and Hourly Forecasts)
-- Retrieves the most recent 15-minute sub-hourly prediction for every zone, contrasting baseline demand with event lift.
SELECT 
    df.zone_id,
    z.name AS zone_name,
    df.target_interval,
    df.minute_of_hour,
    df.baseline_demand AS baseline_15m_demand,
    df.event_adjusted_demand AS event_adjusted_15m_demand,
    (df.event_adjusted_demand - df.baseline_demand) AS event_surge_trips,
    df.confidence_score,
    df.subhourly_weight,
    df.model_version
FROM demand_forecasts_15m df
JOIN zones z ON df.zone_id = z.id
WHERE df.target_interval = (
    SELECT MAX(target_interval) FROM demand_forecasts_15m
)
ORDER BY df.event_adjusted_demand DESC;


-- 3. UPCOMING AND CURRENTLY ACTIVE EVENTS (With Source Provenance & Freshness)
-- Lists all authentic verified Visakhapatnam events, coordinates, attendance, validation status, and provenance.
SELECT 
    e.id AS event_id,
    e.name AS event_name,
    e.venue_name,
    e.event_type,
    e.status,
    e.start_time,
    e.end_time,
    e.latitude,
    e.longitude,
    e.associated_zone_id,
    e.estimated_attendance,
    e.attendance_type,
    e.radius_km,
    e.peak_demand_multiplier,
    e.source_id,
    e.source_name,
    e.source_url,
    e.validation_status,
    e.first_seen_at,
    e.last_updated_at,
    e.last_checked_at
FROM events e
WHERE e.status IN ('ACTIVE', 'UPCOMING', 'CANCELLED', 'EXPIRED')
ORDER BY e.start_time ASC;


-- 3B. EVENT SOURCE PROVENANCE, HEALTH & INGESTION AUDIT RUNS
-- Inspects configured event source adapters, rate limits, last check/success/failure timestamps, and batch runs.
SELECT 
    es.source_id,
    es.source_name,
    es.source_url,
    es.adapter_type,
    es.rate_limit_per_minute,
    es.is_active,
    es.last_checked_at,
    es.last_success_at,
    es.last_failure_at,
    es.failure_count,
    es.last_error_message,
    es.total_events_ingested,
    es.provenance_notes
FROM event_sources es
ORDER BY es.source_id ASC;

SELECT 
    ir.run_id,
    ir.source_id,
    ir.source_name,
    ir.status,
    ir.events_ingested,
    ir.events_updated,
    ir.events_skipped,
    ir.duration_ms,
    ir.timestamp AS executed_at,
    ir.errors
FROM event_ingestion_runs ir
ORDER BY ir.timestamp DESC
LIMIT 25;


-- 4. EVENT-TO-ZONE ASSOCIATIONS AND IMPACT ESTIMATES
-- Shows spatial decay relationships, Haversine distances, temporal phase, and estimated demand lift across zones.
SELECT 
    ei.event_id,
    e.name AS event_name,
    ei.zone_id,
    z.name AS zone_name,
    ei.distance_km,
    ei.travel_time_min,
    ei.radius_km,
    ei.temporal_status,
    ei.baseline_demand_15m,
    ei.event_lift_multiplier,
    ei.event_adjusted_demand_15m,
    ei.additional_trips_expected,
    ei.documentation_method,
    ei.evaluated_at
FROM event_zone_impacts ei
JOIN events e ON ei.event_id = e.id
JOIN zones z ON ei.zone_id = z.id
ORDER BY ei.event_lift_multiplier DESC, ei.distance_km ASC;


-- 5. ALL CONFIGURED FLEET VEHICLES AND THEIR CURRENT PERSISTED STATES
-- Inspects virtual vehicles, states (AVAILABLE, BUSY, EN_ROUTE, OFFLINE), assigned zone, battery/fuel, and trip history.
SELECT 
    fv.id AS vehicle_id,
    fv.zone_id,
    z.name AS current_zone_name,
    fv.state,
    fv.battery_or_fuel_level AS charge_pct,
    fv.trips_completed_today,
    fv.reposition_count_today,
    fv.last_state_change,
    fv.assigned_recommendation_id
FROM fleet_vehicles fv
JOIN zones z ON fv.zone_id = z.id
ORDER BY fv.id ASC
LIMIT 100;


-- 6. FLEET ALLOCATION TOTALS BY ZONE
-- Summarizes fleet distribution, breakdown of available vs busy vehicles, and local fleet density across the 30 zones.
SELECT 
    fv.zone_id,
    z.name AS zone_name,
    z.category,
    COUNT(*) AS total_vehicles,
    COUNT(*) FILTER (WHERE fv.state = 'AVAILABLE') AS available_count,
    COUNT(*) FILTER (WHERE fv.state = 'BUSY') AS busy_count,
    COUNT(*) FILTER (WHERE fv.state = 'EN_ROUTE') AS en_route_count,
    COUNT(*) FILTER (WHERE fv.state = 'OFFLINE') AS offline_count,
    ROUND(AVG(fv.battery_or_fuel_level), 1) AS avg_battery_fuel_pct
FROM fleet_vehicles fv
JOIN zones z ON fv.zone_id = z.id
GROUP BY fv.zone_id, z.name, z.category
ORDER BY total_vehicles DESC;


-- 7. LATEST SUPPLY-DEMAND RESULTS (15-Minute Operational Window)
-- Compares event-adjusted 15-minute demand against available supply capacity (0.55 trips/veh/15m) to detect shortages and surpluses.
WITH ZoneAvailableFleet AS (
    SELECT 
        fv.zone_id,
        COUNT(*) FILTER (WHERE fv.state = 'AVAILABLE') AS available_vehicles
    FROM fleet_vehicles fv
    GROUP BY fv.zone_id
),
Latest15mForecast AS (
    SELECT 
        df.zone_id,
        df.baseline_demand,
        df.event_adjusted_demand
    FROM demand_forecasts_15m df
    WHERE df.target_interval = (SELECT MAX(target_interval) FROM demand_forecasts_15m)
)
SELECT 
    z.id AS zone_id,
    z.name AS zone_name,
    COALESCE(fc.baseline_demand, 0) AS baseline_15m_demand,
    COALESCE(fc.event_adjusted_demand, 0) AS event_adjusted_demand,
    COALESCE(fl.available_vehicles, 0) AS available_vehicles,
    ROUND(COALESCE(fl.available_vehicles, 0) * 0.55, 1) AS capacity_15m_trips,
    GREATEST(0, ROUND(COALESCE(fc.event_adjusted_demand, 0) - (COALESCE(fl.available_vehicles, 0) * 0.55), 1)) AS unmet_demand_deficit,
    GREATEST(0, COALESCE(fl.available_vehicles, 0) - CEIL(COALESCE(fc.event_adjusted_demand, 0) / 0.55)) AS surplus_vehicles,
    CASE 
        WHEN COALESCE(fc.event_adjusted_demand, 0) - (COALESCE(fl.available_vehicles, 0) * 0.55) > 8 THEN 'CRITICAL_DEFICIT'
        WHEN COALESCE(fc.event_adjusted_demand, 0) - (COALESCE(fl.available_vehicles, 0) * 0.55) > 0 THEN 'MODERATE_DEFICIT'
        WHEN COALESCE(fl.available_vehicles, 0) - CEIL(COALESCE(fc.event_adjusted_demand, 0) / 0.55) >= 6 THEN 'SURPLUS'
        ELSE 'BALANCED'
    END AS shortage_severity
FROM zones z
LEFT JOIN Latest15mForecast fc ON z.id = fc.zone_id
LEFT JOIN ZoneAvailableFleet fl ON z.id = fl.zone_id
ORDER BY unmet_demand_deficit DESC, surplus_vehicles DESC;


-- 8. RECENT DRIVER RECOMMENDATIONS
-- Audits repositioning directives, source and target zones, priorities, travel times, and current dispatch status.
SELECT 
    dr.id AS recommendation_id,
    dr.source_zone_id,
    sz.name AS source_zone_name,
    dr.target_zone_id,
    tz.name AS target_zone_name,
    dr.recommended_vehicle_count,
    dr.priority,
    dr.status,
    dr.estimated_travel_distance_km,
    dr.estimated_travel_time_min,
    dr.expected_net_trips_served,
    dr.confidence_score,
    dr.reason,
    dr.created_at
FROM driver_recommendations dr
JOIN zones sz ON dr.source_zone_id = sz.id
JOIN zones tz ON dr.target_zone_id = tz.id
ORDER BY dr.created_at DESC
LIMIT 25;


-- 9. FORECAST RUN HISTORY AND INGESTION FAILURES
-- Reviews historical 15-minute pipeline cycle executions, execution durations, input freshness, and logged errors.
SELECT 
    pcr.run_id,
    pcr.timestamp AS cycle_start_time,
    pcr.status,
    pcr.duration_ms,
    pcr.zones_forecasted_count,
    pcr.total_baseline_demand_15m,
    pcr.total_event_adjusted_demand_15m,
    pcr.affected_zones_count,
    pcr.active_events_evaluated,
    pcr.total_available_fleet,
    pcr.deficit_zones_count,
    pcr.surplus_zones_count,
    pcr.recommendations_generated_count,
    pcr.input_freshness->>'dataFreshnessSeconds' AS data_age_sec,
    pcr.input_freshness->>'zonesFreshness' AS zones_freshness,
    pcr.failures
FROM pipeline_cycle_runs pcr
ORDER BY pcr.timestamp DESC
LIMIT 50;


-- 10. DEMAND FORECAST RUNS METADATA AND DATA FRESHNESS (Prompt 2 Integration)
-- Audits idempotent forecast run executions, actual temporal resolution ('HOURLY'), horizon, data age, and status.
SELECT
    fr.run_id,
    fr.model_version,
    fr.temporal_resolution,
    fr.forecast_horizon_hours,
    fr.generation_timestamp,
    fr.data_freshness_seconds,
    fr.input_freshness_status,
    fr.zones_configured_count,
    fr.zones_forecasted_count,
    fr.expected_predictions_count,
    fr.actual_predictions_count,
    fr.status,
    fr.summary->>'totalRawPredictedDemand' AS total_raw_demand,
    fr.summary->>'totalCalibratedPredictedDemand' AS total_calibrated_demand,
    fr.summary->>'avgConfidenceScore' AS avg_confidence,
    fr.failures
FROM forecast_runs fr
ORDER BY fr.generation_timestamp DESC
LIMIT 25;


-- 11. RAW MODEL PREDICTIONS VS GEOGRAPHICALLY CALIBRATED PREDICTIONS
-- Contrasts pure uncalibrated model output with Visakhapatnam empirical calibration across all 30 zones.
SELECT
    zdp.run_id,
    zdp.zone_id,
    z.name AS zone_name,
    zdp.target_timestamp,
    zdp.temporal_resolution,
    zdp.raw_model_prediction,
    zdp.calibrated_prediction,
    zdp.calibration_factor,
    zdp.calibration_source,
    (zdp.calibrated_prediction - zdp.raw_model_prediction) AS calibration_adjustment_delta,
    zdp.lower_confidence_bound,
    zdp.upper_confidence_bound,
    zdp.confidence_score
FROM zone_demand_predictions zdp
JOIN zones z ON zdp.zone_id = z.id
WHERE zdp.run_id = (SELECT run_id FROM forecast_runs ORDER BY generation_timestamp DESC LIMIT 1)
ORDER BY zdp.target_timestamp ASC, zdp.calibrated_prediction DESC;

