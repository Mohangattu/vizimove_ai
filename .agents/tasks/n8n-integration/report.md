# n8n Integration Report — ViziMove AI

## 1. Route Chosen and Why

**Route:** `POST /api/events/ingest`

This is the natural trigger point for n8n event intelligence. It runs after every ingestion cycle (single-source or all-sources), is already protected by `requireAuth`, and is `async` — making it straightforward to append a fire-and-forget side-effect without altering the response. The notification is non-blocking: it does not `await` the fetch call, so it never delays the HTTP response to the caller.

---

## 2. Exact Diff (lines added in server.ts)

Two self-contained n8n blocks were inserted — one in each branch of the `if (sourceId)` / `else` conditional — immediately after the respective `res.json(...)` call and before the closing `} catch` block.

### sourceId branch (after `res.json({ success: result.success, ... run: result })`)

```typescript
// Fire-and-forget n8n notification (optional — skipped if N8N_WEBHOOK_URL not set)
{
  const _n8nUrl1 = process.env.N8N_WEBHOOK_URL;
  if (_n8nUrl1) {
    const _payload1 = JSON.stringify({
      trigger: 'events/ingest',
      timestamp: new Date().toISOString(),
      sourceId: req.body.sourceId,
      success: result.success,
      eventsIngested: result.eventsIngested ?? 0,
    });
    Promise.race<Response>([
      fetch(_n8nUrl1, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: _payload1 }),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
      .then(() => console.log('[n8n] Ingest notification sent'))
      .catch((e: unknown) => console.error('[n8n] Ingest notification error:', (e as Error)?.message ?? e));
  }
}
```

### all-sources branch (after `res.json({ success: allSuccessful, ... results })`)

```typescript
// Fire-and-forget n8n notification (optional — skipped if N8N_WEBHOOK_URL not set)
{
  const _n8nUrl2 = process.env.N8N_WEBHOOK_URL;
  if (_n8nUrl2) {
    const _payload2 = JSON.stringify({
      trigger: 'events/ingest',
      timestamp: new Date().toISOString(),
      totalIngested,
      totalUpdated,
      totalSkipped,
      success: allSuccessful,
      sourceCount: results.length,
    });
    Promise.race<Response>([
      fetch(_n8nUrl2, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: _payload2 }),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
      .then(() => console.log('[n8n] Ingest notification sent'))
      .catch((e: unknown) => console.error('[n8n] Ingest notification error:', (e as Error)?.message ?? e));
  }
}
```

---

## 3. Env Var to Add to `.env`

Add this line to your local `.env` file (never commit real values):

```
N8N_WEBHOOK_URL=http://localhost:5678/webhook-test/vizimove
```

Omit or leave empty to disable n8n notifications with zero impact on ingest behavior.

---

## 4. Step-by-Step Test Instructions (PowerShell)

```powershell
# Step 1: Read your API key from .env
$apiKey = (Get-Content d:\viz\.env | Where-Object { $_ -match '^VIZIMOVE_API_KEY=' }) -replace '^VIZIMOVE_API_KEY="?(.+?)"?$', '$1'

# Step 2: Start the server (in a separate terminal)
cd d:\viz && npm run dev

# Step 3: Trigger the ingest endpoint
Invoke-WebRequest -Uri 'http://localhost:3000/api/events/ingest' `
  -Method POST `
  -Headers @{ 'Content-Type' = 'application/json'; 'X-Api-Key' = $apiKey } `
  -Body '{"sourceId": "SRC-ACA-01"}'

# Step 4: Check server console for one of:
#   [n8n] Ingest notification sent            <- n8n IS running
#   [n8n] Ingest notification error: ...      <- n8n is NOT running (still returns 200)
```

---

## 5. Expected Behavior

| Scenario | Server log | HTTP response |
|---|---|---|
| n8n IS running on port 5678 | `[n8n] Ingest notification sent` | HTTP 200, ingestion results unchanged |
| n8n is NOT running | `[n8n] Ingest notification error: fetch failed` (or `timeout`) | HTTP 200, ingestion results unchanged |
| `N8N_WEBHOOK_URL` not set in `.env` | *(no n8n log lines)* | HTTP 200, ingestion results unchanged |

The n8n call is fully transparent to the API caller — the response shape, status codes, and timing are unaffected whether n8n is running or not.

---

## 6. Files Changed

| File | Change |
|---|---|
| `server.ts` | Added two fire-and-forget n8n notification blocks in `POST /api/events/ingest` |
| `.env.example` | Added `N8N_WEBHOOK_URL` variable with documentation comment |
| `.agents/tasks/n8n-integration/report.md` | This report (created) |
