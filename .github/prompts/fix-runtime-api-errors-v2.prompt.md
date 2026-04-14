---
description: "Fix 6 runtime API errors found in docker logs — wrong URLs, missing guards, method mismatch"
---

# Fix: Runtime API Errors — 6 Broken Endpoints

## Errors Found (from `docker logs teslasync-api`)

| Status | Endpoint | Count | Root Cause |
|--------|----------|-------|------------|
| **405** | `GET /exports` | 2 | Backend only has `POST /exports`, list is at `GET /export/jobs` |
| **500** | `GET /export/jobs` | 4 | DB error in ListJobs handler (8s timeout) |
| **404** | `GET /sse-token` | 13 | Only registered with Authentik auth enabled |
| **404** | `GET /gas-price/status` | 4 | Only registered when `GasPriceWorker != nil` |
| **400** | `GET /drives` | 4 | Called without `vehicle_id` query param |
| **400** | `GET /charging` | 4 | Called without `vehicle_id` query param |
| **400** | `GET /drives/score` | 2 | Endpoint does not exist in router.go |

---

## Fix 1 — DataExportPage: `GET /exports` → 405 Method Not Allowed

**File:** `web/src/features/system/pages/DataExportPage.tsx`

The page calls `GET /exports` (line 842) but the backend only registers `POST /exports`.
The list endpoint is `GET /export/jobs` (router.go:665).

```typescript
// ❌ BEFORE (line 842) — 405 Method Not Allowed
queryFn: () => request<ExportJobSummary[]>('/exports'),

// ✅ AFTER — use the correct list endpoint
queryFn: () => request<ExportJobSummary[]>('/export/jobs'),
```

Also fix the submit mutation (line 855):
```typescript
// ❌ BEFORE — POST /exports (works, but inconsistent path)
request<ExportJobSummary>('/exports', { method: 'POST', ...

// ✅ AFTER — POST /export/jobs (matches router.go:663)
request<ExportJobSummary>('/export/jobs', { method: 'POST', ...
```

---

## Fix 2 — SSE Token: `/sse-token` → 404 in development

**File:** `internal/api/router.go` (around line 436-451)

The `/sse-token` endpoint is only registered when Authentik auth is configured.
In development without auth, the frontend calls it and gets 404 on every page load.

**Fix in router.go:** Always register the endpoint, return empty token in dev:

```go
// BEFORE (inside auth conditional)
r.Get("/sse-token", SSETokenHandler())

// AFTER — always register, handle no-auth gracefully
r.Get("/sse-token", func(w http.ResponseWriter, r *http.Request) {
    if cfg.Auth.AuthentikURL == "" || cfg.Auth.AuthentikHMACKey == "" {
        writeJSON(w, http.StatusOK, map[string]string{"token": ""})
        return
    }
    SSETokenHandler()(w, r)
})
```

Move this OUTSIDE the `if cfg.Auth.AuthentikURL != ""` block so it's always available.

---

## Fix 3 — Gas Price hooks: `/gas-price/status` → 404

**File:** `web/src/api/hooks/useSettings.ts` (line 114)

The gas price routes are conditional — only registered when `opt.GasPriceWorker != nil`
(router.go:275). When `GAS_PRICE_API_KEY` is not set, the worker is nil and routes don't exist.

**Fix:** Add `enabled` guard to prevent calling when feature is unavailable:

```typescript
// ❌ BEFORE — always fires, gets 404 when gas price worker not configured
export function useGasPriceStatus() {
  return useQuery({
    queryKey: settingsKeys.gasPriceStatus,
    queryFn: () => request<GasPriceStatus>('/gas-price/status'),
  });
}

// ✅ AFTER — only fetch when feature is known to be available
export function useGasPriceStatus(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.gasPriceStatus,
    queryFn: () => request<GasPriceStatus>('/gas-price/status'),
    enabled,
    retry: false,  // don't retry 404s
  });
}
```

Also check which pages call `useGasPriceStatus()` and ensure they handle the
case where gas prices are not configured (show info message, not error).

---

## Fix 4 — Drives/Charging 400: called without `vehicle_id`

**Files:** Pages that call `useDrives()` or `useCharging()` before vehicle is selected.

The hooks have `enabled: !!vehicleId` but the pages may pass empty string `""` (truthy)
instead of `undefined` (falsy).

**Check pattern:**
```bash
grep -rn "useDrives\|useCharging" web/src/features/ --include="*.tsx" | grep -v "import"
```

For each usage, ensure vehicleId is properly guarded:
```typescript
// ❌ BUG — String(null) = "null" which is truthy
const vehicleIdStr = String(vehicleId);

// ✅ FIX — undefined when no vehicle
const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
```

---

## Fix 5 — DriveScore: `/drives/score` → 400 (endpoint doesn't exist)

**File:** `web/src/api/hooks/useDriving.ts` (line 55-62)

The hook calls `GET /drives/score?vehicle_id=X` but **no such route exists** in router.go.
There is no `/drives/score` endpoint registered anywhere.

**Options:**
1. If drive score is computed from drive data → compute client-side from `useDrives()` data
2. If there's an analytics endpoint → check `/analytics/*` routes
3. If the endpoint needs to be created → report it as missing backend work

**For now:** Add `retry: false` and make the DriveScorePage handle the error gracefully
instead of showing a red error banner:

```typescript
export function useDriveScore(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.score(vehicleId),
    queryFn: () => request<DriveScore>(
      vehicleId ? `/drives/score?vehicle_id=${vehicleId}` : '/drives/score',
    ),
    enabled: !!vehicleId,
    retry: false,  // don't retry — endpoint may not exist
  });
}
```

---

## Verification

```bash
# Rebuild and restart
docker compose up -d --build teslasync-api teslasync-web
sleep 10

# Test fixed endpoints
curl -sf "http://localhost:8080/api/v1/export/jobs" | head -1
curl -sf "http://localhost:8080/api/v1/sse-token" | head -1
curl -sf "http://localhost:8080/api/v1/drives?vehicle_id=1" | head -1

# Check logs — should be minimal errors
docker logs teslasync-api --tail 100 2>&1 | grep -E '"status":(4|5)' | wc -l

cd web && npx tsc --noEmit
go build ./...
```

**COMPLETION DEFINITION:**
- [ ] DataExportPage uses `/export/jobs` not `/exports`
- [ ] `/sse-token` always registered in router.go (returns empty token without auth)
- [ ] Gas price hooks have `retry: false` + `enabled` guard
- [ ] Drives/charging hooks get `undefined` not `""` when no vehicle
- [ ] DriveScore hook has `retry: false`
- [ ] TypeScript compiles clean
- [ ] Go builds clean
- [ ] Docker logs show reduced error count
