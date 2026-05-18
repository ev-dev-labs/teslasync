# API Reference for Contributors

This page is the developer-facing view of the API contract. For the user-facing list of endpoints, see [API Endpoints](/guide/api-endpoints).

What goes here: the conventions every endpoint follows, the patterns we use across the codebase, the end-to-end shape of a request, and the contract enforced by CI and review. Internalising these means a new endpoint slots into the platform without surprises.

## The single end-to-end example

One worked example beats a list of bullet points. Here is what happens when the frontend fetches the list of drives for a vehicle.

### The request travels through these layers

```
Browser
  │
  │  GET /api/v1/vehicles/1/drives?limit=20&before=2025-01-01T00:00:00Z
  ▼
Nginx (in web container)
  │  proxies /api/* to teslasync-api:8080
  ▼
Forward-auth middleware
  │  reads FORWARD_AUTH_HEADER → session lookup → resolves User
  ▼
Router (chi.Mux)
  │  dispatches to handleListDrives
  ▼
Handler  internal/api/drive_handlers.go
  │  parses vehicleID, query params; validates user has access to vehicle
  │  calls repo.Drives.ListForVehicle(ctx, vehicleID, opts)
  ▼
Repository  internal/repository/drives_repo.go
  │  parameterised SQL against drives table + lateral join for stats
  ▼
Database
  │  returns rows
  ▼
Repository
  │  scans into typed []Drive
  ▼
Handler
  │  renders JSON via respondJSON
  ▼
Browser
```

### The frontend hook

```ts
export function useDrives(
  vehicleId: number | undefined,
  opts?: { limit?: number; before?: string },
) {
  return useQuery({
    queryKey: ['drives', vehicleId, opts],
    enabled: vehicleId !== undefined,
    queryFn: () =>
      request<{ drives: Drive[] }>(
        `/vehicles/${vehicleId}/drives`,
        { params: { limit: opts?.limit, before: opts?.before } },
      ),
  });
}
```

That's the entire vertical for "list drives". Every endpoint in the platform follows the same shape.

## URL conventions

| Convention                                | Example                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| Versioned prefix                          | `/api/v1/…` (added by the request client; hooks omit) |
| Resource names plural, kebab if multi-word | `/vehicles`, `/charging-sessions`, `/automation-rules` |
| Resource-scoped sub-resources             | `/vehicles/{id}/drives`, `/drives/{id}/legs`          |
| Path params snake_case                    | `{vehicle_id}`, `{drive_id}`                           |
| Query params snake_case                   | `?from=…&to=…&bucket=1m`                               |
| IDs are integers (postgres BIGSERIAL)     | `/vehicles/1`, not `/vehicles/abc-uuid`               |

The frontend rule: **never include `/api/v1` in hook URLs.** The request client adds it. Doubled prefix (`/api/v1/api/v1/...`) is a common bug and the audit catches it.

## HTTP methods

| Method  | Used for                                                  |
| ------- | --------------------------------------------------------- |
| GET     | Reads. Idempotent. May be cached by TanStack Query.       |
| POST    | Mutations that create or trigger something                |
| PUT     | Full-resource replacement (rare — we prefer PATCH)        |
| PATCH   | Partial updates                                           |
| DELETE  | Removals. Soft-delete where it makes business sense.      |

Tesla commands are POST regardless of underlying semantics — they all trigger something.

## Status codes

| Code | When                                                                |
| ---- | ------------------------------------------------------------------- |
| 200  | Read or update succeeded                                            |
| 201  | New resource created (include `Location` header where useful)      |
| 202  | Accepted for async processing (exports, long-running automations)   |
| 204  | Delete succeeded with no body                                       |
| 400  | Client-side validation failure — bad JSON, bad query params         |
| 401  | Unauthenticated — forward-auth header missing or invalid            |
| 403  | Authenticated but not authorised for this resource                  |
| 404  | Resource not found, OR the requested Helix feature is disabled      |
| 409  | Conflict — e.g., trying to enrol TOTP when already enrolled         |
| 422  | Semantic validation failure (data well-formed but invalid)          |
| 429  | Rate-limited — Helix `AI_RATE_LIMIT_PER_MIN`, command rate limits   |
| 500  | Server bug — wrapped error logged with context                      |
| 503  | Upstream failure (Tesla API, MQTT broker) — usually transient       |

The 404-for-disabled-Helix-feature is deliberate. The frontend treats it identically to "this feature isn't in the registry" — both are "you can't use this right now".

## Response shapes

For lists:

```json
{ "drives": [ {…}, {…} ] }
```

For single resources:

```json
{ "drive": {…} }
```

For paginated lists:

```json
{ "drives": [ … ], "next_before": "2024-12-15T08:30:00Z" }
```

For errors:

```json
{ "error": "human-readable summary", "code": "drive_not_found" }
```

The `code` field is stable; callers can switch on it. The `error` field is human-readable and may change.

## Authentication

All endpoints under `/api/v1/*` are authenticated **unless** explicitly opted out. The forward-auth middleware:

1. Reads the configured header (`FORWARD_AUTH_HEADER`, default `X-Forwarded-User`)
2. Looks up or creates the User record
3. Attaches the User to the request context

Endpoints reach the User via `auth.UserFromContext(r.Context())`. Helpers in `internal/auth/` enforce per-resource authorisation (e.g., "user must own this vehicle").

Public endpoints that bypass auth:

- `/healthz`, `/readyz`
- Tesla OAuth callback
- The drive-sharing token endpoint (uses token-based auth)
- Automation webhook receivers (uses webhook secret)
- The well-known partner-key endpoint
- Helix RAG ingest endpoints in dev mode

Each public endpoint has its own protection (token, rate limit, signature). "Public" means "bypasses forward-auth", not "unprotected".

## The Helix AI route wrapping contract

Helix routes use a special wrapper:

```go
// internal/api/ai_routes.go
g.Wrap("anomaly-explanation", aiHandlers.handleAnomalyExplanation)
g.Wrap("nl-alert-builder", aiHandlers.handleNlAlertBuilder)
// …
```

`g.Wrap` does three things for every wrapped route:

1. Looks up the feature in the registry. If the feature isn't enabled in the user's settings, returns 404 immediately — the handler never runs.
2. Applies the five decorators in order: trace → audit → cost → ratelimit → redact.
3. Records the call in `ai_call_log` with provider, model, tokens, cost, latency.

The pairing is enforced by `tools/aivet` in CI:

- Every wrapped route must reference a feature ID that exists in `internal/ai/features/registry.go`
- Every feature in the registry must be referenced by exactly one wrapped route
- No feature may be registered with `DefaultOn: true`
- Every AI React component must be wrapped by `withAiFeature('<feature-id>')`

If any of those checks fail, the build fails.

## Adding a new endpoint — checklist

This is the checklist used in code review:

- [ ] URL follows conventions (versioned, plural, snake_case, resource-scoped)
- [ ] Method is the right one (GET for reads, POST for triggers, PATCH for partial updates, DELETE for removals)
- [ ] Handler lives in `internal/api/<area>_handlers.go`, is thin, no SQL, no business logic
- [ ] Authorisation enforced (user owns the vehicle / has the role / etc.)
- [ ] Repository method exists in `internal/repository/<area>_repo.go`, parameterised, typed return
- [ ] All numeric values returned in SI (meters, m/s, °C, Pa, kWh stored as Joules / 3.6e6, etc.)
- [ ] Timestamps in RFC3339 (`time.RFC3339Nano`)
- [ ] Handler test covers happy path, 4xx, and (where applicable) auth failure
- [ ] Repository test covers happy path, empty case, and edge cases (boundary timestamps, etc.)
- [ ] Frontend hook lives in `web/src/api/hooks/`, omits `/api/v1`, snake_case params
- [ ] If a new env var was introduced, it's in `internal/config/`, `.env.example`, AND `helm/teslasync/values.yaml`
- [ ] Docs updated: `docs/guide/api-endpoints.md` and the relevant feature card
- [ ] For Helix endpoints: feature in registry, route wrapped, mirror regenerated, frontend wrapped, `tools/aivet` passes

## Adding a new resource — the wider pattern

When the new endpoint introduces a whole new resource (not just a new operation on an existing one), the pattern is:

1. **Migration** in `migrations/NNNNNN_<resource>.up.sql` + `.down.sql`. Includes the table, indexes, any continuous aggregates, FK references.
2. **Model** in `internal/repository/<resource>_repo.go` — the typed struct mirroring the table.
3. **Repository** with the typed methods you need (Get, List, Insert, Update, Delete as needed).
4. **Service / domain code** in `internal/<area>/` if the resource has behaviour beyond CRUD.
5. **Handlers** in `internal/api/<resource>_handlers.go`.
6. **Routes** in `internal/api/router.go`.
7. **TypeScript types** in `web/src/api/types.ts` or near the hook.
8. **Hooks** in `web/src/api/hooks/`.
9. **Components / pages** in `web/src/features/<area>/`.
10. **Sidebar nav** in `web/src/components/layout/Layout.tsx` if the resource gets its own page.
11. **Tests at every layer** above.
12. **Docs** — at minimum the feature card and the API endpoints reference.

## Conventions that aren't optional

- **SI units everywhere.** The database stores SI; the API returns SI; conversion happens at React render time via `useUnits()`. Adding a non-SI field is a contract break.
- **Errors are wrapped with context.** `fmt.Errorf("loading drives for vehicle %d: %w", id, err)`. The log middleware shows the chain; the response shows a sanitised summary.
- **No `panic()` in handler code paths.** Defensive nil-checks, explicit error returns. A panic in a handler kills the goroutine and shows up as a 500 with no actionable info in the log.
- **Idempotency for mutating endpoints.** Where it makes sense, accept an `Idempotency-Key` header and dedupe.
- **Don't leak internal types.** The DB row struct and the API response struct may be different. Map between them deliberately when the wire format and the storage format diverge (e.g., adding a computed field, hiding internal IDs).
- **Don't change a public field's type or name without a migration plan.** Add the new field, deprecate the old, ship a release, remove the old in a later release.

## Where to learn more

- [API Endpoints](/guide/api-endpoints) — the user-facing reference of what's exposed
- [Architecture](/guide/architecture) — the runtime view of how requests flow
- [Code Structure](/contributing/code-structure) — what lives where in the repo
- [Adding Features](/contributing/adding-features) — the worked end-to-end example
- [Helix AI](/guide/helix-ai) — the registry / strategy / decorator model in depth
