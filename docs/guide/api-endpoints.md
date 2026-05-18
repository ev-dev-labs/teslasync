# API Endpoints

The route source of truth is `internal/api/router.go`. Frontend hooks live in `web/src/api/hooks/` and call paths without the `/api/v1` prefix because `request()` adds it.

## Conventions

- **Base prefix:** `/api/v1`
- **Frontend hook pattern:** `request('/vehicles')`, never `request('/api/v1/vehicles')`
- **Query params:** snake_case (`vehicle_id`, `drive_id`, `start_date`)
- **Auth:** ForwardAuth-protected when `FORWARD_AUTH_HEADER` is set
- **Public token routes:** rate-limited; still serve over HTTPS

## Health & ops

| Method | Path                          | Notes                              |
| ------ | ----------------------------- | ---------------------------------- |
| GET    | `/healthz`                    | Liveness                           |
| GET    | `/readyz`                     | Dependency readiness               |
| GET    | `/metrics`                    | Prometheus; keep internal          |
| POST   | `/internal/flush`             | PreStop drain hook                 |
| GET    | `/api/v1/system/status`       | App/system status                  |
| GET    | `/api/v1/system/health`       | Detailed health                    |
| GET    | `/api/v1/system/version`      | Build/version metadata             |

## Auth

| Method | Path                          |
| ------ | ----------------------------- |
| GET    | `/api/v1/auth/login`          |
| POST   | `/api/v1/auth/url`            |
| GET    | `/api/v1/auth/callback`       |
| POST   | `/api/v1/auth/refresh`        |
| GET    | `/api/v1/auth/status`         |
| POST   | `/api/v1/auth/disconnect`     |

## Vehicles & remote commands

| Method | Path                                                       | Purpose                              |
| ------ | ---------------------------------------------------------- | ------------------------------------ |
| GET    | `/api/v1/vehicles`                                         | List vehicles                        |
| POST   | `/api/v1/vehicles/sync`                                    | Refresh from Tesla                   |
| GET    | `/api/v1/vehicles/{vehicle_id}`                            | Vehicle detail                       |
| DELETE | `/api/v1/vehicles/{vehicle_id}`                            | Remove stored vehicle                |
| GET    | `/api/v1/vehicles/{vehicle_id}/state`                      | Current live state                   |
| GET    | `/api/v1/vehicles/{vehicle_id}/positions`                  | Position history                    |
| POST   | `/api/v1/vehicles/{vehicle_id}/wake`                       | Wake vehicle (always direct, never proxied) |
| POST   | `/api/v1/vehicles/{vehicle_id}/command`                    | Send any of the 65 supported commands |
| GET    | `/api/v1/vehicles/{vehicle_id}/commands/latest`            | Latest command state                 |
| GET    | `/api/v1/vehicles/{vehicle_id}/commands/history`           | Command history                      |

The `POST /command` request body is `{ "command": "<name>", "params": { ... } }`. See [Remote Commands](/guide/remote-commands) for the full 65-endpoint reference.

Vehicle sub-resources include drivers, invitations, mobile access, options, specs, subscription/upgrades, guard mode, weekly digest, battery, energy, and FSM diagnostics.

## Drives, trips & sharing

| Method | Path                                                |
| ------ | --------------------------------------------------- |
| GET    | `/api/v1/drives`                                    |
| GET    | `/api/v1/drives/stats`                              |
| GET    | `/api/v1/drives/score`                              |
| GET    | `/api/v1/drives/dynamics`                           |
| GET    | `/api/v1/drives/acceleration-distribution`          |
| GET    | `/api/v1/drives/{drive_id}`                         |
| GET    | `/api/v1/drives/{drive_id}/positions`               |
| GET    | `/api/v1/drives/{drive_id}/telemetry`               |
| POST   | `/api/v1/drives/{drive_id}/share`                   |
| GET    | `/api/v1/drives/{drive_id}/shares`                  |
| DELETE | `/api/v1/shares/{token}`                            |
| GET    | `/api/v1/share/{token}`                             |

## Charging, battery & energy

| Method | Path                                                          |
| ------ | ------------------------------------------------------------- |
| GET    | `/api/v1/charging`                                            |
| GET    | `/api/v1/charging/{session_id}`                               |
| GET    | `/api/v1/charging/{session_id}/telemetry`                     |
| GET    | `/api/v1/tesla/charging/history`                              |
| POST   | `/api/v1/tesla/charging/history/refresh`                      |
| GET    | `/api/v1/tesla/charging/invoice/{content_id}`                 |
| GET    | `/api/v1/tesla/charging/sessions`                             |
| GET    | `/api/v1/vehicles/{vehicle_id}/battery`                       |
| GET    | `/api/v1/vehicles/{vehicle_id}/battery/cells`                 |
| GET    | `/api/v1/vehicles/{vehicle_id}/battery/projected-range`       |
| GET    | `/api/v1/vehicles/{vehicle_id}/energy`                        |
| GET    | `/api/v1/vehicles/{vehicle_id}/energy/flow`                   |
| GET    | `/api/v1/tesla/energy-sites`                                  |
| GET    | `/api/v1/tesla/energy-sites/{site_id}/live-status`            |
| GET    | `/api/v1/tesla/energy-sites/{site_id}/energy-history`         |

## Analytics

Analytics routes cover fleet overview, total cost of ownership, sleep efficiency, regen, degradation, speed profile, temperature impact, route efficiency, battery cells, charging heatmaps, and related chart data. Prefer hooks in `web/src/api/hooks/useAnalytics.ts` and the per-domain hook files instead of constructing URLs in components.

## Alerts, notifications & automations

| Method      | Path                                            |
| ----------- | ----------------------------------------------- |
| GET / POST  | `/api/v1/alerts`                                |
| POST        | `/api/v1/alerts/{alert_id}/read`                |
| GET / POST  | `/api/v1/alerts/rules`                          |
| PUT / DELETE| `/api/v1/alerts/rules/{rule_id}`                |
| POST        | `/api/v1/alerts/test`                           |
| GET / POST  | `/api/v1/notifications`                         |
| GET         | `/api/v1/notifications/logs`                    |
| GET         | `/api/v1/notifications/stats`                   |
| GET / POST  | `/api/v1/automations`                           |
| GET         | `/api/v1/automations/events`                    |
| POST        | `/api/v1/automations/export`                    |
| POST        | `/api/v1/automations/import`                    |
| GET         | `/api/v1/automations/history`                   |
| GET         | `/api/v1/automations/presets`                   |
| GET / PUT / DELETE | `/api/v1/automations/{id}`               |
| PATCH       | `/api/v1/automations/{id}/toggle`               |
| PATCH       | `/api/v1/automations/{id}/re-enable`            |
| POST        | `/api/v1/automations/{id}/test-run`             |
| POST        | `/api/v1/automations/webhook/{token}`           |

## Telemetry & signal diagnostics

| Path family                                                       | Purpose                              |
| ----------------------------------------------------------------- | ------------------------------------ |
| `/api/v1/events`                                                  | Main SSE event stream                |
| `/api/v1/sse-token`                                               | Backward-compatible SSE token stub   |
| `/api/v1/telemetry`                                               | Telemetry ingest/status              |
| `/api/v1/signals/history`                                         | Multi-signal historical query        |
| `/api/v1/signals/available`                                       | Available signals (`?vehicle_id=`)   |
| `/api/v1/signals/stats`                                           | Signal summary stats                 |
| `/api/v1/signals/{vehicle_id}/available`                          | Signal catalog for a vehicle         |
| `/api/v1/signals/{vehicle_id}/live`                               | Live signal snapshot (L1+L2 merged)  |
| `/api/v1/signals/{vehicle_id}/stats`                              | Per-vehicle signal stats             |
| `/api/v1/signals/{vehicle_id}/{signal_name}/history`              | Historical signal values             |
| `/api/v1/tesla/fleet-telemetry/errors`                            | Tesla Fleet Telemetry error diagnostics |
| `/api/v1/tesla/fleet-telemetry/error-vins`                        | VINs with telemetry errors           |

## Helix AI

All AI routes are mounted under `/api/v1/ai/...` and individually wrapped by `g.Wrap("<feature-id>", handler)`. Returning a `404` from a wrapped route means the feature is off (the `withAiFeature` HOC in the SPA also hides the surface). See [Helix AI](/guide/helix-ai) for the full feature list.

| Method | Path                                              | Purpose                                |
| ------ | ------------------------------------------------- | -------------------------------------- |
| POST   | `/api/v1/ai/chat`                                 | Chatbot endpoint (streaming SSE)       |
| POST   | `/api/v1/ai/<feature-id>/run`                     | One-shot or streaming feature run      |
| GET    | `/api/v1/ai/usage/today`                          | Per-user daily token / cost aggregate  |
| GET    | `/api/v1/ai/usage/by-feature?since=24h`           | Usage broken down by feature ID        |
| GET    | `/api/v1/ai/provider/health`                      | Active provider + health status        |
| POST   | `/api/v1/ai/feature/toggle`                       | Per-feature opt-in (off-by-default)    |
| POST   | `/api/v1/ai/feature/restore`                      | Restore last archived feature toggle set |

## Admin & data operations

Admin routes back the API logs, API Playground, API keys, Redis signal viewer, backup/restore, exports, data repair, database health, chatbot, changelog, and roadmap pages. Keep them behind authenticated ingress in production.
