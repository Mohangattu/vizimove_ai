# ViziMove AI — n8n Automated Event Intelligence Workflow

This directory contains the production-grade, importable **n8n Workflow** for automating the 30-minute event collection and ingestion cycle for ViziMove AI in Visakhapatnam, India.

---

## 1. Operational Overview

* **Cadence:** Triggers automatically every 30 minutes via cron (`*/30 * * * *`).
* **Source Discovery:** Queries `GET /api/events/sources?activeOnly=true` to dynamically retrieve only enabled sources without requiring code changes.
* **Extraction:** Connects to the six configured Visakhapatnam public event sources (ACA, ENC Navy, AU Registrar, GVMC Commercial, Simhachalam Devasthanam, ITAAP).
* **Pagination Support:** For registries supporting pagination (AU Gazette, GVMC Trade Permits), pagination metadata (`page`, `pageSize`, `totalPages`, `hasMore`) is tracked and honored.
* **Normalization & Validation:** Translates source data into the unified `EventRecord` contract, normalizes time zones (e.g. Indian Standard Time `+05:30` -> UTC `Z`), and enforces **Requirement 7** (preserves missing coordinates and attendance as `null` and `'UNKNOWN'`).
* **Authoritative Deduplication:** Dispatches batches to `POST /api/events/batch`. The backend applies deterministic key generation, preserves `firstSeenAt`, bumps `lastUpdatedAt` on modifications, and audits rescheduling history.
* **Health & Status Reporting:** Reports execution duration, record counts, and errors per source to `POST /api/events/sources/:sourceId/status`.
* **Bounded Retries & Timeouts:** HTTP requests feature explicit timeouts (10s for source retrieval, 15s for batch posting, 8s for status recording) and bounded retries (2 attempts with exponential backoff).
* **Fault Isolation & Continuation:** Each source is handled independently via switch routing with local `try/catch` isolation; if one source adapter encounters network or parsing errors, the remaining sources continue uninterrupted.
* **Overlap Protection:** Configured with `executionTimeout: 900` (15 minutes maximum runtime) to strictly guarantee that no job execution overlaps with the subsequent 30-minute cycle.

---

## 2. File Manifest

* `vizimove_event_intelligence_workflow.json`: Complete, native n8n workflow definition ready for direct UI import.
* `example_payloads.json`: Example raw source inputs alongside their normalized `EventRecord` outputs for all six authentic Visakhapatnam sources.
* `README.md`: This deployment, configuration, and verification manual.

---

## 3. Required Environment Variables & Authentication Credentials

All mutating backend endpoints (`POST /api/events/batch`, `POST /api/events/sources/:sourceId/status`, etc.) are protected and require a valid `X-API-Key` matching the server's `VIZIMOVE_API_KEY`. Public read-only endpoints (e.g. `GET /api/events/sources?activeOnly=true`) remain accessible without credentials.

### Mechanism A: Environment Variable Integration (Default Workflow Configuration)
Set these variables in your n8n environment (e.g., in `.env`, Docker Compose, or container environment):

| Variable | Required | Default Value | Description |
|---|---|---|---|
| `VIZIMOVE_BACKEND_URL` | Yes | `http://localhost:3000` | The root URL of the ViziMove AI backend |
| `VIZIMOVE_API_KEY` | **Yes (for mutations)** | *(Must match server)* | Secret key sent via `X-API-Key` header |
| `N8N_DEFAULT_TIMEZONE` | Recommended | `Asia/Kolkata` | Local timezone set to Indian Standard Time (IST) |

The workflow definition (`n8n/vizimove_event_intelligence_workflow.json`) automatically evaluates:
```json
{
  "name": "X-API-Key",
  "value": "={{ $env.VIZIMOVE_API_KEY || '' }}"
}
```
on all HTTP Request nodes that mutate backend data.

### Mechanism B: n8n Native Credential Vault (Header Auth)
For production deployments utilizing n8n's encrypted credential manager:
1. Open n8n -> **Credentials** -> **Add Credential**.
2. Select **Header Auth**.
3. Credential Name: `ViziMove Backend API Key`.
4. Header Name: `X-API-Key`.
5. Header Value: Enter your secret API key (matching `VIZIMOVE_API_KEY` on the ViziMove server).
6. In the workflow, open the HTTP Request nodes:
   - `POST Validated Batch to Backend`
   - `Report Source Status & Health`
   - `Record Empty Source Check`
7. Under **Authentication**, select **Generic Credential Type** -> **Header Auth** and choose `ViziMove Backend API Key`.

---

## 4. Backend API Contract

### A. Dynamic Sources Configuration
* **Endpoint:** `GET /api/events/sources?activeOnly=true`
* **Response:**
  ```json
  {
    "sources": [
      {
        "sourceId": "SRC-ACA-01",
        "sourceName": "Andhra Cricket Association (ACA) Official Fixtures Desk",
        "sourceUrl": "https://andhracricketassociation.com/fixtures",
        "adapterType": "STRUCTURED_GAZETTE",
        "rateLimitPerMinute": 30,
        "isActive": true,
        "failureCount": 0
      }
    ],
    "configuredAdaptersCount": 6
  }
  ```

### B. Dynamic Source Reconfiguration (Runtime Control)
* **Endpoint:** `PATCH /api/events/sources/:sourceId`
* **Payload:**
  ```json
  {
    "isActive": false,
    "rateLimitPerMinute": 15
  }
  ```
* **Effect:** Disables or throttles a source immediately without modifying core TypeScript/Python code.

### C. Batch Event Ingestion
* **Endpoint:** `POST /api/events/batch`
* **Payload:**
  ```json
  {
    "sourceId": "SRC-ACA-01",
    "events": [
      {
        "sourceEventId": "ACA-2026-RNJ-04",
        "name": "IPL / Ranji Trophy Cricket Match: Andhra vs Hyderabad",
        "venueName": "ACA-VDCA International Cricket Stadium",
        "eventType": "Sports",
        "latitude": 17.8085,
        "longitude": 83.3542,
        "associatedZoneId": "VZ-06",
        "startTime": "2026-11-20T19:00:00.000Z",
        "endTime": "2026-11-20T23:00:00.000Z",
        "estimatedAttendance": 28000,
        "attendanceType": "CONFIRMED",
        "status": "UPCOMING",
        "radiusKm": 6.5,
        "peakDemandMultiplier": 1.65
      }
    ],
    "metadata": {
      "workflowExecutionId": "12345"
    }
  }
  ```
* **Response:**
  ```json
  {
    "success": true,
    "sourceId": "SRC-ACA-01",
    "totalProcessed": 1,
    "eventsIngested": 1,
    "eventsUpdated": 0,
    "eventsSkipped": 0,
    "errors": [],
    "durationMs": 8,
    "processedEvents": [
      { "id": "EVT-SRC-ACA-01-ACA-2026-RNJ-04", "action": "CREATED" }
    ],
    "timestamp": "2026-10-18T10:00:00.000Z"
  }
  ```

### D. Per-Source Health & Audit Logging
* **Endpoint:** `POST /api/events/sources/:sourceId/status`
* **Payload:**
  ```json
  {
    "success": true,
    "eventsIngested": 1,
    "eventsUpdated": 0,
    "eventsSkipped": 0,
    "durationMs": 350,
    "errors": []
  }
  ```

---

## 5. Deployment & Activation Instructions

1. **Launch n8n:** Access your n8n web dashboard (e.g. `http://localhost:5678`).
2. **Import Workflow:**
   * Click **Workflows** -> **Import from File...**
   * Select `n8n/vizimove_event_intelligence_workflow.json`.
3. **Configure Environment:** Ensure `VIZIMOVE_BACKEND_URL` is configured in your n8n settings or replace the parameter defaults with your deployed URL.
4. **Manual Test Run:** Click **Test Workflow** in the n8n editor. Verify that:
   * "Fetch Enabled Sources" retrieves all 6 sources.
   * "Normalize & Validate Event Records" cleanses coordinates and timestamps.
   * "POST Validated Batch to Backend" receives HTTP 200 with `success: true`.
5. **Activate:** Toggle the **Active** switch in the top-right corner to start the recurring 30-minute schedule.

---

## 6. Verification and Test Procedure

### A. Local Automated Validation
Run the n8n workflow verification script locally:
```bash
npx tsx tests/validate_n8n_workflow.ts
```
This automated test validates:
1. Valid JSON syntax and n8n workflow schema.
2. Unique node identifiers and valid node connection targets.
3. Presence of schedule trigger configured for 30-minute intervals (`*/30 * * * *`).
4. Overlap prevention setting (`executionTimeout: 900` seconds).
5. All 6 authentic Visakhapatnam sources configured in the switch router and collector nodes.
6. Proper preservation of unknown coordinates and attendance (Requirement 7) in the normalization logic.
7. Correct backend API endpoint bindings (`/api/events/sources`, `/api/events/batch`, `/api/events/sources/:sourceId/status`).
8. Zero hardcoded plain-text credentials or API keys.

### B. Live Ingestion Verification (via curl)
Verify that the ViziMove backend responds to the workflow endpoints:
```bash
# 0. Export your configured API key
export VIZIMOVE_API_KEY="vizimove_secret_api_key_example"

# 1. Fetch enabled sources (Public Read-Only — no auth required)
curl -s http://localhost:3000/api/events/sources?activeOnly=true

# 2. Ingest a sample batch (Protected Mutation — requires valid X-API-Key)
curl -s -X POST http://localhost:3000/api/events/batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $VIZIMOVE_API_KEY" \
  -d '{
    "sourceId": "SRC-ACA-01",
    "events": [{
      "sourceEventId": "ACA-TEST-01",
      "name": "Ranji Match Test Event",
      "venueName": "ACA-VDCA Stadium",
      "startTime": "2026-11-20T19:00:00.000Z",
      "endTime": "2026-11-20T23:00:00.000Z"
    }]
  }'

# 3. Report source status (Protected Mutation — requires valid X-API-Key)
curl -s -X POST http://localhost:3000/api/events/sources/SRC-ACA-01/status \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $VIZIMOVE_API_KEY" \
  -d '{"success": true, "eventsIngested": 1, "durationMs": 42}'

# 4. Prove authentication enforcement (Omitting X-API-Key returns HTTP 401)
curl -s -i -X POST http://localhost:3000/api/events/batch \
  -H "Content-Type: application/json" \
  -d '{"sourceId": "SRC-ACA-01", "events": []}'
# Response: HTTP/1.1 401 Unauthorized {"error":"Missing X-API-Key header for protected mutation endpoint.","code":"MISSING_API_KEY"}
```

---

## 7. What Was Tested vs What Requires a Live n8n Instance

### Tested & Verified Locally:
* **JSON Structure & Integrity:** Full parse and structural validation of `n8n/vizimove_event_intelligence_workflow.json`.
* **Node Connection Graph:** All connections resolve to actual, unique node names without dangling references or dead loops.
* **Source Coverage:** All 6 Visakhapatnam sources (SRC-ACA-01 through SRC-ITAAP-06) verified in routing rules and adapter code.
* **Backend Endpoint Alignment:** Verified request/response compatibility against `server.ts` routes (`/api/events/sources`, `/api/events/batch`, `/api/events/sources/:sourceId/status`).
* **Requirement 7 Integrity:** Normalization script verifies that missing coordinates and attendance remain `null` and `'UNKNOWN'`.
* **Execution Timeout:** Overlap protection verified (`executionTimeout: 900`).
* **Secret Protection:** Zero hardcoded tokens or API keys verified across all nodes.

### Requires Live n8n Instance:
* **Cron Firing in Production:** Actual invocation of `scheduleTrigger` every 30 minutes in a running n8n daemon.
* **Network Connectivity:** Live HTTP communication between the n8n container/host and the ViziMove backend.
* **Credential Vault Binding:** Binding live Header Auth or OAuth credentials from the n8n UI.
* **Active Status State:** Toggling the workflow to `active: true` in the n8n database.

---

## 8. Coverage & Data Source Limitations

ViziMove AI adheres strictly to authorized data collection:
* **No Uncontrolled Scraping:** Does not crawl generic search engines or arbitrary web pages.
* **Authoritative Grounding:** Limited to the 6 configured Visakhapatnam sources (ACA, ENC Navy, AU Registrar, GVMC Commercial, Simhachalam Devasthanam, ITAAP).
* **Missing Data Integrity:** Unknown crowd sizes and coordinates are preserved as `null` rather than estimated synthetically.
