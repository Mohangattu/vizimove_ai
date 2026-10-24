# Implementation Plan — ViziMove AI Autonomous Dispatch

## Current Behaviour Summary

- `pipelineScheduler.ts` (Stage 6) already creates recommendations with `status: 'DISPATCHED'`
  and calls `globalFleetManager.assignRepositioning()` in the same cycle. This path is the
  PRIMARY operational dispatch path and is already autonomous.
- `recommendations.ts` (`RecommendationEngine`) is a LEGACY engine seeded once on server start.
  It creates `PENDING` recommendations and has a manual `dispatchRecommendation()` method.
  The dashboard still shows Dispatch/Approve buttons that call this manual method.
- `DriverRecommendation` type is missing: `dispatchedAt`, `dispatchError`, `autonomousDispatch`,
  `assignedVehicleIds` (distinct from `allocatedVehicleIds`), `dispatchLock`.
- `cancelRecommendation` in `recommendations.ts` does NOT release EN_ROUTE vehicles.
- No `GET /api/dispatch/status` endpoint exists.
- `OverviewView` has a manual "Dispatch Repositioning" button on recommendation cards.
- `RecommendationsView` has a manual Dispatch button for PENDING recommendations.
- `FleetOperationsView` does not label EN_ROUTE as simulated.

## Operational Constraints (actual configured values found in codebase)

| Constraint | Value | Source |
|---|---|---|
| Max distance km | 12.0 km | `pipelineScheduler.ts:254` |
| Travel time max (recommendations.ts) | 32 min | `recommendations.ts:88` |
| Source zone reserve (min surplus to leave) | 3 vehicles | `pipelineScheduler.ts:247` |
| Max take from source per move | `floor(surplus * 0.7)` | `pipelineScheduler.ts:261` |
| Batch size cap (vehicles per recommendation) | 15 | `pipelineScheduler.ts:261` |
| Min vehicles to dispatch | 2 | `pipelineScheduler.ts:264` |
| Battery/fuel minimum for dispatch | 20% | `fleet.ts:progressAutonomousMovements` |
| Trips per vehicle per 15m | 0.55 | `supplyDemand.ts TRIPS_PER_VEHICLE_15M` |
| Trips per vehicle per hour | 2.2 | `operations.ts` |

---

## Implementation Plan

- [ ] 1. Extend `DriverRecommendation` type in `src/lib/types.ts`

  **Current:** `DriverRecommendation` has `allocatedVehicleIds`, `status`, `reason` but is missing
  several fields needed for autonomous dispatch tracking.

  **Change:** Add these optional fields to the `DriverRecommendation` interface (do not remove existing fields):
  ```ts
  dispatchedAt?: string;           // ISO timestamp when autonomous dispatch completed
  dispatchError?: string;          // Last actionable error message if dispatch failed
  autonomousDispatch?: boolean;    // true = dispatched by pipeline without human approval
  dispatchLock?: boolean;          // in-memory guard; not persisted (handled via status check)
  ```
  Note: `allocatedVehicleIds` is already on the type and serves as `assignedVehicleIds` — do NOT add a duplicate field. The plan refers to this field for assigned vehicle IDs.

  Files: `src/lib/types.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 2. Add `autonomousDispatch()` function to `src/lib/fleet.ts`

  **Current:** `fleet.ts` has `assignRepositioning()` (validates + transitions vehicle to EN_ROUTE)
  and `dispatchReposition()` (simpler version without travelTime parameter). No function combines
  constraint validation with atomic multi-vehicle allocation and rollback.

  **Change:** Add a new exported function `autonomousDispatch()` below `dispatchReposition()` in
  `FleetManager`. This function is the single authoritative dispatch path going forward.

  ```ts
  public autonomousDispatch(
    rec: DriverRecommendation,
    nowIso: string = new Date().toISOString()
  ): { success: boolean; assignedVehicleIds: string[]; error?: string }
  ```

  Logic (in order):
  1. **Duplicate guard:** If `rec.status === 'DISPATCHED' || rec.status === 'COMPLETED'`, return
     `{ success: false, error: 'Already dispatched' }`.
  2. **Constraint validation (fail fast, no vehicle touched):**
     - Distance: `rec.estimatedTravelDistanceKm > 12.0` → reject with specific message
     - Travel time: `rec.estimatedTravelTimeMin > 32` → reject
     - `rec.recommendedVehicleCount < 2` → reject
  3. **Atomic vehicle selection:** For each id in `rec.allocatedVehicleIds`, fetch from store.
     Accept only vehicles that are:
     - State `AVAILABLE`
     - `batteryOrFuelLevel >= 20`
     - `zoneId === rec.sourceZoneId` (correct source zone)
     - No `assignedRecommendationId`
     Stop when enough vehicles are collected (`rec.recommendedVehicleCount`) or pool exhausted.
     If fewer than 2 eligible vehicles found → return failure, NO vehicle state changes made.
  4. **Source-zone reserve check:** Count remaining AVAILABLE vehicles in `rec.sourceZoneId`
     after removing the selected vehicles. If `remaining < 3` AND zone has zero deficit,
     reject to avoid creating a shortage.
  5. **Commit phase — assign each selected vehicle** via `persistentStore.updateVehicle(vid, {...})`:
     - `state: 'EN_ROUTE'`, `targetZoneId`, `targetZoneName`, `assignedRecommendationId`,
       `movementStartedAt: nowIso`, `estimatedArrivalAt` (nowIso + travelTimeMin*60s),
       `movementProgressPct: 0`, incremented `repositionCountToday`, `lastStateChange: nowIso`.
     - Track each successfully committed vehicle id in `assigned: string[]`.
  6. **Rollback:** If any `updateVehicle` call returns false mid-commit, release all already-assigned
     vehicles back to AVAILABLE state, return failure.
  7. **Return:** `{ success: true, assignedVehicleIds: assigned }` on success.

  Files: `src/lib/fleet.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 3. Wire `autonomousDispatch()` into `pipelineScheduler.ts` Stage 6

  **Current:** Stage 6 in `executeCycle()` builds recommendation objects with `status: 'DISPATCHED'`
  and calls `globalFleetManager.assignRepositioning()` in a loop. There is no duplicate-cycle guard
  (same recommendation can be recreated on next cycle), no rollback on partial failure, and no
  error field recorded.

  **Change — replace the Stage 6 recommendation-and-dispatch block:**

  1. At the START of Stage 6, load the last 25 cycle runs' recommendation IDs from the store and
     build a `Set<string>` of `sourceZoneId:targetZoneId` pairs already DISPATCHED in this same
     cycle execution (use `cycleTimestamp` window: within last 15 minutes). This prevents a
     deficit/surplus pair from receiving duplicate recommendations across retries.

  2. Keep the deficit/surplus/distance matching logic exactly as-is. When a match is found and
     `moveCount >= 2`:

     a. Create the `DriverRecommendation` object with `status: 'PENDING'` initially (not
        DISPATCHED). Set `autonomousDispatch: true`.

     b. Call `globalFleetManager.autonomousDispatch(rec, cycleTimestamp.toISOString())`.

     c. If `result.success`:
        - Update `rec.status = 'DISPATCHED'`
        - `rec.dispatchedAt = cycleTimestamp.toISOString()`
        - `rec.allocatedVehicleIds = result.assignedVehicleIds`

     d. If `!result.success`:
        - Update `rec.status = 'PENDING'` (leave for next cycle)
        - `rec.dispatchError = result.error`

     e. Persist rec via `persistentStore.upsertRecommendation(rec)` either way.
     f. Push to `generatedRecommendations` either way (so it appears in the cycle record).

  3. Do NOT call `globalFleetManager.assignRepositioning()` directly from the scheduler anymore
     (step 2b's `autonomousDispatch` handles it atomically).

  Files: `src/lib/pipelineScheduler.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 4. Fix `cancelRecommendation()` in `src/lib/recommendations.ts` to release vehicles

  **Current:** `cancelRecommendation()` only changes status to CANCELLED. Vehicles in EN_ROUTE
  remain stuck indefinitely when a DISPATCHED recommendation is cancelled.

  **Change:** After setting `rec.status = 'CANCELLED'`, iterate `rec.allocatedVehicleIds` and for
  each vehicle where `state === 'EN_ROUTE'` and `assignedRecommendationId === rec.id`, call
  `persistentStore.updateVehicle(vid, { state: 'AVAILABLE', targetZoneId: undefined, targetZoneName: undefined, assignedRecommendationId: undefined, movementStartedAt: undefined, estimatedArrivalAt: undefined, movementProgressPct: 0, lastStateChange: nowIso })`.
  Accept `fleetManager` or `persistentStore` reference (use `persistentStore` directly as the
  engine does, to avoid needing a new parameter — import is already present).

  Files: `src/lib/recommendations.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 5. Add `GET /api/dispatch/status` endpoint and deprecate manual dispatch in `server.ts`

  **Current:** `POST /api/recommendations/:id/dispatch` is the manual approval endpoint. No
  `GET /api/dispatch/status` exists. Cancel endpoint already exists.

  **Changes:**

  a. Add `GET /api/dispatch/status` that returns:
  ```json
  {
    "autonomousDispatchEnabled": true,
    "mode": "AUTONOMOUS",
    "lastCycleTimestamp": "<ISO>",
    "lastCycleId": "<string>",
    "dispatchedThisCycle": <number>,
    "pendingCount": <number>,
    "dispatchedCount": <number>,
    "failedCount": <number>,
    "enRouteVehicles": <number>
  }
  ```
  Derive values from `persistentStore.getLatestCycleRun()`,
  `persistentStore.getRecommendations()`, and `globalFleetManager.getFleetStateSummary()`.

  b. Replace `POST /api/recommendations/:id/dispatch` with a `410 Gone` response:
  ```json
  { "error": "Manual dispatch is no longer supported. Recommendations are dispatched autonomously by the 15-minute pipeline.", "code": "ENDPOINT_DEPRECATED" }
  ```
  (Keep the route registered so clients get 410 instead of 404, per the task requirement.)

  c. The existing `POST /api/recommendations/:id/cancel` stays unchanged (already present).

  Files: `server.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 6. Update `RecommendationsView.tsx` — remove manual Dispatch button, add autonomous banner

  **Current:** Per-card "Dispatch" button for PENDING recs, `handleDispatch()` function calling
  `api.dispatchRecommendation()`, "pending dispatch" counter in footer. `dispatchAlert` state
  shows old alert text about "physical telematics disengaged".

  **Changes (minimal, targeted):**

  a. Remove the `handleDispatch()` function and its `api.dispatchRecommendation()` call.

  b. In the card actions footer (`rec.status === 'PENDING'` block): remove the Dispatch button
     entirely. Show a badge instead:
     ```tsx
     <div className="flex-1 py-1.5 text-center text-xs text-amber-300 bg-amber-950/40 rounded border border-amber-900/40 flex items-center justify-center gap-1.5">
       <Clock className="w-3.5 h-3.5" />
       Queued — next 15-min cycle
     </div>
     ```

  c. For `rec.status === 'DISPATCHED'` cards: show ETA and `allocatedVehicleIds` (already shown)
     plus `dispatchedAt` if present:
     ```tsx
     {rec.dispatchedAt && (
       <span className="text-[10px] text-slate-400">
         Dispatched: {new Date(rec.dispatchedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
       </span>
     )}
     ```
     Keep the Cancel button for DISPATCHED recs (already present).

  d. For `rec.dispatchError`: show it as an error row below the card body:
     ```tsx
     {rec.dispatchError && (
       <div className="text-[10px] text-red-400 bg-red-950/40 border border-red-900/30 p-2 rounded mt-2 flex items-start gap-1.5">
         <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
         {rec.dispatchError}
       </div>
     )}
     ```

  e. Replace the `dispatchAlert` banner (which referenced old manual dispatch) with an
     **Autonomous Dispatch Status Banner** at the top of the panel. Use `useEffect` to fetch
     `GET /api/dispatch/status` on mount (add `api.getDispatchStatus()` to `src/services/api.ts`).
     Show:
     - Green "AUTONOMOUS DISPATCH ACTIVE" badge
     - Last cycle timestamp
     - Count dispatched this cycle
     - Any pending count

  f. Remove "pending dispatch" counter from the filter footer (or replace with "pending (queued)" label).

  g. Update status filter tabs — keep all 5 (`ALL`, `PENDING`, `DISPATCHED`, `COMPLETED`, `CANCELLED`).
     Change the label hint next to the count from "X pending dispatch" to "X queued for next cycle".

  Files: `src/components/views/RecommendationsView.tsx`, `src/services/api.ts`
  Verify: `npm run lint` — zero TypeScript errors. Open the Recommendations tab in browser and
  confirm no Dispatch button appears on any PENDING card.

- [ ] 7. Update `OverviewView.tsx` — remove manual dispatch button, add autonomous dispatch status card

  **Current:** The "Recommended Driver Repositionings" panel has a per-card "Dispatch Repositioning"
  button that calls `onDispatchRec(rec.id)` (which invokes the deprecated manual endpoint). The
  `OverviewViewProps` has an `onDispatchRec` callback.

  **Changes:**

  a. Remove the "Dispatch Repositioning" `<button>` from each recommendation mini-card in the
     Overview panel. Replace with a status label showing the rec's current status badge.

  b. Show `pendingRecs` as "queued" items (the label in the panel title can be adjusted to
     "Queued Repositionings" or keep as-is since the button is removed).

  c. Add an **Autonomous Dispatch Status Card** in the KPI cards row (after or replacing the
     "Pending Rebalances" card if needed, or add as a 5th card). The card reads from
     `api.getDispatchStatus()` (fetched in a `useEffect`):
     ```tsx
     <div className="bg-slate-900 border border-emerald-800/40 rounded-xl p-5 shadow-sm">
       <div className="flex items-center justify-between text-slate-400 mb-2">
         <span className="text-xs font-semibold uppercase tracking-wider">Autonomous Dispatch</span>
         <Sparkles className="w-4 h-4 text-emerald-400" />
       </div>
       <div className="text-2xl font-bold text-emerald-400 mb-1">
         ENABLED
       </div>
       <p className="text-[11px] text-slate-400">
         {dispatchStatus?.lastCycleTimestamp
           ? `Last cycle: ${new Date(dispatchStatus.lastCycleTimestamp).toLocaleTimeString(...)}`
           : 'Pipeline active — 15-min cycles'}
       </p>
     </div>
     ```

  d. The `onDispatchRec` prop can be kept in the interface for backward compatibility but its call
     site (the button) is removed. Do not remove the prop from `OverviewViewProps` — callers
     higher up may still pass it.

  Files: `src/components/views/OverviewView.tsx`, `src/services/api.ts` (if `getDispatchStatus` not yet added in step 6)
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 8. Update `FleetOperationsView.tsx` — add "(Simulated)" label to EN_ROUTE entries

  **Current:** The Assigned Movements table shows EN_ROUTE vehicles with a destination zone,
  progress bar, and ETA. No label indicates this is simulated. The Operational Integrity
  Disclosure at the bottom is correct but small.

  **Changes (minimal):**

  a. In the Assigned Movements table header row, add `(Simulated)` to the table title:
     ```tsx
     <h3 className="text-sm font-bold text-white flex items-center gap-2">
       <Navigation className="w-4 h-4 text-purple-400" />
       Active Repositioning Movements & En-Route Transit Tracker
       <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
         SIMULATED
       </span>
     </h3>
     ```

  b. In the vehicle roster table, for each EN_ROUTE vehicle row, append `(Sim)` to the
     movement assignment badge:
     ```tsx
     <span className="text-purple-300 font-mono text-[10px] bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/60">
       En route to {v.targetZoneId} ({v.movementProgressPct || 0}%) · Sim
     </span>
     ```

  c. In the `fleetSummary` En Route count card, add a `(Sim)` suffix to the sub-label:
     "Repositioning (Simulated)"

  Files: `src/components/views/FleetOperationsView.tsx`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 9. Add `api.getDispatchStatus()` to `src/services/api.ts`

  **Current:** No `getDispatchStatus` method exists in the API client.

  **Change:** Add:
  ```ts
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
  }
  ```
  Note: Steps 6 and 7 depend on this being present first. If those steps are implemented in order,
  add this method before updating the React components.

  Files: `src/services/api.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 10. Update `store.ts` to support `dispatchedAt` and `dispatchError` in recommendation patches

  **Current:** `updateRecommendationStatus()` in the store only updates `status` and `updatedAt`.
  No method to patch `dispatchedAt` or `dispatchError`.

  **Change:** Add a new method `updateRecommendation(id, patch)` that merges any partial
  `Partial<DriverRecommendation>` onto the stored recommendation and calls `saveToDisk()`:

  ```ts
  public updateRecommendation(id: string, patch: Partial<DriverRecommendation>): boolean {
    const r = this.state.recommendations[id];
    if (!r) return false;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    this.saveToDisk();
    return true;
  }
  ```

  Update `upsertRecommendation()` to also accept and persist `dispatchedAt`, `dispatchError`,
  `autonomousDispatch` — since those are now on the type, they will be serialised automatically
  when the full recommendation object is upserted.

  Files: `src/db/store.ts`
  Verify: `npm run lint` — zero TypeScript errors.

- [ ] 11. Write `src/lib/autonomousDispatch.test.ts`

  Write a test file using Node.js built-in test runner (`node:test` / `node:assert`), following the
  exact patterns in `src/lib/algorithms.test.ts` (imports with `.ts` extension, `test()` calls).

  **Test cases to implement:**

  1. `Autonomous Dispatch: Eligible dispatch — selects AVAILABLE vehicles and transitions to EN_ROUTE`
     - Create a FleetManager with a small fleet, find an available vehicle in a source zone.
     - Build a minimal DriverRecommendation with valid distance/time/count.
     - Call `fleetManager.autonomousDispatch(rec)`.
     - Assert `result.success === true`, assigned vehicle IDs returned, vehicle state is EN_ROUTE.

  2. `Autonomous Dispatch: Insufficient surplus — fewer than 2 eligible vehicles`
     - Transition all vehicles in source zone to BUSY.
     - Assert `result.success === false`, no vehicles changed to EN_ROUTE.

  3. `Autonomous Dispatch: Low battery/fuel rejection`
     - Set all available source-zone vehicles to `batteryOrFuelLevel = 15` (below 20% threshold).
     - Assert `result.success === false`, dispatch error references battery constraint.

  4. `Autonomous Dispatch: Distance rejection — > 12 km`
     - Build a recommendation with `estimatedTravelDistanceKm = 13.5`.
     - Assert `result.success === false`, error references distance constraint.

  5. `Autonomous Dispatch: Travel time rejection — > 32 min`
     - Build a recommendation with `estimatedTravelTimeMin = 40`.
     - Assert `result.success === false`, error references travel time constraint.

  6. `Autonomous Dispatch: Duplicate dispatch prevention`
     - Successfully dispatch a recommendation (status → DISPATCHED).
     - Call `autonomousDispatch()` again on the same rec.
     - Assert `result.success === false`, recommendation status still DISPATCHED (not double-dispatched).

  7. `Autonomous Dispatch: Partial failure rollback`
     - Spy on `persistentStore.updateVehicle` to fail on the 2nd vehicle.
     - Assert that after failure, the 1st vehicle is back to AVAILABLE (rollback).
     - Assert `result.success === false` and error is recorded.

  8. `Autonomous Dispatch: Cancellation releases EN_ROUTE vehicles`
     - Dispatch a recommendation successfully (vehicles go EN_ROUTE).
     - Call `globalRecommendationEngine.cancelRecommendation(rec.id)`.
     - Assert vehicles return to AVAILABLE state after cancellation.

  9. `Autonomous Dispatch: Simulated arrival completion`
     - Dispatch a recommendation. Set `estimatedArrivalAt` to a timestamp in the past.
     - Call `fleetManager.progressAutonomousMovements(futureIso)`.
     - Assert vehicles moved to `targetZoneId` with state AVAILABLE.
     - Assert recommendation status updated to COMPLETED in store.

  10. `Pipeline Scheduler: Already-DISPATCHED recommendations not re-dispatched on next cycle`
      - Insert a DISPATCHED recommendation into the store with matching sourceZoneId/targetZoneId.
      - Run `globalPipelineScheduler.executeCycle('TEST_DUPLICATE')`.
      - Assert no second recommendation with the same source/target zone pair is added in the same
        15-minute window (check `recommendations` array in cycle run output).

  Files: `src/lib/autonomousDispatch.test.ts`
  Verify: `npm run test` — all new tests pass; existing tests in `algorithms.test.ts`,
  `auth.test.ts`, `n8nWorkflow.test.ts` still pass.

- [ ] 12. Run full build and lint; fix any regressions

  After all code changes are applied:
  1. Run `npm run lint` — fix any TypeScript errors introduced by the new fields or imports.
  2. Run `npm run test` — confirm all tests pass including the new `autonomousDispatch.test.ts`.
  3. Run `npm run build` — confirm Vite build succeeds with no errors.

  **Known regression risks to watch:**
  - `OverviewView.tsx` uses `onDispatchRec` prop — ensure parent (`App.tsx` or root component) still
    passes it without errors even though the button is gone (prop can be a no-op).
  - The `dispatchAlert` state removal in `RecommendationsView.tsx` must also remove its `useState`
    import if no longer used.
  - `play` import from `lucide-react` in `RecommendationsView.tsx` — ensure `Play` icon still
    imported if used elsewhere in that file.

  Files: All modified files from steps 1–11.
  Verify: `npm run lint && npm run test && npm run build` — zero errors.

---

## Constraint Preservation Summary

| Constraint | How Preserved |
|---|---|
| Max 12 km distance | Enforced in `autonomousDispatch()` step 2 |
| Max 32 min travel time | Enforced in `autonomousDispatch()` step 2 |
| Source zone reserve ≥ 3 vehicles | Enforced in `autonomousDispatch()` step 4 |
| Battery ≥ 20% | Enforced in `autonomousDispatch()` step 3 |
| Batch size ≥ 2 and ≤ 15 | `pipelineScheduler.ts` Stage 6 logic unchanged; also checked in `autonomousDispatch()` |
| No duplicate dispatches | Status check at start of `autonomousDispatch()` + zone-pair deduplication in scheduler |
| Rollback on partial failure | Explicit rollback loop in `autonomousDispatch()` step 6 |
| Preserve priority calculation | `pipelineScheduler.ts` priority logic unchanged; `recommendations.ts` priority logic unchanged |
| Preserve reason strings verbatim | Both engines' reason string templates unchanged |
| No GPS fabrication | EN_ROUTE labeled "(Simulated)" in UI; arrival via `estimatedArrivalAt` timer only |
| No source zone shortages | Reserve check + 70% take-rate cap preserved |
