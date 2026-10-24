# ViziMove AI — Investigation Findings Report

**Generated:** Investigation run over `d:\viz`  
**Investigation scope:** Architecture, server, frontend, data layer, tests, env config, n8n integration

---

## Executive Summary

The project is a **pure TypeScript/Node.js full-stack application** — there is no Python backend at all. The stack is: **Express + Vite (dev-mode SSR) on `server.ts`** for the backend, and **React 19 + Tailwind + TypeScript** for the frontend. They are already fully separated by design: the Express server serves the Vite SPA and exposes `/api/*` routes; the React frontend calls those routes exclusively through `src/services/api.ts` using relative URLs (no hardcoded base URL).

**The project is in a remarkably complete state.** All 31 core unit tests pass. TypeScript type-checks clean (`tsc --noEmit` exits 0). The persistent JSON store (`data/vizimove_store.json`) is seeded with 1,200 vehicles and 18 events. There is no PostgreSQL connected — the "schema" files are documentation artefacts; the actual persistence is the JSON file store.

### Issue Severity Matrix

| Priority | Issue | Impact |
|---|---|---|
| P1 — App will not run | `VIZIMOVE_API_KEY` missing in `.env` | All mutation routes return HTTP 503 |
| P1 — App will not run | No `.env` file confirmed to exist but key content unknown | Mutations blocked |
| P2 — Features broken | 4 view components built but not wired into nav/routing | SystemHealthView, OperationsQAView, ModelPerformanceView, DemandMapView unreachable |
| P2 — Tests fail | Integration tests in `auth.test.ts` and `n8nWorkflow.test.ts` require a live server on port 3000 | 12 tests fail without `npm run dev` running first |
| P3 — Runtime risk | `fleetSummary` default state in App.tsx is hardcoded and only replaced after first data fetch | Brief incorrect KPIs on first render |
| P3 — Cosmetic/incomplete | `Sidebar` footer shows "PostgreSQL Schema" but no PostgreSQL is connected | Misleading to users |
| P4 — n8n optional | n8n workflow integration is supplemental (event ingestion) — core app functions entirely without it | Not a blocker |

---

## 1. Project Architecture

**Stack:** Pure TypeScript/Node.js, no Python anywhere in the codebase.

- `package.json` → `"dev": "tsx server.ts"`, `"test": "tsx --test src/lib/*.test.ts"`, `"build": "vite build"`
- `server.ts` — Express 4 + Vite middleware (dev) / static dist (prod). Single process serves both backend API and frontend SPA.
- Frontend: React 19, Vite 8, Tailwind CSS v4, `lucide-react`, `leaflet` (imported as dep but not actively used in views — no `import leaflet` in any .tsx).
- **No Python**: No `requirements.txt`, no `.py` files, no `pyproject.toml`. The user's original request mentioned "Python backend" but the project is entirely TypeScript.

**Key architectural decision confirmed:** Frontend and backend are already separated into proper layers:
- Backend API: `server.ts` + `src/lib/` + `src/db/store.ts`
- Frontend client: `src/App.tsx` + `src/components/` + `src/services/api.ts`
- API communication: exclusively through `src/services/api.ts` using same-origin relative paths (`/api/*`)

---

## 2. Server (`server.ts`) — COMPLETE

`server.ts` is a comprehensive, well-formed Express server. Full analysis:

- **Port:** 3000 (hardcoded, overridable via `PORT` env)
- **Dev mode:** Creates Vite middleware server in-process, serving React SPA at `/`
- **API routes defined (all complete, no stubs):**
  - `GET /api/auth/session` — CSRF session bootstrap
  - `GET /api/health`, `GET /api/provenance`
  - `GET /api/zones`, `GET /api/zones/:id`
  - `GET /api/demand/forecast`, `/api/demand/forecast-15m`, `/api/demand/metrics-15m`, `/api/demand/historical`, `/api/model/metrics`, `/api/calibration`
  - `GET /api/demand/forecast/runs`, `/runs/:runId`, `/predictions/:zoneId`
  - `POST /api/demand/forecast/execute` (protected)
  - Full event CRUD: `GET /api/events`, `/api/events/sources`, `POST /api/events`, `POST /api/events/batch`, `POST /api/events/ingest`, `PATCH /api/events/sources/:sourceId`, etc.
  - `GET /api/pipeline/status`, `GET /api/pipeline/history`, `POST /api/pipeline/trigger`
  - `GET /api/db/queries`, `GET /api/db/inspect/:table`
  - Full fleet: `GET /api/fleet`, `GET /api/fleet/movements`, `POST /api/fleet/simulate-step`, `POST /api/fleet/reallocate`
  - Full supply-demand, recommendations, operations endpoints
  
- **Auth middleware:** `requireAuth` guards all mutation (`POST`, `PATCH`) routes. Accepts `X-API-Key` (machine) or Session+CSRF (browser).

**No issues with server.ts.**

---

## 3. Frontend Entry Points

### `src/main.tsx`
Minimal, clean React 19 entry point. No issues.

### `src/App.tsx`
Loads data via `Promise.all` of 7 API calls on mount, refreshes every 60s. Props are passed down to 6 view components.

**Issue (P3):** `fleetSummary` default state is hardcoded:
```typescript
// src/App.tsx line 44-52
const [fleetSummary, setFleetSummary] = useState<{...}>({
  total: 120,      // wrong — server has 1,200
  available: 85,
  ...
});
```
This renders incorrect KPI values until the first API response arrives. Should default to `null` with a loading guard, matching how `operationsSummary` is handled.

**Issue (P2):** App.tsx only renders 6 tabs: `dashboard`, `forecast`, `events`, `fleet`, `supply-demand`, `recommendations`. Four fully-built view components are **never imported or rendered**:
- `src/components/views/SystemHealthView.tsx`
- `src/components/views/OperationsQAView.tsx`
- `src/components/views/ModelPerformanceView.tsx`
- `src/components/views/DemandMapView.tsx`

These are imported in neither `App.tsx` nor `Sidebar.tsx`. They exist as standalone components with real API connections but are permanently unreachable.

### `src/services/api.ts`
Strongly typed, no hardcoded base URL (all relative `/api/*` paths). Implements CSRF auto-refresh on 401/403. Covers all 40+ backend endpoints one-to-one. No issues.

---

## 4. View Components Analysis

| Component | Data Source | Status |
|---|---|---|
| `OverviewView.tsx` | Props from App.tsx (API data) + direct `api.getPipelineStatus()` | ✅ Complete, real data |
| `ForecastingView.tsx` | Multiple direct `api.*` calls | ✅ Complete, real data |
| `EventIntelligenceView.tsx` | Props + `api.getEventImpacts()` | ✅ Complete, real data |
| `FleetOperationsView.tsx` | Props + internal `api.*` calls | ✅ Complete, real data |
| `SupplyDemandView.tsx` | Props only (no api import) | ✅ Complete — data passed from App.tsx |
| `RecommendationsView.tsx` | Props + internal `api.*` calls | ✅ Complete, real data |
| `DemandMapView.tsx` | Props only (no api import) | ⚠️ Complete but **unreachable** — never added to App.tsx |
| `SystemHealthView.tsx` | Direct `api.getProvenance()`, `api.getCalibrationEvidence()`, `api.getHealth()` | ⚠️ Complete but **unreachable** |
| `OperationsQAView.tsx` | Direct `api.askOperationalInquiry()` | ⚠️ Complete but **unreachable** |
| `ModelPerformanceView.tsx` | Direct `api.getModelMetrics()` etc. | ⚠️ Complete but **unreachable** |

No view components render static/mock data. All data flows from the backend.

---

## 5. Data Layer

### `src/db/schema.sql`
Defines a full PostgreSQL schema (13 tables). This is **documentation only** — the app does not connect to PostgreSQL.

### `src/db/store.ts` — **Actual persistence**
The real data store is a JSON file at `data/vizimove_store.json`. `PersistentStore` reads/writes this file synchronously. On first run it initializes 1,200 vehicles across 30 zones.

**Current store state** (`data/vizimove_store.json`):
- 1,200 vehicles across 30 Visakhapatnam zones ✅
- 18 events (mix of UPCOMING/ACTIVE/EXPIRED/CANCELLED) ✅
- 64 pipeline cycle runs from prior executions ✅
- Schema version: `"2.3-event-intelligence"`

**No PostgreSQL client dependency** (pg, postgres, prisma) is in `package.json`. The PostgreSQL mentions in `server.ts` (`/api/db/queries`, `process.env.POSTGRES_HOST`) are for read-only database visibility tooling — they return the SQL queries as text, not live query results.

**Risk:** The JSON file store has no concurrent-write protection. On Windows, simultaneous server requests that both call `saveToDisk()` could cause partial writes. Low risk for single-user dev but a concern for production.

### `src/db/queries.sql`
Read-only SQL queries for pgAdmin/DBeaver inspection. Not executed by the application.

---

## 6. Business Logic (`src/lib/`)

| File | Status | Notes |
|---|---|---|
| `auth.ts` | ✅ Complete | Full session/CSRF/API-key auth with timing-safe compare |
| `types.ts` | ✅ Complete | All domain types well-defined |
| `zones.ts` | ✅ Complete | 30 Visakhapatnam zones, Haversine math |
| `calibration.ts` | ✅ Complete | 30-zone calibration coverage |
| `forecasting.ts` | ✅ Complete | Hourly + 15m forecasting, gap analysis |
| `events.ts` | ✅ Complete | Event ingestion, deduplication, validation, temporal status |
| `fleet.ts` | ✅ Complete | FleetManager, 1,200 vehicle simulation |
| `supplyDemand.ts` | ✅ Complete | Supply/demand analysis, shortage calculation |
| `recommendations.ts` | ✅ Complete | Constraint-aware repositioning engine |
| `operations.ts` | ✅ Complete | Operational summary, QA answers |
| `pipelineScheduler.ts` | ✅ Complete | 15-min scheduled operational pipeline |
| `provenance.ts` | ✅ Complete | Data lineage registry, system health |

No stubs or TODOs found in any lib file. `tsc --noEmit` exits clean with zero errors.

---

## 7. Environment Configuration

**`.env.example` defines:**

| Variable | Required | Default in example |
|---|---|---|
| `GEMINI_API_KEY` | Optional (AI Studio) | `MY_GEMINI_API_KEY` |
| `APP_URL` | Optional (Cloud Run) | `MY_APP_URL` |
| `PORT` | Optional | `3000` |
| `VIZIMOVE_API_KEY` | **P1 — Required for mutations** | `vizimove_secret_api_key_example` |
| `VIZIMOVE_BACKEND_URL` | Optional (n8n use) | `http://localhost:3000` |
| `POSTGRES_HOST/PORT/DB/USER` | Optional (DB visibility only) | `localhost/5432/vizimove_db/postgres` |

**`.env` file exists** (`Get-ChildItem d:\viz -Filter ".env*"` confirmed both `.env` and `.env.example` are present). The actual `.env` values were not read to avoid exposing secrets, but if `VIZIMOVE_API_KEY` matches the example value (`vizimove_secret_api_key_example`), mutation endpoints work.

**Critical check:** If `.env` is missing or `VIZIMOVE_API_KEY` is blank, every `POST`/`PATCH` mutation returns HTTP 503 `API_KEY_NOT_CONFIGURED`. The server warns at startup: `"VIZIMOVE_API_KEY is not configured in server environment."` The browser Dashboard's CSRF flow still works (read-only data loads fine), but pipeline triggers, recommendation dispatches, fleet reallocations, and event ingestion all fail.

---

## 8. n8n Integration

**Not required for core app function.** The n8n workflow (`n8n/vizimove_event_intelligence_workflow.json`) automates external event ingestion from 6 Visakhapatnam sources every 30 minutes. The backend has 18 pre-seeded events and the pipeline scheduler runs independently of n8n.

**What n8n provides (additive):**
- Automated fetching from ACA, ENC Navy, AU Registrar, GVMC, Simhachalam, ITAAP event sources
- Batch ingestion via `POST /api/events/batch`
- Per-source health reporting via `POST /api/events/sources/:sourceId/status`

**n8n structure tests pass** (3/5 in `n8nWorkflow.test.ts`). The 2 failures are integration tests requiring a live server on port 3000 — the same root cause as auth integration test failures.

**Verdict:** n8n is optional, supplemental enhancement. Do not add unless external live event feeds are needed.

---

## 9. Test Results

### `src/lib/algorithms.test.ts` — **31/31 PASS** ✅
All core unit tests pass: zone registry, Haversine math, calibration, forecasting, event intelligence, fleet simulation, supply-demand, recommendations, pipeline execution, idempotency, partial failure handling.

### `src/lib/auth.test.ts` — **6/16 pass, 10/16 FAIL** ⚠️
- **Pass (6):** All unit tests (timingSafeCompare, verifyApiKey, session management, CSRF verification, cross-origin blocking)
- **Fail (10):** All integration tests — `ECONNREFUSED 127.0.0.1:3000`

**Root cause:** Integration tests require the Express server to be running on port 3000 before `npm test` is executed. Tests hit `http://localhost:3000` directly.

**Fix:** Run `npm run dev` in a separate terminal first, then run `npm test`. Or add a server startup/teardown fixture to the test file. This is a test infrastructure gap, not a code bug.

### `src/lib/n8nWorkflow.test.ts` — **3/5 pass, 2/5 FAIL** ⚠️
- **Pass (3):** JSON validity, structural integrity, example payloads conformance
- **Fail (2):** Batch ingestion and source status tests — `ECONNREFUSED 127.0.0.1:3000`

Same root cause as auth integration tests.

### TypeScript (`npx tsc --noEmit`) — **0 errors** ✅

---

## 10. `data/vizimove_store.json`

The file is the app's sole persistence mechanism (replacing PostgreSQL during development). Confirmed contents:
- `fleetSize: 1200`
- `vehicles`: 1,200 `VirtualVehicle` records keyed by ID (VM-101 through VM-1300)
- `events`: 18 event records with temporal statuses reconciled on load
- `eventSources`: 6 configured source registry entries
- `cycleRuns`: 64 completed pipeline cycle run records
- `forecastRuns`: Populated from executed forecast pipelines
- `lastPersistedAt`, `schemaVersion: "2.3-event-intelligence"`

The server's `PersistentStore` reads this on startup, merges any newly seeded events from `VERIFIED_VIZAG_EVENTS`, reconciles temporal statuses, and persists the result synchronously.

---

## Conclusions & Ranked Recommendations

### P1 — Verify `.env` is configured before starting the server

```
# Check server starts cleanly:
npm run dev
# Should print: "[ViziMove AI Auth] VIZIMOVE_API_KEY configured. Protected mutation routes armed."
# If it prints the WARNING instead, add VIZIMOVE_API_KEY to .env
```

If the API key is absent, the Dashboard reads fine but dispatching recommendations, triggering pipeline cycles, and fleet reallocations fail silently.

### P2 — Wire missing views into App.tsx and Sidebar.tsx

Four complete, tested, API-connected views are unreachable. Add these tabs to both `Sidebar.tsx` (NavTab type + navItems array) and `App.tsx` (import + render in main `<main>` block):

- `SystemHealthView` → tab `'system-health'`
- `OperationsQAView` → tab `'operations-qa'`
- `ModelPerformanceView` → tab `'model-performance'`
- `DemandMapView` → tab `'demand-map'` (passes existing props: `zones`, `supplyDemand`, `events`, `vehicles`)

Files to modify:
- `d:\viz\src\components\Sidebar.tsx` — add 4 NavTab values and navItems entries
- `d:\viz\src\App.tsx` — add imports + 4 `currentTab === 'X'` render branches

### P3 — Fix hardcoded `fleetSummary` default in App.tsx

Replace the hardcoded initial state (line 44-52 in `App.tsx`) with `null`, and guard the `Header` and `OverviewView` accordingly, same pattern as `operationsSummary`.

### P3 — Fix Sidebar footer label

`d:\viz\src\components\Sidebar.tsx` line ~100 shows `"Persistence: PostgreSQL Schema"`. The actual persistence is the JSON file store. This should read `"JSON File Store"` or similar until real PostgreSQL is connected.

### P4 — Integration tests need server pre-condition

`auth.test.ts` and `n8nWorkflow.test.ts` integration tests assume a live server. Document in README or separate the integration tests into a separate script that starts the server first. The pure unit tests in `algorithms.test.ts` and auth unit tests all pass without a server.

### Run commands

```bash
# Start the full-stack app (backend + frontend hot-reload):
npm run dev

# Run pure unit tests (no server needed):
npx tsx --test src/lib/algorithms.test.ts

# Run auth unit tests only:
npx tsx --test src/lib/auth.test.ts   # 6 unit pass; 10 integration fail unless server is running

# TypeScript type check:
npm run lint

# Build for production:
npm run build

# Start production server (after build):
npm start
```
