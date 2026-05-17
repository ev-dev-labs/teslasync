# Code Structure

A guided tour of the TeslaSync repository. Not an exhaustive directory listing — those go stale within a sprint. Instead: what each top-level directory is responsible for, why it's separate from its neighbours, and how to decide where new code goes.

## The big picture

```
teslasync/
├── cmd/                     # Go entrypoints — one per binary
├── internal/                # Go code only this repo can import
├── web/                     # React SPA
├── migrations/              # SQL migrations, applied in order on boot
├── helm/teslasync/          # Helm chart for Kubernetes deployments
├── docker-compose.yml       # Default container topology
├── docs/                    # VitePress user docs (this site)
├── tools/                   # Code generators + CI vets
├── grafana/                 # Provisioned dashboards + datasources
├── prometheus/              # Scrape config + alert rules
└── .github/                 # CI workflows, audit skills, prompt library
```

Everything else is configuration for one of the above (e.g., `.env.example`, `Dockerfile.*`).

## Why the layout looks like this

Two principles drove the structure:

1. **The platform is bigger than a single service.** It's an API, four workers, a SPA, a docs site, a metrics stack, an optional AI layer, and an optional telemetry sidecar. Lumping everything into one directory would have made it impossible to reason about what changes when.
2. **Internal-only and shared boundaries matter.** Go has `internal/` for "no one outside this module can import this". The frontend has the `components/ui` and `components/charts` barrels for "this is the shared design system; don't import the underlying library directly". Both boundaries are enforced by CI, not by convention.

## The Go side

### `cmd/`

One subdirectory per binary. Each has a `main.go` that wires together packages from `internal/`:

| Path                              | Binary                  | Responsibility                                  |
| --------------------------------- | ----------------------- | ----------------------------------------------- |
| `cmd/teslasync/`                  | `teslasync`             | HTTP API + SSE + scheduled workers              |
| `cmd/notification-worker/`        | `notification-worker`   | Drains the notification queue, fans out to channels |
| `cmd/export-worker/`              | `export-worker`         | Generates CSV/JSON/Parquet exports asynchronously |
| `cmd/automation-worker/`          | `automation-worker`     | Schedules + executes automations                |
| `cmd/migrate/`                    | `migrate`               | Runs migrations standalone (CI / one-off ops)   |

Rule: `cmd/*` packages contain wiring only — no business logic. If you find yourself writing real code in a `cmd/` package, move it to `internal/` and import it.

### `internal/`

The bulk of the backend lives here. Each subdirectory is a bounded responsibility:

| Subdirectory                | What lives there                                              |
| --------------------------- | ------------------------------------------------------------- |
| `internal/api/`             | HTTP handlers, route registration, middleware                 |
| `internal/api/ai_routes.go` | Helix AI route wrapping (`g.Wrap("<feature-id>", h)`)         |
| `internal/auth/`            | Session, forward-auth header parsing, TOTP, token rotation    |
| `internal/tesla/`           | Tesla Fleet API client, OAuth, the 65 command endpoints       |
| `internal/telemetry/`       | Fleet Telemetry ingest, MQTT bridge, signal normalisation     |
| `internal/signal/`          | L1 in-process signal store + repository                       |
| `internal/redis/`           | L2 cache, pub/sub fanout, rate-limit counters                 |
| `internal/database/`        | DB connection, migrations, hypertable / continuous aggregate helpers |
| `internal/repository/`      | Repository pattern per domain (vehicles, drives, alerts, …)   |
| `internal/ai/`              | Helix AI — providers, decorators, strategies, tools, registry |
| `internal/ai/provider/`     | Ollama, OpenAI, Azure, Anthropic, mock                        |
| `internal/ai/dispatch/`     | Tool-use loop                                                 |
| `internal/ai/features/`     | The registry (source of truth for AI features)                |
| `internal/automation/`      | Trigger evaluation, action execution, schedule worker         |
| `internal/alerts/`          | Typed rule families, channel routing, throttling              |
| `internal/notifications/`   | Queue + channel adapters (email, SMS, push, webhook, …)       |
| `internal/exports/`         | Async export pipeline, format adapters                        |
| `internal/observability/`   | OpenTelemetry setup, trace + metric helpers, structured logging |
| `internal/config/`          | Env-var → typed config                                        |
| `internal/health/`          | `/healthz` and `/readyz` handlers                             |

### The layering rule

Within `internal/`, layers depend in one direction:

```
api ──▶ repository ──▶ database
  ▲                       │
  │                       ▼
ai, automation, alerts   PostgreSQL
```

- **Handlers** (`internal/api/`) are thin. They parse inputs, call a repository or a domain package, and render the response. No SQL, no business logic.
- **Repositories** (`internal/repository/`) own SQL. They expose typed methods (`GetByID`, `ListForVehicle`, `Upsert`) and return typed structs. No HTTP concerns.
- **Domain packages** (`internal/automation/`, `internal/alerts/`, `internal/ai/`) implement the actual logic. They call repositories for persistence and providers for I/O.
- **Infrastructure** (`internal/database/`, `internal/redis/`, `internal/telemetry/`) provides building blocks. They don't know about domain logic.

What NOT to do:

- Don't import `internal/api/` from anywhere else (it's the top of the stack)
- Don't `database/sql` directly outside `internal/repository/` and `internal/database/`
- Don't `fmt.Println` — use the package logger
- Don't return raw errors from handlers — wrap with context and let the middleware translate to HTTP status

### Where new backend code goes

Use this decision tree:

- "I'm exposing a new HTTP route" → `internal/api/`, plus the repository/domain code it calls
- "I'm adding a new Helix feature" → register in `internal/ai/features/registry.go`, add a strategy under `internal/ai/strategies/`, a handler under `internal/ai/handlers/`, wrap the route in `internal/api/ai_routes.go`, regenerate `web/src/ai/features.ts` with `go run ./tools/aigen`
- "I'm adding a new Tesla command" → `internal/tesla/client_commands.go`
- "I'm adding a new alert rule family" → `internal/alerts/rules/`
- "I'm adding a new notification channel" → `internal/notifications/channels/`
- "I'm adding a new background job" → either a new method on an existing worker or a new `cmd/<worker-name>/` binary if the responsibility is large

## The frontend side

### `web/`

```
web/
├── src/
│   ├── api/
│   │   ├── hooks/           # TanStack Query hooks (the only data-loading layer)
│   │   └── client.ts        # request() — adds /api/v1, headers, auth
│   ├── ai/
│   │   ├── features.ts      # AUTO-GENERATED from Go registry (never edit)
│   │   └── withAiFeature.ts # HOC that returns null if feature is off
│   ├── components/
│   │   ├── ui/              # Buttons, inputs, selects, modals (shared)
│   │   ├── charts/          # Chart primitives wrapping Recharts
│   │   ├── maps/            # Map primitives wrapping Leaflet
│   │   ├── data-display/    # <Distance>, <Speed>, <Currency>, <DateTime>, etc.
│   │   ├── branding/        # HelixMark, logos
│   │   ├── ai/              # AIFeatureCard, AIBadge, AIThinkingDots, etc.
│   │   └── layout/          # Layout shell, sidebar
│   ├── features/
│   │   ├── dashboard/
│   │   ├── vehicles/
│   │   ├── charging/
│   │   ├── alerts/
│   │   ├── automations/
│   │   ├── analytics/
│   │   ├── settings/
│   │   └── …                # 21 feature areas total
│   ├── hooks/               # Shared cross-feature hooks (useSettings, useUnits, …)
│   ├── lib/                 # Pure utilities (date, number, currency, unit conversion)
│   ├── i18n/                # English + locale JSON
│   └── styles/              # Tailwind base + custom CSS
├── public/                  # Static assets, PWA manifest
└── vite.config.ts
```

### The frontend layering rule

```
features/* ──▶ api/hooks ──▶ api/client ──▶ /api/v1/*
     │
     ├──▶ components/ui|charts|maps|data-display|branding
     ├──▶ hooks/
     └──▶ lib/
```

- **Pages** (`features/*/pages/`) compose components and call hooks. No `fetch()`. No raw SQL strings (obviously). No direct Recharts/Leaflet imports.
- **Hooks** (`api/hooks/`) are the only place that calls `request()`. URLs omit `/api/v1`. Query params are snake_case.
- **Components** (`components/*`) are presentation. They take data via props and emit events.
- **Lib** (`lib/`) is pure — no React, no hooks. Date, number, currency, unit-conversion utilities.

What NOT to do:

- Don't import Recharts or Leaflet outside `components/charts/` or `components/maps/`
- Don't import directly from `api/client` — always go through a hook
- Don't hardcode units (`km`, `mph`, `$`, `°C`) — use `useUnits()` / `useFormatting()` / `useDateFormat()`
- Don't render raw HTML form controls (`<button>`, `<input>`, `<select>`) — use the `components/ui` equivalents
- Don't write `useEffect`-driven data fetching — TanStack Query is the canonical pattern
- Don't edit `web/src/ai/features.ts` by hand — it's generated

### Where new frontend code goes

- "I'm adding a new page" → `web/src/features/<area>/pages/`
- "I'm adding a new shared widget" → `web/src/components/<category>/`
- "I'm adding a new data-loading hook" → `web/src/api/hooks/`
- "I'm adding a chart" → use existing chart primitives from `web/src/components/charts/`; only add a new primitive if no existing one fits
- "I'm adding a Helix feature surface" → wrap with `withAiFeature('<feature-id>')` and render via `AIFeatureCard`

## Supporting directories

### `migrations/`

197 numbered SQL files (`000001_*.up.sql`, `000001_*.down.sql`, …). Applied in order on API startup. Migrations are append-only — never edit a committed migration; add a new one to evolve.

### `tools/`

Code generators and CI vets:

| Tool          | Purpose                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `aigen`       | Generates `web/src/ai/features.ts` from `internal/ai/features/registry.go`         |
| `aivet`       | Validates the Helix off-by-default + wrapping contract                             |
| `migration-lint` | Static checks on new migrations                                                 |

### `helm/teslasync/`

The Helm chart. `values.yaml` is the contract for what you can configure; templates render Kubernetes manifests. Treat `values.yaml` as a reference document — every option there is something an operator might need to tune.

### `grafana/` + `prometheus/`

Provisioned dashboards and scrape config. The Grafana service mounts these at startup so dashboards exist on a fresh stack without manual import.

### `.github/`

Workflows, the prompt library used by the team's coding agent, and skills (like `audit-violations`) that wrap common dev tasks behind a script.

## What we deliberately don't do

- **No monorepo tools** (Nx, Turborepo, pnpm workspaces). The project has two language ecosystems (Go and TypeScript) and `go` + `npm` handle each natively. Adding a monorepo orchestrator on top would be ceremony.
- **No microservices for microservices' sake.** The API and the workers are separate binaries because they have different scaling and restart characteristics, not because they each get their own bounded context. Splitting further would multiply deployment complexity without benefit.
- **No client-side state management library** (Redux, MobX, Zustand). TanStack Query owns server state, React local state owns ephemeral UI state, the `useSettings` context owns user preferences. Nothing else has been needed.
- **No CSS-in-JS runtime.** Tailwind for utility, plain CSS for the rest. Predictable, fast, easy to lint.

## Where to learn more

- [Adding Features](/contributing/adding-features) — the workflow for adding a vertical slice
- [API Reference for Contributors](/contributing/api-reference) — the end-to-end pattern for a new resource
- [Architecture](/guide/architecture) — the runtime view, not the source view
