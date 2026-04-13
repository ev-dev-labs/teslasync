# Fix Double-Prefix API URLs in ALL Hook Files

> **Root Cause**: The API client (`web/src/lib/resilience.ts` line 164) automatically
> prepends `/api/v1` to every path. Hooks that include `/api/v1/` in their path
> create a double prefix: `/api/v1/api/v1/...` → 404 Not Found.
>
> This is why Alerts, AlertStudio, Notifications, Telemetry, Admin, and Vehicle Systems
> pages all show "Not Found" errors.

---

## The Rule

```
The `request()` function auto-adds /api/v1 prefix.
WRONG: request('/api/v1/alerts')     → fetches /api/v1/api/v1/alerts  (404)
RIGHT: request('/alerts')            → fetches /api/v1/alerts         (200)
```

Strip `/api/v1` from EVERY path in EVERY hook file. The path should start with `/`
followed by the resource name directly.

---

## File 1: `web/src/api/hooks/useNotifications.ts`

| Line | Wrong | Correct |
|------|-------|---------|
| 16 | `'/api/v1/alerts'` | `'/alerts'` |
| 25 | `` `/api/v1/alerts/${id}/read` `` | `` `/alerts/${id}/read` `` |
| 33 | `'/api/v1/alert-rules'` | `'/alerts/rules'` |
| 41 | `` `/api/v1/alert-rules/${data.id}` `` and `'/api/v1/alert-rules'` | `` `/alerts/rules/${data.id}` `` and `'/alerts/rules'` |
| 54 | `` `/api/v1/alert-rules/${id}` `` | `` `/alerts/rules/${id}` `` |
| 62 | `'/api/v1/notifications/channels'` | `'/notifications'` |
| 69 | `'/api/v1/notifications/logs'` | `'/notifications/logs'` |
| 76 | `'/api/v1/notifications/stats'` | `'/notifications/stats'` |
| 86 | `` `/api/v1/notifications/channels/${data.id}` `` and `'/api/v1/notifications/channels'` | `` `/notifications/${data.id}` `` and `'/notifications'` |
| 101 | `` `/api/v1/notifications/channels/${id}` `` | `` `/notifications/${id}` `` |

**Note**: Alert rules path is also wrong (`/alert-rules` should be `/alerts/rules`).
Notification channels path is also wrong (`/notifications/channels` should be `/notifications`).
See backend routes in `internal/api/router.go` lines 266-309.

---

## File 2: `web/src/api/hooks/useAdmin.ts`

| Line | Wrong | Correct |
|------|-------|---------|
| 29 | `'/api/v1/api-keys'` | `'/api-keys'` |
| 37 | `'/api/v1/api-keys'` | `'/api-keys'` |
| 49 | `` `/api/v1/api-keys/${id}` `` | `` `/api-keys/${id}` `` |
| 57 | `` `/api/v1/api-logs?page=${page}&limit=25` `` | `` `/api-logs?page=${page}&limit=25` `` |
| 64 | `'/api/v1/api-logs/stats'` | `'/api-logs/stats'` |
| 72 | `'/api/v1/backups/configs'` | `'/system/backup/stats'` ⚠️ |
| 79 | `'/api/v1/backups/runs?limit=50'` | `'/system/backup'` ⚠️ |
| 87 | `'/api/v1/health/extended'` | `'/system/health'` ⚠️ |
| 95 | `'/api/v1/audit-logs?limit=20'` | `'/system/audit'` ⚠️ |
| 102 | `` `/api/v1/vehicles/${vehicleId}/security-events` `` | `` `/security?vehicle_id=${vehicleId}` `` ⚠️ |
| 110 | `'/api/v1/health/db-stats'` | `'/dev-tools/db-stats'` ⚠️ |
| 118 | `'/api/v1/health/migrations'` | `'/dev-tools/migration-status'` ⚠️ |
| 126 | `'/api/v1/health/connection-pool'` | Check if exists — may need to be removed or pointed at `/dev-tools/runtime-info` |
| 134 | `'/api/v1/exports'` | `'/exports'` — verify this route exists in router.go |
| 142 | `'/api/v1/exports'` | `'/exports'` |
| 154 | `` `/api/v1/vehicles/${vehicleId}/state` `` | `` `/vehicles/${vehicleId}/state` `` |
| 163 | `` `/api/v1/vehicles/${vehicleId}/state/timeline` `` | `` `/vehicle-states/timeline?vehicle_id=${vehicleId}` `` ⚠️ |

**⚠️ marks paths that were also wrong BESIDES the double-prefix**. Cross-reference against
`internal/api/router.go` for exact backend routes:

```
Backend system routes (lines 426-448):
  GET /system/status
  GET /system/health
  GET /system/api-usage
  GET /system/backup
  GET /system/backup/stats
  GET /system/audit
  GET /system/config-validation
  GET /system/version
  GET /system/errors/stats
  GET /system/errors/catalog
  GET /system/map-config
  GET /system/update-check
  GET /system/workers
  GET /system/metrics-catalog

Backend API logs (lines 451-454):
  GET /api-logs
  GET /api-logs/stats

Backend API keys (lines 470-477):
  GET    /api-keys
  POST   /api-keys
  DELETE /api-keys/{id}
  POST   /api-keys/{id}/revoke

Backend dev-tools (lines 486-513):
  GET /dev-tools/db-stats
  GET /dev-tools/migration-status
  GET /dev-tools/runtime-info
```

---

## File 3: `web/src/api/hooks/useTelemetry.ts`

| Line | Wrong | Correct |
|------|-------|---------|
| 18 | `'/api/v1/signals/available'` | `'/signals/available'` ⚠️ |
| 26 | `` `/api/v1/signals/stats?...` `` | `` `/signals/stats?...` `` ⚠️ |
| 34 | `` `/api/v1/signals/history?...` `` | `` `/signals/history?...` `` ⚠️ |
| 45 | `` `/api/v1/signals/history?...` `` | `` `/signals/history?...` `` ⚠️ |
| 55 | `` `/api/v1/signals/history?...` `` | `` `/signals/history?...` `` ⚠️ |
| 63 | `'/api/v1/signals/live'` | `'/signals/live'` ⚠️ |
| 71 | `'/api/v1/telemetry/status'` | `'/telemetry'` |

**⚠️ Signals routes**: Verify these exist in router.go. Search for `/signals` or
signal-related handlers. If they don't exist, the telemetry pages will need
alternative data sources.

---

## File 4: `web/src/api/hooks/useVehicleSystems.ts`

| Line | Wrong | Correct |
|------|-------|---------|
| 22 | `` `/api/v1/vehicles/${vehicleId}/climate` `` | `` `/climate/latest?vehicle_id=${vehicleId}` `` ⚠️ |
| 31 | `` `/api/v1/vehicles/${vehicleId}/climate/history` `` | `` `/climate?vehicle_id=${vehicleId}` `` ⚠️ |
| 39 | `` `/api/v1/vehicles/${vehicleId}/tire-pressure` `` | `` `/tire-pressure/latest?vehicle_id=${vehicleId}` `` ⚠️ |
| 48 | `` `/api/v1/vehicles/${vehicleId}/tire-pressure/history` `` | `` `/tire-pressure?vehicle_id=${vehicleId}` `` ⚠️ |
| 56 | `'/api/v1/maintenance'` | Verify route exists ⚠️ |
| 63 | `'/api/v1/maintenance/records'` | Verify route exists ⚠️ |
| 70 | `` `/api/v1/vehicles/${vehicleId}/software-updates` `` | `'/software-updates'` ⚠️ |
| 78 | `` `/api/v1/vehicles/${vehicleId}/safety` `` | `` `/safety/latest?vehicle_id=${vehicleId}` `` ⚠️ |
| 87 | `` `/api/v1/vehicles/${vehicleId}/safety/history` `` | `` `/safety?vehicle_id=${vehicleId}` `` ⚠️ |
| 95 | `` `/api/v1/vehicles/${vehicleId}/media` `` | `` `/media/latest?vehicle_id=${vehicleId}` `` ⚠️ |
| 104 | `` `/api/v1/vehicles/${vehicleId}/media/history` `` | `` `/media?vehicle_id=${vehicleId}` `` ⚠️ |

**⚠️ These paths are also structurally wrong** — the backend uses flat routes like
`/climate/latest?vehicle_id=X` not nested `/vehicles/{id}/climate`.

Backend routes (router.go lines 319-381):
```
  GET /tire-pressure         GET /tire-pressure/latest
  GET /motor                 GET /motor/latest
  GET /climate               GET /climate/latest
  GET /security              GET /security/latest
  GET /charging-telemetry    GET /charging-telemetry/latest
  GET /media                 GET /media/latest
  GET /vehicle-config        GET /vehicle-config/latest
  GET /location-snapshots    GET /location-snapshots/latest
  GET /safety                GET /safety/latest
  GET /user-preferences      GET /user-preferences/latest
  GET /software-updates
  GET /vampire-drain         GET /vampire-drain/stats
```

---

## Verification

After fixing ALL files:

```powershell
# 1. No /api/v1/ in any hook file (the client adds it)
Select-String -Path web\src\api\hooks\*.ts -Pattern "'/api/v1/" | Measure-Object
# Must be 0

Select-String -Path web\src\api\hooks\*.ts -Pattern '`/api/v1/' | Measure-Object
# Must be 0

# 2. TypeScript compiles
cd web; npx tsc --noEmit

# 3. No 'any' types introduced
Select-String -Path web\src\api\hooks\*.ts -Pattern ': any' | Measure-Object
# Should be 0 (or same as before)
```

## Do NOT:
- Remove any hook functions
- Change the request() client itself
- Add `/api/v1` to the client (it's already there)
- Break existing hooks that DON'T have the double-prefix (useCharging, useDriving, etc. are correct)
