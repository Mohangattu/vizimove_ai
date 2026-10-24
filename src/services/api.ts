/**
 * ViziMove AI — API Client Service
 * Strongly-typed API client fetching genuine backend endpoints.
 * Includes automatic same-origin CSRF/Session handling for browser mutations.
 * Never stores, reads, or exposes privileged server-side API keys.
 */

import {
  ZoneRecord,
  ForecastRecord,
  ModelEvaluationMetrics,
  EventRecord,
  VirtualVehicle,
  SupplyDemandAnalysis,
  DriverRecommendation,
  OperationsSummary,
  DataSourceProvenance,
  ForecastRunRecord,
  ZoneDemandPredictionRecord,
  Genuine15mRequirementAnalysis,
} from '../lib/types';
import { SystemHealthStatus } from '../lib/provenance';
import { CalibrationEvidence } from '../lib/calibration';

interface CsrfSession {
  sessionId: string;
  csrfToken: string;
}

let activeSessionPromise: Promise<CsrfSession> | null = null;
let currentSession: CsrfSession | null = null;

/**
 * Initializes or retrieves a cached CSRF session token from the server.
 * Operates purely within the browser's same-origin cookie & session context.
 */
async function getOrCreateSession(refresh: boolean = false): Promise<CsrfSession> {
  if (currentSession && !refresh) {
    return currentSession;
  }

  if (!activeSessionPromise || refresh) {
    activeSessionPromise = (async () => {
      try {
        const res = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          currentSession = { sessionId: data.sessionId, csrfToken: data.csrfToken };
          return currentSession;
        }
      } catch (err) {
        console.error('[ViziMove AI] Failed to initialize browser CSRF session:', err);
      }
      return { sessionId: '', csrfToken: '' };
    })();
  }

  return activeSessionPromise;
}

/**
 * Centralized fetch helper providing strongly-typed JSON responses,
 * automatic same-origin session credentials, and CSRF token injection on mutations.
 */
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const headers = new Headers(options?.headers || {});

  if (isMutation) {
    const session = await getOrCreateSession();
    if (session.csrfToken) {
      headers.set('X-CSRF-Token', session.csrfToken);
    }
    if (session.sessionId) {
      headers.set('X-Session-ID', session.sessionId);
    }
  }

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  // If CSRF token was invalid/expired, refresh once and retry
  if (isMutation && (res.status === 401 || res.status === 403)) {
    try {
      const clone = res.clone();
      const errData = await clone.json();
      if (errData.code === 'CSRF_INVALID' || errData.code === 'SESSION_EXPIRED') {
        const refreshed = await getOrCreateSession(true);
        if (refreshed.csrfToken) {
          headers.set('X-CSRF-Token', refreshed.csrfToken);
        }
        if (refreshed.sessionId) {
          headers.set('X-Session-ID', refreshed.sessionId);
        }
        res = await fetch(url, {
          ...options,
          headers,
          credentials: 'same-origin',
        });
      }
    } catch {
      // not JSON, continue with original response
    }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error || data.message || msg;
    } catch {
      // response wasn't JSON
    }
    throw new Error(msg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON response but received ${contentType || 'non-JSON'} from ${url}`);
  }

  return res.json();
}

export const api = {
  // Health & Provenance
  async getHealth(): Promise<SystemHealthStatus> {
    return fetchJson<SystemHealthStatus>('/api/health');
  },

  async getProvenance(): Promise<{
    sources: DataSourceProvenance[];
    calibrationCoverage: {
      totalZones: number;
      calibratedCount: number;
      provisionalCount: number;
      isFullyCovered: boolean;
    };
    metadata: {
      platform: string;
      city: string;
      modelVersion: string;
      activeZones: number;
    };
  }> {
    return fetchJson('/api/provenance');
  },

  // Zones
  async getZones(): Promise<ZoneRecord[]> {
    return fetchJson<ZoneRecord[]>('/api/zones');
  },

  async getZone(id: string): Promise<ZoneRecord> {
    return fetchJson<ZoneRecord>(`/api/zones/${encodeURIComponent(id)}`);
  },

  // Demand & Forecasting
  async getForecastHorizon(hours: number = 12): Promise<{ timestamp: string; forecasts: ForecastRecord[] }[]> {
    return fetchJson(`/api/demand/forecast?hours=${hours}`);
  },

  async getForecast15mHorizon(intervals: number = 16): Promise<{ timestamp: string; forecasts: any[] }[]> {
    return fetchJson(`/api/demand/forecast-15m?intervals=${intervals}`);
  },

  async getSubhourlyModelMetrics(): Promise<any> {
    return fetchJson('/api/demand/metrics-15m');
  },

  async getHistoricalDemand(): Promise<{
    diurnalWeights: number[];
    source: string;
    coverage: string;
  }> {
    return fetchJson('/api/demand/historical');
  },

  async getModelMetrics(): Promise<ModelEvaluationMetrics> {
    return fetchJson<ModelEvaluationMetrics>('/api/model/metrics');
  },

  async getCalibrationEvidence(): Promise<{
    evidence: CalibrationEvidence[];
    coverage: any;
  }> {
    return fetchJson('/api/calibration');
  },

  // Demand Forecast Runs & Zone Integration
  async getForecastRuns(limit: number = 25): Promise<ForecastRunRecord[]> {
    return fetchJson<ForecastRunRecord[]>(`/api/demand/forecast/runs?limit=${limit}`);
  },

  async getForecastRunDetails(
    runId: string
  ): Promise<{ run: ForecastRunRecord; predictions: ZoneDemandPredictionRecord[] }> {
    return fetchJson(`/api/demand/forecast/runs/${encodeURIComponent(runId)}`);
  },

  async getForecastPredictionsForZone(
    zoneId: string,
    limit: number = 48
  ): Promise<ZoneDemandPredictionRecord[]> {
    return fetchJson(`/api/demand/forecast/predictions/${encodeURIComponent(zoneId)}?limit=${limit}`);
  },

  async executeForecastPipeline(
    horizonHours: number = 12,
    runId?: string
  ): Promise<{ success: boolean; run: ForecastRunRecord; predictionsCount: number }> {
    return fetchJson('/api/demand/forecast/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horizonHours, runId }),
    });
  },

  async get15mGapAnalysis(): Promise<Genuine15mRequirementAnalysis> {
    return fetchJson<Genuine15mRequirementAnalysis>('/api/demand/15m-gap-analysis');
  },

  // Events
  async getEvents(filters?: { status?: string; category?: string; zoneId?: string }): Promise<EventRecord[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.category) params.set('category', filters.category);
    if (filters?.zoneId) params.set('zoneId', filters.zoneId);
    params.set('_t', Date.now().toString());
    return fetchJson<EventRecord[]>(`/api/events?${params.toString()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
  },

  async getEventSources(activeOnly: boolean = false): Promise<any> {
    return fetchJson(`/api/events/sources${activeOnly ? '?activeOnly=true' : ''}`);
  },

  async triggerIngest(sourceId?: string): Promise<{
    success: boolean;
    message: string;
    eventsIngested?: number;
    eventsUpdated?: number;
    eventsSkipped?: number;
  }> {
    return fetchJson('/api/events/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sourceId ? { sourceId } : {}),
    });
  },

  async getEventImpacts(): Promise<any[]> {
    return fetchJson<any[]>('/api/events/impacts');
  },

  // Fleet
  async getFleet(): Promise<{
    summary: {
      total: number;
      available: number;
      busy: number;
      enRoute: number;
      offline: number;
      assigned: number;
      utilizationRate: number;
    };
    vehicles: VirtualVehicle[];
  }> {
    return fetchJson('/api/fleet');
  },

  async getActiveMovements(): Promise<VirtualVehicle[]> {
    return fetchJson<VirtualVehicle[]>('/api/fleet/movements');
  },

  async simulateStep(): Promise<{
    success: boolean;
    stepResult: { transitionedCount: number; timestamp: string };
    summary: any;
  }> {
    return fetchJson('/api/fleet/simulate-step', { method: 'POST' });
  },

  async reallocateFleet(policy: 'PROPORTIONAL_TO_DEMAND' | 'UNIFORM' | 'TRANSIT_HEAVY'): Promise<{
    success: boolean;
    policy: string;
    summary: any;
  }> {
    return fetchJson('/api/fleet/reallocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy }),
    });
  },

  // Supply Demand
  async getSupplyDemand(hourOffset: number = 0, capacity: number = 2.2): Promise<{
    targetTimestamp: string;
    capacityAssumption: number;
    zones: SupplyDemandAnalysis[];
  }> {
    return fetchJson(`/api/supply-demand?hourOffset=${hourOffset}&capacity=${capacity}`);
  },

  // Recommendations
  async getRecommendations(): Promise<DriverRecommendation[]> {
    return fetchJson<DriverRecommendation[]>('/api/recommendations');
  },

  async generateRecommendations(maxCount: number = 5): Promise<{
    success: boolean;
    generatedCount: number;
    recommendations: DriverRecommendation[];
  }> {
    return fetchJson('/api/recommendations/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxCount }),
    });
  },

  async dispatchRecommendation(id: string): Promise<{ success: boolean; recommendation: DriverRecommendation }> {
    return fetchJson(`/api/recommendations/${encodeURIComponent(id)}/dispatch`, { method: 'POST' });
  },

  async completeRecommendation(id: string): Promise<{ success: boolean; recommendation: DriverRecommendation }> {
    return fetchJson(`/api/recommendations/${encodeURIComponent(id)}/complete`, { method: 'POST' });
  },

  async cancelRecommendation(id: string): Promise<{ success: boolean; recommendation: DriverRecommendation }> {
    return fetchJson(`/api/recommendations/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },

  // Operations
  async getOperationsSummary(): Promise<OperationsSummary> {
    return fetchJson<OperationsSummary>('/api/operations/summary');
  },

  async askOperationalInquiry(queryType: string): Promise<{
    title: string;
    answer: string;
    evidence: Record<string, any>;
  }> {
    return fetchJson('/api/operations/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryType }),
    });
  },

  // 15-Minute Operational Pipeline
  async getPipelineStatus(): Promise<{
    isSchedulerActive: boolean;
    intervalMinutes: number;
    hourlyForecastScheduleMinutes?: number;
    isExecuting: boolean;
    nextRunScheduledAt: string | null;
    latestCompletedCycle?: any;
    latestHourlyForecastRun?: any;
    isHourlyForecastDue?: boolean;
  }> {
    return fetchJson('/api/pipeline/status');
  },

  async getPipelineHistory(limit: number = 25): Promise<any[]> {
    return fetchJson<any[]>(`/api/pipeline/history?limit=${limit}`);
  },

  async triggerPipelineCycle(): Promise<{ success: boolean; message: string; cycleRun: any }> {
    return fetchJson('/api/pipeline/trigger', { method: 'POST' });
  },

  async getDispatchStatus(): Promise<{
    autonomousDispatchEnabled: boolean;
    mode: string;
    lastCycleTimestamp: string | null;
    lastCycleId: string | null;
    dispatchedThisCycle: number;
    pendingCount: number;
    dispatchedCount: number;
    failedCount: number;
    enRouteVehicles: number;
  }> {
    return fetchJson('/api/dispatch/status');
  },

  // Database Visibility & Inspection Suite
  async getDbQueries(): Promise<{
    connection: {
      host: string;
      port: number;
      database: string;
      username: string;
      schema: string;
      clientToolsSupported: string[];
      psqlCommand: string;
    };
    sqlSuite: string;
    tableRegistry: string[];
  }> {
    return fetchJson('/api/db/queries');
  },

  async inspectDbTable(table: string): Promise<any[]> {
    return fetchJson<any[]>(`/api/db/inspect/${encodeURIComponent(table)}`);
  },
};
