---
description: "Fix 4 runtime errors found in teslasync-api logs: drives/charging 400s, sse-token 404, export/jobs 500"
---

# Fix Runtime Errors — API Server Logs

## Errors Found (from `docker logs teslasync-api`)

| Status | Endpoint | Count | Root Cause |
|--------|----------|-------|------------|
| **400** | `/api/v1/drives` | 9 | Called without `vehicle_id` — backend requires it |
| **400** | `/api/v1/charging` | 9 | Called without `vehicle_id` — backend requires it |
| **404** | `/api/v1/sse-token` | 1 | Route only registered when Authentik auth is configured |
| **500** | `/api/v1/export/jobs` | 4 | Handler error — 8.4s duration suggests DB timeout |

---

## Part 1 — Fix /drives and /charging 400 errors

**Problem:** Several pages call `useDrives()` or `useCharging()` before a vehicle is selected.
The hooks have `enabled: !!vehicleId` guards, so the issue is that some pages pass
an empty/undefined vehicleId string to the hook.

**Investigation:**
```bash
# Find all pages that use useDrives or useCharging
grep -rn "useDrives\|useCharging" web/src/features/ --include="*.tsx" | grep -v "import"
```

**Fix Pattern:**
For each page that calls useDrives/useCharging, ensure the vehicleId is properly
guarded before being passed:

```typescript
// ❌ BUG — passes empty string '' which is truthy
const vehicleIdStr = String(vehicleId);  // vehicleId is null → "null"
const { data } = useDrives(vehicleIdStr);

// ✅ FIX — only pass when vehicle is actually selected
const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
const { data } = useDrives(vehicleIdStr);  // undefined → enabled: false → no fetch
```

Check every page in `web/src/features/` that uses these hooks and ensure:
1. `vehicleId` is derived safely: `const vehicleId = vehicles?.[0]?.id ?? null`
2. String conversion guards null: `vehicleId != null ? String(vehicleId) : undefined`
3. The hook's `enabled` guard works: `enabled: !!vehicleId` prevents fetch when undefined

---

## Part 2 — Fix /sse-token 404

**Problem:** `web/src/lib/sseManager.ts` line 28 calls `fetch('/api/v1/sse-token')` to get
a JWT for SSE authentication. But the `/sse-token` route is **only registered when
Authentik auth is configured** (see `internal/api/router.go` lines 436-451):

```go
if cfg.Auth.AuthentikURL != "" || cfg.Auth.AuthentikHMACKey != "" {
    r.Get("/sse-token", SSETokenHandler())  // only registered with auth
} else {
    // No auth on SSE (development) — no token endpoint
    r.Get("/events", SSEHandler(eventHub))
}
```

In local development without Authentik, `/sse-token` doesn't exist → 404.

**Fix in `web/src/lib/sseManager.ts`:**

The `fetchSSEToken()` function (line 26-35) already handles failure gracefully
(returns null on non-200). But the 404 still logs as an error in the API server.

Fix the SSE manager to skip the token fetch in development:

```typescript
async function fetchSSEToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/sse-token')
    if (!res.ok) return null  // 404 in dev = no auth needed, proceed without token
    const data = await res.json()
    return data.token || null
  } catch {
    return null
  }
}
```

The function is already correct — but to eliminate the 404 noise, add a check:

```typescript
async function fetchSSEToken(): Promise<string | null> {
  // In development without auth, /sse-token won't exist — skip silently
  try {
    const res = await fetch('/api/v1/sse-token', { method: 'HEAD' })
    if (res.status === 404) return null  // no auth configured, skip
  } catch {
    return null
  }
  try {
    const res = await fetch('/api/v1/sse-token')
    if (!res.ok) return null
    const data = await res.json()
    return data.token || null
  } catch {
    return null
  }
}
```

**OR simpler approach** — just silence the 404 on the backend. In `router.go`, always
register the endpoint but return a "no auth" response in dev mode:

```go
// Always register — avoids 404 noise in frontend
r.Get("/sse-token", func(w http.ResponseWriter, r *http.Request) {
    if cfg.Auth.AuthentikURL == "" {
        writeJSON(w, http.StatusOK, map[string]string{"token": ""})
        return
    }
    SSETokenHandler()(w, r)
})
```

**Choose the backend approach** — it's cleaner (one place to fix, no double-fetch).

---

## Part 3 — Fix /export/jobs 500

**Problem:** `GET /api/v1/export/jobs` returns 500 with 8.4s duration, suggesting a
database query timeout or connection issue.

**Investigation:**
```bash
# Check the export job handler
cat internal/api/export_job_handler.go | head -80

# Check if the export_jobs table exists
docker exec teslasync-postgres psql -U teslasync -c "\dt export_jobs" 2>&1

# Check if there's a migration for it
grep -rn "export_jobs" internal/database/migrations/
```

**The handler is called from:**
- `web/src/features/system/pages/SystemStatusPage.tsx` line 934 — uses old `getExportJobs()`
  from `@/api/devtools` instead of a proper TanStack Query hook

**Fix:**
1. Check if the `export_jobs` table exists. If not, the migration may not have run
2. If the table exists, check the handler for missing error handling or slow queries
3. Replace the old `getDevtoolsExportJobs()` call in SystemStatusPage with a proper
   hook from `useAdmin.ts` (which already has `useExportJobs`):

```typescript
// ❌ OLD — uses devtools.ts function directly
import { getExportJobs as getDevtoolsExportJobs } from '@/api/devtools';
const { data: exportJobs } = useQuery({
  queryKey: ['system-status', 'export-jobs'],
  queryFn: () => getDevtoolsExportJobs(),
});

// ✅ NEW — use existing hook from useAdmin.ts
import { useExportJobs } from '@/api/hooks/useAdmin';
const { data: exportJobs, isLoading: exportLoading } = useExportJobs();
```

Also add proper error handling — if the table doesn't exist, the handler should
return an empty array, not a 500.

---

## Verification

```bash
# Rebuild and restart
docker compose up -d --build teslasync-api teslasync-web

# Wait for healthy
sleep 10

# Test the fixed endpoints
curl -sf "http://localhost:8080/api/v1/drives" | head -1
# Should return 400 with clear error (not crash)

curl -sf "http://localhost:8080/api/v1/drives?vehicle_id=1" | head -1
# Should return 200

curl -sf "http://localhost:8080/api/v1/sse-token" | head -1
# Should return 200 with empty token (not 404)

curl -sf "http://localhost:8080/api/v1/export/jobs" | head -1
# Should return 200 with [] or job list (not 500)

# Check logs for errors
docker logs teslasync-api --tail 50 2>&1 | grep -E '"status":(4|5)'
# Should be 0 errors
```

**COMPLETION DEFINITION:**
- [ ] No 400 errors on /drives or /charging in logs (hooks guard vehicleId properly)
- [ ] No 404 on /sse-token (endpoint always registered)
- [ ] No 500 on /export/jobs (handler has proper error handling)
- [ ] SystemStatusPage uses hook from useAdmin.ts, not devtools.ts
- [ ] `npx tsc --noEmit` passes
- [ ] `go build ./...` passes
