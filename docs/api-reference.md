# API Reference

This page is a compact reference for the public HTTP surface. The source of truth is `internal/api/router.go`; frontend hooks live under `web/src/api/hooks/` and call paths without the `/api/v1` prefix because the request client adds it.

## Base paths

| Path | Purpose | Auth |
|---|---|---|
| `/healthz` | Liveness probe | Public |
| `/readyz` | Dependency readiness probe | Public |
| `/metrics` | Prometheus metrics | Usually internal only |
| `/internal/flush` | Kubernetes PreStop flush hook | Internal only |
| `/api/v1/*` | Main API | ForwardAuth/header protected when configured |
| `/api/v1/share/{token}` | Public shared drive report | Token + rate limit |
| `/api/v1/automations/webhook/{token}` | Public automation webhook trigger | Token + rate limit |

## Main resource groups

| Group | Examples |
|---|---|
| Auth | `/auth/login`, `/auth/url`, `/auth/callback`, `/auth/status`, `/auth/refresh`, `/auth/disconnect` |
| Vehicles | `/vehicles`, `/vehicles/{vehicle_id}`, `/vehicles/{vehicle_id}/state`, `/wake`, `/command`, `/drivers`, `/invitations`, `/guard` |
| Drives | `/drives`, `/drives/stats`, `/drives/score`, `/drives/dynamics`, `/drives/{drive_id}/positions`, `/drives/{drive_id}/telemetry` |
| Charging | `/charging`, `/charging/{session_id}`, `/charging/{session_id}/telemetry`, `/tesla/charging/history`, `/tesla/charging/sessions` |
| Battery and energy | `/vehicles/{vehicle_id}/battery`, `/battery/cells`, `/battery/projected-range`, `/energy/flow`, `/tesla/energy-sites` |
| Analytics | `/analytics/fleet`, `/analytics/tco`, `/analytics/sleep`, `/analytics/regen`, `/analytics/battery-degradation`, `/analytics/route-efficiency` |
| Maps and location | `/geofences`, `/locations`, `/trips`, drive positions, geofence events |
| Alerts and notifications | `/alerts`, `/alerts/rules`, `/notifications`, `/notifications/logs`, `/notifications/stats` |
| Automations | `/automations`, `/automations/events`, `/automations/webhook/{token}` |
| Admin and ops | `/system/status`, `/system/health`, `/system/version`, `/api-logs`, `/exports`, `/backup` |
| Telemetry diagnostics | `/signals/history`, `/signals/available`, `/signals/stats`, `/signals/{vehicle_id}/available`, `/signals/{vehicle_id}/live`, `/signals/{vehicle_id}/{signal_name}/history` |

## Request conventions

- Use snake_case query parameters: `vehicle_id`, `drive_id`, `start_date`, `end_date`.
- Do not include `/api/v1` inside frontend hook URLs; `request()` prepends it.
- List endpoints use `limit` and `offset` where pagination is supported.
- Write endpoints are rate-limited, especially auth, refresh, vehicle commands, Tesla refreshes, and public webhooks.
- Production deployments should expose `/api` through the web/Nginx route or an authenticated ingress route, never as an unauthenticated public API service.

## Example requests

```bash
curl https://teslasync.example.com/api/v1/vehicles
curl "https://teslasync.example.com/api/v1/drives?vehicle_id=1&limit=50"
curl https://teslasync.example.com/api/v1/vehicles/1/state
curl -X POST https://teslasync.example.com/api/v1/vehicles/1/wake
```

See [Detailed API Endpoints](/guide/api-endpoints) for the route tree and [Contributing API Reference](/contributing/api-reference) for hook patterns.
