/**
 * ViziMove AI — Full-Stack Server
 * Express backend mounted with Vite middlewares in development.
 */

import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import { requireAuth, handleGetSession, isApiKeyConfigured } from './src/lib/auth';
import { VIZAG_ZONES, getZoneById } from './src/lib/zones';
import {
  forecastDemandForZone,
  generateForecastHorizon,
  forecast15mForZone,
  generate15mForecastHorizon,
  MODEL_EVALUATION_METRICS,
  SUBHOURLY_MODEL_EVALUATION_METRICS,
  DIURNAL_HOURLY_WEIGHTS,
  executeDemandForecastingPipeline,
  forecastDemandForZonePure,
  GENUINE_15M_FORECAST_GAP_ANALYSIS,
} from './src/lib/forecasting';
import {
  VERIFIED_VIZAG_EVENTS,
  getEventsForZone,
  generateAllEventZoneAssociations,
  getEventZoneAssociationsForEvent,
  EVENT_SOURCES_REGISTRY,
  executeSourceIngestion,
  executeAllSourcesIngestion,
  validateEventRecord,
  ingestSingleEvent,
  generateStableEventId,
} from './src/lib/events';
import {
  globalFleetManager,
} from './src/lib/fleet';
import {
  analyzeAllZonesSupplyDemand,
  analyzeZoneSupplyDemand,
} from './src/lib/supplyDemand';
import {
  globalRecommendationEngine,
} from './src/lib/recommendations';
import {
  generateOperationsSummary,
  answerOperationalInquiry,
} from './src/lib/operations';
import {
  DATA_SOURCES_REGISTRY,
  getSystemHealth,
} from './src/lib/provenance';
import {
  VIZAG_CALIBRATION_EVIDENCE,
  validateCalibrationCoverage,
} from './src/lib/calibration';
import { globalPipelineScheduler } from './src/lib/pipelineScheduler';
import { persistentStore } from './src/db/store';
import { notifyN8n } from './src/lib/n8nNotifier';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Fail-safe audit check on server start
  if (!isApiKeyConfigured()) {
    console.warn(
      '[ViziMove AI Auth] WARNING: VIZIMOVE_API_KEY is not configured in server environment. Mutation routes authenticated via X-API-Key will fail safely until configured.'
    );
  } else {
    console.log('[ViziMove AI Auth] VIZIMOVE_API_KEY configured. Protected mutation routes armed.');
  }

  // Seed initial recommendations
  globalRecommendationEngine.generateRecommendations(globalFleetManager, new Date(), 5);

  // Seed initial demand forecast run if none exists (Prompt 2 Integration)
  if (!persistentStore.getLatestForecastRun()) {
    try {
      executeDemandForecastingPipeline({ horizonHours: 12 });
    } catch (err) {
      console.error('[ViziMove AI] Initial forecast run seeding error:', err);
    }
  }

  // Start 15-Minute Operational Pipeline Scheduler
  globalPipelineScheduler.start();

  // --- API ROUTERS ---

  // Auth: Session & CSRF bootstrap endpoint for same-origin React dashboard
  app.get('/api/auth/session', handleGetSession);

  // Health & Provenance
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json(getSystemHealth(persistentStore));
  });

  app.get('/api/provenance', (_req: Request, res: Response) => {
    res.json({
      sources: DATA_SOURCES_REGISTRY,
      calibrationCoverage: validateCalibrationCoverage(),
      metadata: {
        platform: 'ViziMove AI',
        city: 'Visakhapatnam, Andhra Pradesh, India',
        modelVersion: MODEL_EVALUATION_METRICS.version,
        activeZones: VIZAG_ZONES.length,
      },
    });
  });

  // Zones
  app.get('/api/zones', (_req: Request, res: Response) => {
    res.json(VIZAG_ZONES);
  });

  app.get('/api/zones/:id', (req: Request, res: Response) => {
    const zone = getZoneById(req.params.id);
    if (!zone) {
      res.status(404).json({ error: 'Zone not found' });
      return;
    }
    res.json(zone);
  });

  // Demand & Forecasting
  app.get('/api/demand/forecast', (req: Request, res: Response) => {
    const hoursAhead = req.query.hours ? parseInt(req.query.hours as string, 10) : 12;
    const horizon = generateForecastHorizon(VIZAG_ZONES, Math.min(24, Math.max(1, hoursAhead)));
    res.json(horizon);
  });

  app.get('/api/demand/forecast-15m', (req: Request, res: Response) => {
    const intervals = req.query.intervals ? parseInt(req.query.intervals as string, 10) : 16;
    const horizon = generate15mForecastHorizon(VIZAG_ZONES, Math.min(32, Math.max(1, intervals)));
    res.json(horizon);
  });

  app.get('/api/demand/metrics-15m', (_req: Request, res: Response) => {
    res.json(SUBHOURLY_MODEL_EVALUATION_METRICS);
  });

  app.get('/api/demand/historical', (_req: Request, res: Response) => {
    res.json({
      diurnalWeights: DIURNAL_HOURLY_WEIGHTS,
      source: 'Official NYC TLC FHV 2026 Aggregates normalized for diurnal distribution',
      coverage: '35,040 hourly zone observations chronologically partitioned',
    });
  });

  app.get('/api/model/metrics', (_req: Request, res: Response) => {
    res.json(MODEL_EVALUATION_METRICS);
  });

  app.get('/api/calibration', (_req: Request, res: Response) => {
    res.json({
      evidence: VIZAG_CALIBRATION_EVIDENCE,
      coverage: validateCalibrationCoverage(),
    });
  });

  // Demand Forecast Runs & Zone Integration (Prompt 2 Integration)
  app.get('/api/demand/forecast/runs', (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    res.json(persistentStore.getForecastRuns(limit));
  });

  app.get('/api/demand/forecast/runs/:runId', (req: Request, res: Response) => {
    const run = persistentStore.getForecastRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: `Forecast run '${req.params.runId}' not found` });
      return;
    }
    const predictions = persistentStore.getPredictionsForRun(req.params.runId);
    res.json({ run, predictions });
  });

  app.get('/api/demand/forecast/predictions/:zoneId', (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 48;
    const predictions = persistentStore.getPredictionsForZone(req.params.zoneId, limit);
    res.json(predictions);
  });

  app.post('/api/demand/forecast/execute', requireAuth, (req: Request, res: Response) => {
    try {
      const horizonHours = req.body.horizonHours ? parseInt(req.body.horizonHours, 10) : 12;
      const runId = req.body.runId;
      const result = executeDemandForecastingPipeline({ horizonHours, runId });
      res.json({
        success: true,
        message: 'Demand forecasting pipeline executed and persisted successfully',
        run: result.run,
        predictionsCount: result.predictions.length,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Forecast pipeline execution failed',
      });
    }
  });

  app.get('/api/demand/15m-gap-analysis', (_req: Request, res: Response) => {
    res.json(GENUINE_15M_FORECAST_GAP_ANALYSIS);
  });

  // --- EVENT INTELLIGENCE READ & INGESTION APIS (PROMPT 3A INTEGRATION) ---

  // List events with optional filters (status, category, zoneId, validationStatus)
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const filters = {
      status: req.query.status as string | undefined,
      category: req.query.category as string | undefined,
      zoneId: req.query.zoneId as string | undefined,
      validationStatus: req.query.validationStatus as string | undefined,
    };
    const events = persistentStore.getEvents(filters);
    res.json(events);
  });

  // Event Sources: Status, provenance, last-checked time, last-success, failure-counts, and freshness
  app.get('/api/events/sources', (req: Request, res: Response) => {
    let sources = persistentStore.getEventSources();
    if (req.query.activeOnly === 'true') {
      sources = sources.filter((s) => s.isActive !== false);
    }
    res.json({
      sources,
      configuredAdaptersCount: EVENT_SOURCES_REGISTRY.length,
      registry: EVENT_SOURCES_REGISTRY,
    });
  });

  // Specific event source details and recent ingestion runs
  app.get('/api/events/sources/:sourceId', (req: Request, res: Response) => {
    const source = persistentStore.getEventSource(req.params.sourceId);
    if (!source) {
      res.status(404).json({ error: `Event source '${req.params.sourceId}' not found in registry` });
      return;
    }
    const recentRuns = persistentStore.getIngestionRuns(req.params.sourceId, 10);
    const config = EVENT_SOURCES_REGISTRY.find((s) => s.sourceId === req.params.sourceId);
    res.json({ source, config, recentRuns });
  });

  // Dynamic configuration & enabling/disabling of event sources without code changes (Req 14)
  app.patch('/api/events/sources/:sourceId', requireAuth, (req: Request, res: Response) => {
    const { sourceId } = req.params;
    const patch = req.body;
    const updated = persistentStore.updateEventSource(sourceId, patch);
    if (!updated) {
      res.status(404).json({ error: `Event source '${sourceId}' not found in registry` });
      return;
    }
    const current = persistentStore.getEventSource(sourceId);
    res.json({
      success: true,
      message: `Event source '${sourceId}' configuration updated successfully`,
      source: current,
    });
  });

  // Direct source status reporting from n8n (for recording external errors, timeouts, or check results)
  app.post('/api/events/sources/:sourceId/status', requireAuth, (req: Request, res: Response) => {
    const { sourceId } = req.params;
    const { success, errors, eventsIngested, eventsUpdated, eventsSkipped, durationMs } = req.body;
    const nowIso = new Date().toISOString();

    const runResult = {
      sourceId,
      sourceName: persistentStore.getEventSource(sourceId)?.sourceName || sourceId,
      success: Boolean(success),
      eventsIngested: eventsIngested || 0,
      eventsUpdated: eventsUpdated || 0,
      eventsSkipped: eventsSkipped || 0,
      errors: Array.isArray(errors) ? errors : errors ? [String(errors)] : [],
      durationMs: durationMs || 0,
      timestamp: nowIso,
    };

    persistentStore.recordIngestionRun(runResult);
    const updatedSource = persistentStore.getEventSource(sourceId);

    res.json({
      success: true,
      message: `Source status for '${sourceId}' updated successfully`,
      source: updatedSource,
      run: runResult,
    });
  });

  // All spatial event-to-zone impacts & distance decay estimates across currently active/upcoming events
  app.get('/api/events/impacts', (_req: Request, res: Response) => {
    const impacts = generateAllEventZoneAssociations(
      persistentStore.getEvents(),
      VIZAG_ZONES,
      new Date()
    );
    res.json(impacts);
  });

  // Events associated with a specific zone
  app.get('/api/events/zone/:zoneId', (req: Request, res: Response) => {
    res.json(getEventsForZone(req.params.zoneId, persistentStore.getEvents()));
  });

  // Single event details, including provenance, validation status, and its specific zone associations
  app.get('/api/events/:id', (req: Request, res: Response) => {
    const event = persistentStore.getEventById(req.params.id);
    if (!event) {
      res.status(404).json({ error: `Event '${req.params.id}' not found` });
      return;
    }
    const zoneAssociations = getEventZoneAssociationsForEvent(event, VIZAG_ZONES, new Date());
    const source = event.sourceId ? persistentStore.getEventSource(event.sourceId) : undefined;
    res.json({ event, zoneAssociations, source });
  });

  // Affected-zone associations specifically for a single event
  app.get('/api/events/:id/associations', (req: Request, res: Response) => {
    const event = persistentStore.getEventById(req.params.id);
    if (!event) {
      res.status(404).json({ error: `Event '${req.params.id}' not found` });
      return;
    }
    const associations = getEventZoneAssociationsForEvent(event, VIZAG_ZONES, new Date());
    res.json(associations);
  });

  // Dry-run payload validator (does not write to store)
  app.post('/api/events/validate', requireAuth, (req: Request, res: Response) => {
    const result = validateEventRecord(req.body, new Date());
    res.json(result);
  });

  // Programmatic event creation or update with validation and deterministic deduplication
  app.post('/api/events', requireAuth, (req: Request, res: Response) => {
    try {
      const stableId = generateStableEventId({
        sourceId: req.body.sourceId,
        sourceEventId: req.body.sourceEventId,
        name: req.body.name,
        startTime: req.body.startTime,
      });

      const existing = persistentStore.getEventById(stableId);
      const ingestResult = ingestSingleEvent(req.body, existing, new Date());

      if (ingestResult.action === 'INVALID') {
        res.status(400).json({
          success: false,
          error: 'Event payload validation failed',
          validationErrors: ingestResult.errors,
          warnings: ingestResult.warnings,
        });
        return;
      }

      if (ingestResult.event) {
        persistentStore.upsertEvent(ingestResult.event);
      }

      res.status(ingestResult.action === 'CREATED' ? 201 : 200).json({
        success: true,
        action: ingestResult.action,
        event: ingestResult.event,
        warnings: ingestResult.warnings,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to ingest event' });
    }
  });

  // Batch ingestion endpoint for n8n workflow integration (Req 6 & 7)
  app.post('/api/events/batch', requireAuth, (req: Request, res: Response) => {
    const startTimeMs = Date.now();
    try {
      const { sourceId, events, metadata } = req.body;
      if (!Array.isArray(events)) {
        res.status(400).json({
          success: false,
          error: "Payload must contain an 'events' array",
        });
        return;
      }

      const effectiveSourceId = sourceId || (events[0]?.sourceId) || 'SRC-N8N-BATCH';
      const now = new Date();
      let eventsIngested = 0;
      let eventsUpdated = 0;
      let eventsSkipped = 0;
      const errors: string[] = [];
      const processedEvents: any[] = [];

      for (const raw of events) {
        raw.sourceId = raw.sourceId || effectiveSourceId;
        const stableId = generateStableEventId({
          sourceId: raw.sourceId,
          sourceEventId: raw.sourceEventId,
          name: raw.name,
          startTime: raw.startTime,
        });

        const existing = persistentStore.getEventById(stableId);
        const res = ingestSingleEvent(raw, existing, now);

        if (res.action === 'CREATED' && res.event) {
          persistentStore.upsertEvent(res.event);
          eventsIngested++;
          processedEvents.push({ id: res.event.id, action: 'CREATED' });
        } else if (res.action === 'UPDATED' && res.event) {
          persistentStore.upsertEvent(res.event);
          eventsUpdated++;
          processedEvents.push({ id: res.event.id, action: 'UPDATED' });
        } else if (res.action === 'UNCHANGED' && res.event) {
          persistentStore.upsertEvent(res.event);
          eventsSkipped++;
          processedEvents.push({ id: res.event.id, action: 'UNCHANGED' });
        } else if (res.action === 'INVALID') {
          errors.push(`Event '${raw.name || 'unnamed'}': ${res.errors?.join('; ')}`);
        }
      }

      const durationMs = Date.now() - startTimeMs;
      const success = errors.length === 0 || (eventsIngested + eventsUpdated + eventsSkipped > 0);

      // Record ingestion run in PostgreSQL / JSON store
      persistentStore.recordIngestionRun({
        sourceId: effectiveSourceId,
        sourceName: persistentStore.getEventSource(effectiveSourceId)?.sourceName || effectiveSourceId,
        success,
        eventsIngested,
        eventsUpdated,
        eventsSkipped,
        errors,
        durationMs,
        timestamp: now.toISOString(),
      });

      res.json({
        success,
        sourceId: effectiveSourceId,
        totalProcessed: events.length,
        eventsIngested,
        eventsUpdated,
        eventsSkipped,
        errors,
        durationMs,
        processedEvents,
        timestamp: now.toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Batch ingestion execution failed',
      });
    }
  });

  // Trigger safe, idempotent ingestion across configured adapters or a specific source
  app.post('/api/events/ingest', requireAuth, async (req: Request, res: Response) => {
    try {
      const { sourceId } = req.body;
      if (sourceId) {
        const result = await executeSourceIngestion(sourceId, persistentStore);
        res.json({
          success: result.success,
          message: `Ingestion completed for source '${sourceId}'`,
          run: result,
        });
        // Fire-and-forget n8n notification (optional — skipped if N8N_WEBHOOK_URL not set)
        notifyN8n({
          trigger: 'events/ingest',
          timestamp: new Date().toISOString(),
          sourceId: req.body.sourceId,
          success: result.success,
          eventsIngested: result.eventsIngested ?? 0,
        });

      } else {
        const results = await executeAllSourcesIngestion(persistentStore);
        const totalIngested = results.reduce((acc, r) => acc + r.eventsIngested, 0);
        const totalUpdated = results.reduce((acc, r) => acc + r.eventsUpdated, 0);
        const totalSkipped = results.reduce((acc, r) => acc + r.eventsSkipped, 0);
        const allSuccessful = results.every((r) => r.success);

        res.json({
          success: allSuccessful,
          message: `Ingestion completed for all ${results.length} configured sources`,
          totalIngested,
          totalUpdated,
          totalSkipped,
          results,
        });
        // Fire-and-forget n8n notification (optional — skipped if N8N_WEBHOOK_URL not set)
        notifyN8n({
          trigger: 'events/ingest',
          timestamp: new Date().toISOString(),
          totalIngested,
          totalUpdated,
          totalSkipped,
          success: allSuccessful,
          sourceCount: results.length,
        });

      }
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Event ingestion cycle failed',
      });
    }
  });

  // 15-Minute Operational Pipeline
  app.get('/api/pipeline/status', (_req: Request, res: Response) => {
    res.json(globalPipelineScheduler.getStatus());
  });

  app.get('/api/pipeline/history', (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    res.json(persistentStore.getCycleRuns(limit));
  });

  app.post('/api/pipeline/trigger', requireAuth, async (_req: Request, res: Response) => {
    try {
      const cycleRun = await globalPipelineScheduler.triggerImmediateCycle('MANUAL_API_TRIGGER');
      res.json({
        success: true,
        message: '15-minute operational pipeline cycle completed successfully',
        cycleRun,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Pipeline cycle execution failed',
      });
    }
  });

  // PostgreSQL Database Inspection & Visibility Suite
  app.get('/api/db/queries', (_req: Request, res: Response) => {
    let sqlContent = '';
    try {
      const queriesPath = path.resolve(__dirname, 'src/db/queries.sql');
      if (fs.existsSync(queriesPath)) {
        sqlContent = fs.readFileSync(queriesPath, 'utf-8');
      }
    } catch (e) {
      console.error('Failed to read queries.sql', e);
    }

    res.json({
      connection: {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'vizimove_db',
        username: process.env.POSTGRES_USER || 'postgres',
        schema: 'public',
        clientToolsSupported: ['pgAdmin 4', 'DBeaver', 'psql CLI', 'Datagrip', 'TablePlus'],
        psqlCommand: 'psql -h localhost -p 5432 -U postgres -d vizimove_db',
      },
      sqlSuite: sqlContent,
      tableRegistry: [
        'zones',
        'events',
        'event_sources',
        'event_ingestion_runs',
        'fleet_vehicles',
        'demand_forecasts',
        'demand_forecasts_15m',
        'forecast_runs',
        'zone_demand_predictions',
        'event_zone_impacts',
        'pipeline_cycle_runs',
        'driver_recommendations',
        'data_source_provenance',
      ],
    });
  });

  app.get('/api/db/inspect/:table', (req: Request, res: Response) => {
    const table = req.params.table;
    if (table === 'zones') {
      res.json(VIZAG_ZONES);
    } else if (table === 'events') {
      res.json(persistentStore.getEvents());
    } else if (table === 'event_sources') {
      res.json(persistentStore.getEventSources());
    } else if (table === 'event_ingestion_runs') {
      res.json(persistentStore.getIngestionRuns(undefined, 50));
    } else if (table === 'fleet_vehicles') {
      res.json(persistentStore.getVehicles().slice(0, 100));
    } else if (table === 'demand_forecasts') {
      const latestRun = persistentStore.getLatestForecastRun();
      res.json(latestRun ? persistentStore.getPredictionsForRun(latestRun.runId).slice(0, 100) : []);
    } else if (table === 'forecast_runs') {
      res.json(persistentStore.getForecastRuns(25));
    } else if (table === 'zone_demand_predictions') {
      const latestRun = persistentStore.getLatestForecastRun();
      res.json(latestRun ? persistentStore.getPredictionsForRun(latestRun.runId).slice(0, 100) : []);
    } else if (table === 'demand_forecasts_15m') {
      res.json(persistentStore.getForecasts15m().slice(0, 100));
    } else if (table === 'event_zone_impacts') {
      res.json(persistentStore.getEventZoneImpacts());
    } else if (table === 'pipeline_cycle_runs') {
      res.json(persistentStore.getCycleRuns(50));
    } else if (table === 'driver_recommendations') {
      res.json(persistentStore.getRecommendations());
    } else if (table === 'data_source_provenance') {
      res.json(DATA_SOURCES_REGISTRY);
    } else {
      res.status(404).json({ error: `Table '${table}' not found in relational schema registry` });
    }
  });

  // Fleet
  app.get('/api/fleet', (_req: Request, res: Response) => {
    res.json({
      summary: globalFleetManager.getFleetStateSummary(),
      vehicles: globalFleetManager.getAllVehicles(),
    });
  });

  app.get('/api/fleet/summary', (_req: Request, res: Response) => {
    res.json(globalFleetManager.getFleetStateSummary());
  });

  app.get('/api/fleet/movements', (_req: Request, res: Response) => {
    res.json(globalFleetManager.getActiveMovements());
  });

  app.post('/api/fleet/simulate-step', requireAuth, (_req: Request, res: Response) => {
    const stepResult = globalFleetManager.stepSimulation();
    res.json({
      success: true,
      stepResult,
      summary: globalFleetManager.getFleetStateSummary(),
    });
  });

  app.post('/api/fleet/reallocate', requireAuth, (req: Request, res: Response) => {
    const policy = req.body.policy || 'PROPORTIONAL_TO_DEMAND';
    if (!['PROPORTIONAL_TO_DEMAND', 'UNIFORM', 'TRANSIT_HEAVY'].includes(policy)) {
      res.status(400).json({ error: 'Invalid allocation policy' });
      return;
    }
    globalFleetManager.initializeFleet(policy);
    res.json({
      success: true,
      policy,
      summary: globalFleetManager.getFleetStateSummary(),
    });
  });

  // Supply-Demand Analysis
  app.get('/api/supply-demand', (req: Request, res: Response) => {
    const targetHourOffset = req.query.hourOffset ? parseInt(req.query.hourOffset as string, 10) : 0;
    const targetTime = new Date(Date.now() + targetHourOffset * 3600 * 1000);
    const capacityParam = req.query.capacity ? parseFloat(req.query.capacity as string) : 2.2;

    const analysis = analyzeAllZonesSupplyDemand(globalFleetManager, targetTime, capacityParam);
    res.json({
      targetTimestamp: targetTime.toISOString(),
      capacityAssumption: capacityParam,
      zones: analysis,
    });
  });

  // Recommendations
  app.get('/api/recommendations', (_req: Request, res: Response) => {
    res.json(globalRecommendationEngine.getAllRecommendations());
  });

  // Autonomous Dispatch Status
  app.get('/api/dispatch/status', (_req: Request, res: Response) => {
    const lastCycle = persistentStore.getLatestCycleRun();
    const allRecs = persistentStore.getRecommendations();
    const fleetSummary = globalFleetManager.getFleetStateSummary();
    res.json({
      autonomousDispatchEnabled: true,
      mode: 'AUTONOMOUS',
      lastCycleTimestamp: lastCycle?.timestamp || null,
      lastCycleId: lastCycle?.runId || null,
      dispatchedThisCycle: lastCycle?.recommendationsGeneratedCount || 0,
      pendingCount: allRecs.filter((r) => r.status === 'PENDING').length,
      dispatchedCount: allRecs.filter((r) => r.status === 'DISPATCHED').length,
      failedCount: allRecs.filter((r) => !!r.dispatchError).length,
      enRouteVehicles: fleetSummary.enRoute,
    });
  });

  app.post('/api/recommendations/generate', requireAuth, (req: Request, res: Response) => {
    const targetTime = req.body.targetTime ? new Date(req.body.targetTime) : new Date();
    const count = req.body.maxCount || 5;
    const generated = globalRecommendationEngine.generateRecommendations(globalFleetManager, targetTime, count);
    res.json({
      success: true,
      generatedCount: generated.length,
      recommendations: generated,
    });
  });

  app.post('/api/recommendations/:id/dispatch', requireAuth, (req: Request, res: Response) => {
    res.status(410).json({
      error: 'Manual dispatch is no longer supported. Recommendations are dispatched autonomously by the 15-minute pipeline.',
      code: 'ENDPOINT_DEPRECATED',
    });
  });

  app.post('/api/recommendations/:id/complete', requireAuth, (req: Request, res: Response) => {
    const success = globalRecommendationEngine.completeRecommendation(req.params.id, globalFleetManager);
    if (!success) {
      res.status(400).json({ error: 'Recommendation not found or not in DISPATCHED state' });
      return;
    }
    res.json({ success: true, recommendation: globalRecommendationEngine.getRecommendation(req.params.id) });
  });

  app.post('/api/recommendations/:id/cancel', requireAuth, (req: Request, res: Response) => {
    const success = globalRecommendationEngine.cancelRecommendation(req.params.id);
    if (!success) {
      res.status(400).json({ error: 'Recommendation cannot be cancelled' });
      return;
    }
    res.json({ success: true, recommendation: globalRecommendationEngine.getRecommendation(req.params.id) });
  });

  // Operations
  app.get('/api/operations/summary', (_req: Request, res: Response) => {
    res.json(generateOperationsSummary(globalFleetManager, globalRecommendationEngine));
  });

  app.post('/api/operations/inquiry', requireAuth, (req: Request, res: Response) => {
    const { queryType } = req.body;
    if (!queryType) {
      res.status(400).json({ error: 'queryType required' });
      return;
    }
    const result = answerOperationalInquiry(
      queryType,
      globalFleetManager,
      globalRecommendationEngine
    );
    res.json(result);
  });

  // Catch-all for undefined /api routes: return JSON 404 instead of falling through to Vite SPA HTML
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.path}`,
    });
  });

  // Attach Vite or Static file middleware
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ViziMove AI] Operations Server listening on http://0.0.0.0:${PORT}`);
  });

  const handleShutdown = (signal: string) => {
    console.log(`[ViziMove AI] Received ${signal}. Shutting down cleanly...`);
    globalPipelineScheduler.stop();
    server.close(() => {
      console.log('[ViziMove AI] HTTP server closed cleanly.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[ViziMove AI] Server startup failure:', err);
  process.exit(1);
});
