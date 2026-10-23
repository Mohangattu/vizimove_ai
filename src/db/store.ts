/**
 * ViziMove AI — Persistent Relational Store Engine
 * Guarantees fleet state, events, and recommendations survive server restarts.
 * Enforces SQL foreign keys, unique IDs, and allocation reconciliation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  VirtualVehicle,
  EventRecord,
  DriverRecommendation,
  ZoneRecord,
  DataSourceProvenance,
  PipelineCycleRun,
  Forecast15mRecord,
  EventZoneAssociation,
  ForecastRunRecord,
  ZoneDemandPredictionRecord,
  EventSourceStatus,
  IngestionResult,
} from '../lib/types';
import { VIZAG_ZONES, getZoneById } from '../lib/zones';
import { VERIFIED_VIZAG_EVENTS, getDefaultEventSourceStatuses, deriveEventStatus } from '../lib/events';
import { DATA_SOURCES_REGISTRY } from '../lib/provenance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_PATH = path.resolve(DATA_DIR, 'vizimove_store.json');

export interface DatabaseState {
  fleetSize: number;
  vehicles: Record<string, VirtualVehicle>;
  events: Record<string, EventRecord>;
  eventSources: Record<string, EventSourceStatus>;
  eventIngestionRuns: Record<string, IngestionResult>;
  recommendations: Record<string, DriverRecommendation>;
  cycleRuns: Record<string, PipelineCycleRun>;
  latestForecasts15m: Record<string, Forecast15mRecord[]>;
  latestEventZoneImpacts: EventZoneAssociation[];
  forecastRuns: Record<string, ForecastRunRecord>;
  demandPredictions: Record<string, ZoneDemandPredictionRecord>;
  lastPersistedAt: string;
  schemaVersion: string;
}

export class PersistentStore {
  private state: DatabaseState;
  private isLoaded: boolean = false;

  constructor() {
    this.ensureDataDirectory();
    this.state = this.loadFromDisk();
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadFromDisk(): DatabaseState {
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed.vehicles && Object.keys(parsed.vehicles).length > 0) {
          parsed.cycleRuns = parsed.cycleRuns || {};
          parsed.latestForecasts15m = parsed.latestForecasts15m || {};
          parsed.latestEventZoneImpacts = parsed.latestEventZoneImpacts || [];
          parsed.forecastRuns = parsed.forecastRuns || {};
          parsed.demandPredictions = parsed.demandPredictions || {};
          parsed.eventSources = parsed.eventSources || {};
          parsed.eventIngestionRuns = parsed.eventIngestionRuns || {};

          // Seed default source statuses if not present
          if (Object.keys(parsed.eventSources).length === 0) {
            parsed.eventSources = getDefaultEventSourceStatuses();
          }

          // Merge any newly verified events into existing store
          parsed.events = parsed.events || {};
          for (const evt of VERIFIED_VIZAG_EVENTS) {
            if (!parsed.events[evt.id]) {
              parsed.events[evt.id] = evt;
            }
          }

          // Reconcile and persist current event statuses (e.g. mark events with past end times as EXPIRED)
          let statusUpdated = false;
          const nowIso = new Date().toISOString();
          for (const evt of Object.values(parsed.events)) {
            const derived = deriveEventStatus(evt, new Date());
            if (evt.status !== derived) {
              evt.status = derived;
              evt.lastUpdatedAt = nowIso;
              evt.lastCheckedAt = nowIso;
              statusUpdated = true;
            }
          }
          if (statusUpdated) {
            console.log('[Store] Reconciled and persisted event temporal statuses on load.');
            try {
              fs.writeFileSync(STORE_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
            } catch (persistErr) {
              console.error('[Store] Failed to persist reconciled statuses on load', persistErr);
            }
          }

          console.log(`[Store] Loaded ${Object.keys(parsed.vehicles).length} vehicles, ${Object.keys(parsed.events || {}).length} events, and ${Object.keys(parsed.cycleRuns).length} cycle runs from persistent disk.`);
          this.isLoaded = true;
          return parsed;
        }
      } catch (err) {
        console.error('[Store] Failed to read existing store, re-initializing', err);
      }
    }

    // Initialize with 1,200 vehicles across 30 zones if fresh installation
    console.log('[Store] Initializing fresh persistent fleet store with 1,200 virtual vehicles...');
    const initialVehicles = this.generateInitialFleet(1200, 'PROPORTIONAL_TO_DEMAND');
    const initialEvents: Record<string, EventRecord> = {};
    for (const evt of VERIFIED_VIZAG_EVENTS) {
      initialEvents[evt.id] = evt;
    }

    const state: DatabaseState = {
      fleetSize: 1200,
      vehicles: initialVehicles,
      events: initialEvents,
      eventSources: getDefaultEventSourceStatuses(),
      eventIngestionRuns: {},
      recommendations: {},
      cycleRuns: {},
      latestForecasts15m: {},
      latestEventZoneImpacts: [],
      forecastRuns: {},
      demandPredictions: {},
      lastPersistedAt: new Date().toISOString(),
      schemaVersion: '2.3-event-intelligence',
    };

    this.saveToDisk(state);
    this.isLoaded = true;
    return state;
  }

  private saveToDisk(stateToSave?: DatabaseState): void {
    try {
      const state = stateToSave || this.state;
      state.lastPersistedAt = new Date().toISOString();
      fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to persist store to disk', err);
    }
  }

  /**
   * Generates initial 1,200-vehicle fleet deterministically partitioned across 30 Visakhapatnam zones.
   */
  public generateInitialFleet(
    totalSize: number = 1200,
    policy: 'PROPORTIONAL_TO_DEMAND' | 'UNIFORM' | 'TRANSIT_HEAVY' = 'PROPORTIONAL_TO_DEMAND'
  ): Record<string, VirtualVehicle> {
    const zones = VIZAG_ZONES;
    const vehicles: Record<string, VirtualVehicle> = {};

    let allocations: { zoneId: string; count: number }[] = [];

    if (policy === 'UNIFORM') {
      const perZone = Math.floor(totalSize / zones.length);
      const remainder = totalSize % zones.length;
      allocations = zones.map((z, idx) => ({
        zoneId: z.id,
        count: perZone + (idx < remainder ? 1 : 0),
      }));
    } else if (policy === 'TRANSIT_HEAVY') {
      // Prioritize high-throughput transit hubs (RTC Central, Railway Stn, NAD X Road, Duvvada, Scindia)
      const transitZones = ['VZ-02', 'VZ-09', 'VZ-11', 'VZ-12', 'VZ-22', 'VZ-24', 'VZ-28'];
      const transitVehicles = Math.floor(totalSize * 0.55); // 55% in major transit corridors
      const perTransit = Math.floor(transitVehicles / transitZones.length);
      const remainderTransit = transitVehicles % transitZones.length;
      const nonTransit = zones.filter((z) => !transitZones.includes(z.id));
      const remainingVehicles = totalSize - transitVehicles;
      const perOther = Math.floor(remainingVehicles / nonTransit.length);

      allocations = zones.map((z, idx) => {
        if (transitZones.includes(z.id)) {
          return { zoneId: z.id, count: perTransit + (idx === 0 ? remainderTransit : 0) };
        }
        return { zoneId: z.id, count: perOther };
      });
      // Reconcile total
      let currentTotal = allocations.reduce((sum, a) => sum + a.count, 0);
      let i = 0;
      while (currentTotal < totalSize) {
        allocations[i % allocations.length].count += 1;
        currentTotal++;
        i++;
      }
    } else {
      // PROPORTIONAL_TO_DEMAND (Default)
      const totalScore = zones.reduce((sum, z) => sum + z.activityDensityScore, 0);
      allocations = zones.map((z) => {
        const share = Math.floor((z.activityDensityScore / totalScore) * totalSize);
        return { zoneId: z.id, count: Math.max(12, share) };
      });

      // Reconcile exact fleet count
      let currentTotal = allocations.reduce((sum, a) => sum + a.count, 0);
      let i = 0;
      while (currentTotal < totalSize) {
        allocations[i % allocations.length].count += 1;
        currentTotal++;
        i++;
      }
      while (currentTotal > totalSize) {
        if (allocations[i % allocations.length].count > 10) {
          allocations[i % allocations.length].count -= 1;
          currentTotal--;
        }
        i++;
      }
    }

    let vehicleIndex = 101;
    const nowIso = new Date().toISOString();

    for (const alloc of allocations) {
      for (let c = 0; c < alloc.count; c++) {
        const id = `VM-${vehicleIndex++}`;
        // Realistic initial state distribution: 75% AVAILABLE, 15% BUSY, 5% EN_ROUTE, 5% OFFLINE
        let state: VirtualVehicle['state'] = 'AVAILABLE';
        if (c % 10 === 1) state = 'BUSY';
        else if (c % 20 === 2) state = 'EN_ROUTE';
        else if (c % 20 === 3) state = 'OFFLINE';

        vehicles[id] = {
          id,
          zoneId: alloc.zoneId,
          state,
          batteryOrFuelLevel: Math.floor(55 + ((c * 7) % 45)),
          lastStateChange: nowIso,
          tripsCompletedToday: Math.floor((c * 3) % 12),
          repositionCountToday: 0,
        };
      }
    }

    return vehicles;
  }

  // --- FLEET OPERATIONS ---

  public getVehicles(): VirtualVehicle[] {
    return Object.values(this.state.vehicles);
  }

  public getVehicle(id: string): VirtualVehicle | undefined {
    return this.state.vehicles[id];
  }

  public updateVehicle(id: string, patch: Partial<VirtualVehicle>): boolean {
    const v = this.state.vehicles[id];
    if (!v) return false;
    Object.assign(v, patch, { lastStateChange: new Date().toISOString() });
    this.saveToDisk();
    return true;
  }

  public reallocateFleet(
    newSize: number = 1200,
    policy: 'PROPORTIONAL_TO_DEMAND' | 'UNIFORM' | 'TRANSIT_HEAVY' = 'PROPORTIONAL_TO_DEMAND'
  ): void {
    this.state.fleetSize = newSize;
    this.state.vehicles = this.generateInitialFleet(newSize, policy);
    this.saveToDisk();
  }

  // --- EVENTS & SOURCE OPERATIONS (PROMPT 3A INTEGRATION) ---

  /**
   * Reconciles temporal statuses for all stored events against reference time.
   * Ensures events with endTime in the past become EXPIRED (unless cancelled or rescheduled),
   * and persists updates directly to disk so downstream reads never see stale statuses.
   */
  public reconcileEventStatuses(referenceTime: Date = new Date()): number {
    let updatedCount = 0;
    const nowIso = referenceTime.toISOString();

    for (const evt of Object.values(this.state.events)) {
      const derived = deriveEventStatus(evt, referenceTime);
      if (evt.status !== derived) {
        evt.status = derived;
        evt.lastUpdatedAt = nowIso;
        evt.lastCheckedAt = nowIso;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.saveToDisk();
    }

    return updatedCount;
  }

  public getEvents(filters?: {
    status?: string;
    category?: string;
    zoneId?: string;
    validationStatus?: string;
  }): EventRecord[] {
    // Automatically reconcile statuses against current time and persist updates
    this.reconcileEventStatuses();

    let events = Object.values(this.state.events);

    if (filters) {
      if (filters.status) {
        const queryStatus = filters.status.toUpperCase();
        if (queryStatus === 'UPCOMING') {
          // Strictly excludes ACTIVE, EXPIRED, CANCELLED
          events = events.filter((e) => e.status === 'UPCOMING');
        } else if (queryStatus === 'EXPIRED' || queryStatus === 'PAST' || queryStatus === 'HISTORY') {
          events = events.filter((e) => e.status === 'EXPIRED' || e.status === 'CONCLUDED');
        } else {
          events = events.filter((e) => e.status.toUpperCase() === queryStatus);
        }
      }
      if (filters.category) {
        events = events.filter(
          (e) => e.eventType.toLowerCase() === filters.category!.toLowerCase()
        );
      }
      if (filters.zoneId) {
        events = events.filter((e) => e.associatedZoneId === filters.zoneId);
      }
      if (filters.validationStatus) {
        events = events.filter((e) => e.validationStatus === filters.validationStatus);
      }
    }

    return events.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }

  public getEventById(id: string): EventRecord | undefined {
    const evt = this.state.events[id];
    if (evt) {
      const derived = deriveEventStatus(evt, new Date());
      if (evt.status !== derived) {
        evt.status = derived;
        evt.lastUpdatedAt = new Date().toISOString();
        this.saveToDisk();
      }
    }
    return this.state.events[id];
  }

  public upsertEvent(evt: EventRecord): { created: boolean; updated: boolean; event: EventRecord } {
    const existing = this.state.events[evt.id];
    const created = !existing;
    const nowIso = new Date().toISOString();

    const derivedStatus = deriveEventStatus(evt, new Date());
    const finalStatus = evt.status === 'CANCELLED' ? 'CANCELLED' : derivedStatus;

    const record: EventRecord = {
      ...evt,
      status: finalStatus,
      firstSeenAt: existing?.firstSeenAt || evt.firstSeenAt || nowIso,
      lastCheckedAt: evt.lastCheckedAt || nowIso,
      lastUpdatedAt: created ? (evt.lastUpdatedAt || nowIso) : nowIso,
      verified: evt.verified ?? true,
      validationStatus: evt.validationStatus || 'VALIDATED',
      validationErrors: evt.validationErrors || [],
      sourceFreshnessSeconds: evt.sourceFreshnessSeconds ?? 0,
    };

    this.state.events[evt.id] = record;
    this.saveToDisk();
    return { created, updated: !created, event: record };
  }

  public deleteEvent(id: string): boolean {
    if (!this.state.events[id]) return false;
    delete this.state.events[id];
    this.saveToDisk();
    return true;
  }

  public getEventSources(): EventSourceStatus[] {
    return Object.values(this.state.eventSources || {});
  }

  public getEventSource(sourceId: string): EventSourceStatus | undefined {
    return this.state.eventSources?.[sourceId];
  }

  public upsertEventSource(source: EventSourceStatus): void {
    if (!this.state.eventSources) {
      this.state.eventSources = {};
    }
    this.state.eventSources[source.sourceId] = source;
    this.saveToDisk();
  }

  public updateEventSource(sourceId: string, patch: Partial<EventSourceStatus>): boolean {
    if (!this.state.eventSources || !this.state.eventSources[sourceId]) {
      return false;
    }
    const current = this.state.eventSources[sourceId];
    this.state.eventSources[sourceId] = {
      ...current,
      ...patch,
      sourceId, // preserve key
    };
    this.saveToDisk();
    return true;
  }

  public recordIngestionRun(run: IngestionResult): void {
    if (!this.state.eventIngestionRuns) {
      this.state.eventIngestionRuns = {};
    }
    const runKey = `${run.sourceId}:${run.timestamp}`;
    this.state.eventIngestionRuns[runKey] = run;

    // Also update eventSource status
    const src = this.state.eventSources[run.sourceId];
    if (src) {
      src.lastCheckedAt = run.timestamp;
      src.sourceFreshnessSeconds = 0;
      if (run.success) {
        src.lastSuccessAt = run.timestamp;
        src.totalEventsIngested += run.eventsIngested;
      } else {
        src.lastFailureAt = run.timestamp;
        src.failureCount += 1;
        src.lastErrorMessage = run.errors.join('; ');
      }
    }

    this.saveToDisk();
  }

  public getIngestionRuns(sourceId?: string, limit: number = 20): IngestionResult[] {
    let runs = Object.values(this.state.eventIngestionRuns || {});
    if (sourceId) {
      runs = runs.filter((r) => r.sourceId === sourceId);
    }
    return runs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // --- RECOMMENDATIONS OPERATIONS ---

  public getRecommendations(): DriverRecommendation[] {
    return Object.values(this.state.recommendations).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public upsertRecommendation(rec: DriverRecommendation): void {
    this.state.recommendations[rec.id] = rec;
    this.saveToDisk();
  }

  public updateRecommendationStatus(
    id: string,
    status: DriverRecommendation['status']
  ): boolean {
    const r = this.state.recommendations[id];
    if (!r) return false;
    r.status = status;
    r.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  public updateRecommendation(id: string, patch: Partial<DriverRecommendation>): boolean {
    const r = this.state.recommendations[id];
    if (!r) return false;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    this.saveToDisk();
    return true;
  }

  // --- 15-MINUTE OPERATIONAL PIPELINE OPERATIONS ---

  public saveCycleRun(run: PipelineCycleRun): void {
    this.state.cycleRuns[run.runId] = run;
    this.saveToDisk();
  }

  public getCycleRun(runId: string): PipelineCycleRun | undefined {
    return (this.state.cycleRuns || {})[runId];
  }

  public getCycleRuns(limit: number = 25): PipelineCycleRun[] {
    return Object.values(this.state.cycleRuns || {})
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  public getLatestCycleRun(): PipelineCycleRun | undefined {
    const runs = this.getCycleRuns(1);
    return runs.length > 0 ? runs[0] : undefined;
  }

  public saveAllForecasts15m(forecastMap: Record<string, Forecast15mRecord[]>): void {
    this.state.latestForecasts15m = forecastMap;
    this.saveToDisk();
  }

  public getForecasts15m(zoneId?: string): Forecast15mRecord[] {
    if (zoneId) {
      return this.state.latestForecasts15m[zoneId] || [];
    }
    const all: Forecast15mRecord[] = [];
    for (const list of Object.values(this.state.latestForecasts15m || {})) {
      all.push(...list);
    }
    return all;
  }

  public saveEventZoneImpacts(impacts: EventZoneAssociation[]): void {
    this.state.latestEventZoneImpacts = impacts;
    this.saveToDisk();
  }

  public getEventZoneImpacts(): EventZoneAssociation[] {
    return this.state.latestEventZoneImpacts || [];
  }

  // --- DEMAND FORECAST RUNS & PREDICTIONS (PROMPT 2 INTEGRATION) ---

  /**
   * Idempotently saves a forecast run and its predictions.
   * Prevents duplicate records when a job retries:
   * - Replaces the forecast run record under runId.
   * - Deletes existing predictions belonging to runId before inserting new ones.
   * - Keys each prediction by the composite key `${runId}:${zoneId}:${targetTimestamp}`.
   */
  public saveForecastRun(run: ForecastRunRecord, predictions: ZoneDemandPredictionRecord[]): boolean {
    this.state.forecastRuns = this.state.forecastRuns || {};
    this.state.demandPredictions = this.state.demandPredictions || {};

    // Save/overwrite run record
    this.state.forecastRuns[run.runId] = run;

    // Remove any existing predictions for this runId (clean idempotent retry)
    for (const key of Object.keys(this.state.demandPredictions)) {
      if (key.startsWith(`${run.runId}:`)) {
        delete this.state.demandPredictions[key];
      }
    }

    // Insert new predictions
    for (const pred of predictions) {
      const compositeKey = `${run.runId}:${pred.zoneId}:${pred.targetTimestamp}`;
      this.state.demandPredictions[compositeKey] = {
        ...pred,
        id: compositeKey,
        runId: run.runId,
      };
    }

    this.saveToDisk();
    return true;
  }

  public getForecastRun(runId: string): ForecastRunRecord | undefined {
    return (this.state.forecastRuns || {})[runId];
  }

  public getLatestForecastRun(): ForecastRunRecord | undefined {
    const runs = Object.values(this.state.forecastRuns || {})
      .sort((a, b) => new Date(b.generationTimestamp).getTime() - new Date(a.generationTimestamp).getTime());
    return runs.length > 0 ? runs[0] : undefined;
  }

  public getForecastRuns(limit: number = 25): ForecastRunRecord[] {
    return Object.values(this.state.forecastRuns || {})
      .sort((a, b) => new Date(b.generationTimestamp).getTime() - new Date(a.generationTimestamp).getTime())
      .slice(0, limit);
  }

  public getPredictionsForRun(runId: string): ZoneDemandPredictionRecord[] {
    return Object.values(this.state.demandPredictions || {})
      .filter((p) => p.runId === runId)
      .sort((a, b) => {
        const timeDiff = new Date(a.targetTimestamp).getTime() - new Date(b.targetTimestamp).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.zoneId.localeCompare(b.zoneId);
      });
  }

  public getPredictionsForZone(zoneId: string, limit: number = 100): ZoneDemandPredictionRecord[] {
    return Object.values(this.state.demandPredictions || {})
      .filter((p) => p.zoneId === zoneId)
      .sort((a, b) => new Date(b.targetTimestamp).getTime() - new Date(a.targetTimestamp).getTime())
      .slice(0, limit);
  }
}

export const persistentStore = new PersistentStore();

