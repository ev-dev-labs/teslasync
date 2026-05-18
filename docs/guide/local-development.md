# Local Development

This page is for people working on TeslaSync itself — adding a feature, fixing a bug, contributing a docs change. If you only want to run the platform, see [Getting Started](/guide/getting-started) instead.

## The development loop, at a glance

There are three workflows depending on what you're changing:

| Changing…           | Run…                                                       | Reload cadence              |
| ------------------- | ---------------------------------------------------------- | --------------------------- |
| Frontend only       | `npm run dev` in `web/` against containerised backend      | Instant via Vite HMR        |
| Backend only        | `go run ./cmd/teslasync` against containerised data stores | Manual restart (~1 second)  |
| Both                | Two terminals: the above two side-by-side                  | Frontend instant, backend manual |
| Docs only           | `npm run docs:dev` in `docs/`                              | Instant via VitePress       |
| Helm chart          | `helm lint` + `helm template` against your values          | Validation, not runtime     |

We deliberately do not use a "rebuild everything on every change" workflow because the platform is large enough that a full rebuild is slower than a targeted restart.

## Requirements

- **Go 1.25.0** — match the `toolchain` in `go.mod`. Older Go works for some changes but the build pipeline expects 1.25.
- **Node 20+** — the frontend and docs both expect a modern Node.
- **Docker + Compose v2** — for the data plane (postgres, redis, mosquitto) and the optional service profiles.
- **psql** (optional but useful) — for inspecting the database while developing
- **gh** (optional) — for the GitHub CLI workflow we use for PRs

Helm and Kubernetes tools are only needed if you're working on the chart.

## Bring up just the dependencies

When you're iterating on Go or React code, you don't want the API or web container running — you want your local process to be the API or web. The dependencies still need to be up:

```bash
docker compose up -d postgres redis mosquitto grafana prometheus
```

That gives you the data plane on the documented ports without conflicting with your local processes.

If you want optional sidecars too:

```bash
docker compose --profile telemetry --profile commands --profile ai up -d \
  postgres redis mosquitto grafana prometheus \
  fleet-telemetry vehicle-command-proxy ollama
```

## Backend development

```bash
go mod download
go run ./cmd/teslasync
```

The API listens on `:8080` and reads `.env` (or your shell environment). The four worker binaries follow the same pattern:

```bash
go run ./cmd/notification-worker
go run ./cmd/export-worker
go run ./cmd/automation-worker
```

You usually only need to run the workers locally if you're actively changing them. The containerised versions can stay up and talk to your local API.

### Useful backend checks

```bash
go vet ./...
go test ./...
go test -race ./...
go test -run TestSpecific ./internal/api/...
go build ./...
```

The race-detector run is mandatory before opening a PR. Concurrency bugs in the telemetry pipeline are subtle and the race detector catches most of them.

### Hot-reload-ish for Go

There is no Go HMR. The fastest loop is:

1. Make your change
2. Save
3. `Ctrl-C` the running process
4. Re-run `go run ./cmd/teslasync`

That's ~1 second on a warm build cache. If you want it shorter, `air` works but introduces its own footguns; we don't ship a config for it.

### Backend rules that are not optional

- Handlers are thin — no SQL inline, no business logic. Persistence goes through repositories.
- All SQL is parameterised. No string concatenation, ever.
- Errors are wrapped with context (`fmt.Errorf("loading vehicle %d: %w", id, err)`) so the log message identifies the operation.
- Structured logs only — no `fmt.Println`. Use the package-level zerolog logger.
- New environment variables are added in three places at once: `internal/config`, `docker-compose.yml`, and `helm/teslasync/values.yaml` + templates. If you only update one, you'll ship a feature that works in your environment and breaks in everyone else's.
- New AI routes are wrapped by `g.Wrap("<feature-id>", handler)` and the feature is registered in `internal/ai/features/registry.go` with `DefaultOn: false`.

## Frontend development

```bash
cd web
npm install
npm run dev
```

Vite serves at `http://localhost:3000`. It proxies `/api` and `/events` to `http://localhost:8080` so the SPA talks to your running backend without CORS dance.

### Useful frontend checks

```bash
npx tsc --noEmit          # type check
npm run build             # production build (catches lazy-load issues)
npm test                  # Vitest
npm run lint              # ESLint
```

The full pre-PR sequence is:

```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
```

### Frontend rules that are not optional

- Data loading goes through `web/src/api/hooks/*`. No `fetch()` in components, no `useEffect`-driven `fetch()`. Use TanStack Query hooks.
- Hook URLs omit `/api/v1` because the request client adds it.
- Query params are snake_case.
- Pages render loading, error, and empty states. Always. Even for tiny widgets.
- Shared UI comes from `@/components/ui` / `@/components/charts` / `@/components/maps`. Don't import Recharts or Leaflet directly in feature code.
- Units, dates, currency render through `useUnits()` / `useFormatting()` / `useDateFormat()`. Hardcoded "km" / "$" / `toLocaleString()` calls fail the lint.
- User-visible strings go through i18n with English fallbacks.
- Helix AI components wrap with `withAiFeature('<feature-id>')` — the HOC handles the off-by-default rendering for you.

### Service-worker behaviour in dev

Production builds register a service worker that caches assets aggressively. Development does **not** unless you set `VITE_PWA_DEV=true`. If you previously enabled dev mode and now have stale behaviour on `localhost`, clear the service worker in your browser's devtools once.

## Keeping the Helix AI feature mirror in sync

The frontend's `web/src/ai/features.ts` is **auto-generated** from `internal/ai/features/registry.go`. If you add or modify an AI feature:

```bash
go run ./tools/aigen          # regenerate
go run ./tools/aigen --check  # CI mode: fail if regen would change the file
```

CI also runs `tools/aivet` which enforces:

- Every registered feature ID is referenced by exactly one wrapped backend route
- Every wrapped backend route references a registered feature ID
- Every feature is registered with `DefaultOn: false`
- Every AI React component is wrapped by `withAiFeature`

Don't edit `web/src/ai/features.ts` by hand; the next `aigen` run will overwrite it.

## Docs development

```bash
cd docs
npm install
npm run docs:dev    # local preview with hot reload
npm run docs:build  # production build into docs/.vitepress/dist
```

The docs config (`docs/.vitepress/config.ts`) controls navigation, sidebar, and which directories are included. Internal-only docs (audits, runbooks, signal-audits, observability, architecture ADRs, dev guidelines) are excluded from the published site via `srcExclude` — they're still in the repo, just not built.

## Tests

| Suite                    | How to run                          | What it covers                                            |
| ------------------------ | ----------------------------------- | --------------------------------------------------------- |
| Go unit tests            | `go test ./...`                     | Pure-Go logic, repositories with an in-memory DB          |
| Go race tests            | `go test -race ./...`               | Concurrency bugs in the telemetry/FSM/typed-rule paths    |
| Go integration tests     | `go test -tags=integration ./...`   | Tests that need real PostgreSQL / Redis / MQTT            |
| Frontend unit tests      | `cd web && npm test`                | Vitest + React Testing Library for components and hooks   |
| TypeScript type check    | `cd web && npx tsc --noEmit`        | Type errors across the SPA                                |
| Phase-50 final-gate      | `go test ./test/phase50/...`        | Off-by-default + wrapping contract for Helix features     |
| Helm lint                | `helm lint helm/teslasync`          | Chart syntax and convention checks                        |
| Helm template            | `helm template ... -f values.yaml`  | Renders the chart against your values to spot issues      |
| audit-violations skill   | `bash .github/skills/audit-violations/audit.sh` | Inline styles, raw HTML, wrong imports |

The pre-PR baseline is "everything in this table passes". CI runs the same set.

## Debugging tips

- **The backend isn't seeing my env change** — Go binaries snapshot the environment at startup. Restart the process.
- **The frontend isn't seeing my code change** — check the Vite terminal for HMR errors. Some files (e.g., new context providers) need a full reload.
- **Tests pass locally but fail in CI** — most often a race condition or timezone assumption. Run with `-race` and with `TZ=UTC` locally.
- **A migration won't apply** — `schema_migrations.dirty=true` blocks subsequent migrations. Inspect, fix the underlying issue, set `dirty=false` and re-run.
- **`tools/aivet` is failing** — you added an AI route without registering the feature, or vice versa. Re-run `go run ./tools/aigen` and check `git diff web/src/ai/features.ts`.

## Commit and PR conventions

- Branch from `main`, name descriptively (`feat/cost-forecast-narration`, `fix/charging-null-safety`, `docs/rewrite-readme-helix`).
- Conventional-commit-ish prefixes are common in the history (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`) — match the surrounding style.
- Include a Co-authored-by trailer when working with the Copilot CLI.
- Update docs in the same PR as behaviour, configuration, or route changes.
- Open the PR with a description that includes the problem, the approach, and the verification you ran. CI will block on the test suite; do the verification yourself first so review can focus on the change.
