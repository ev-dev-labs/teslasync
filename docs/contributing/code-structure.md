# Code Structure

TeslaSync uses a Go backend and a feature-based React frontend.

## Backend

| Path | Purpose |
|---|---|
| `cmd/teslasync` | API server entrypoint |
| `cmd/notification-worker` | Notification worker binary |
| `cmd/export-worker` | Export worker binary |
| `cmd/automation-worker` | Automation worker binary |
| `internal/api` | Chi router, handlers, middleware |
| `internal/database` | pgx repositories and migrations integration |
| `internal/models` | API/database models |
| `internal/tesla` | Tesla Fleet API client |
| `internal/mqtt` | MQTT integration |
| `internal/worker` | Background workers |
| `internal/config` | Environment configuration |
| `migrations` | Database migrations |

## Frontend

| Path | Purpose |
|---|---|
| `web/src/App.tsx` | Lazy routes and safe route wrapper |
| `web/src/features` | Domain pages and feature-local components |
| `web/src/api` | Request client, types, hooks |
| `web/src/components/ui` | Buttons, cards, forms, panels, command palette |
| `web/src/components/charts` | Chart wrappers and Recharts re-exports |
| `web/src/components/maps` | Map wrappers and React Leaflet re-exports |
| `web/src/components/layout` | Layout, page shell, navigation |
| `web/src/components/feedback` | Loading, errors, toasts, prompts |
| `web/src/hooks` | App hooks for SSE, settings, shortcuts, notifications |
| `web/src/lib` | Formatting, units, resilience, signal catalog, utilities |

## Frontend rules

- Pages import shared UI from component category barrels.
- Pages do not import Recharts or Leaflet directly.
- Data loading uses API hooks, not component-local `fetch()`.
- Hook URLs omit `/api/v1`.
- Query params use snake_case.
- Pages always render loading/error/empty states.
- User-visible strings should use i18n fallbacks.

## Backend rules

- Keep handlers thin and delegate persistence to repositories/services.
- Use parameterized SQL only.
- Wrap errors with context.
- Use zerolog for structured logs.
- Update config, Compose, and Helm together when adding environment variables.