# Adding Features

How to add a new feature to TeslaSync without leaving holes in the integration surface. The shortest path that produces a feature that ships.

## The vertical-slice principle

Every TeslaSync feature spans the stack: a database table or column, a repository method, a service or domain function, an HTTP handler, a route registration, a frontend hook, a page or widget, tests at each layer, and a docs entry. Adding only some of those layers produces a feature that "works on my machine" — adding all of them produces a feature that ships.

The rest of this page walks through one worked example end-to-end. Pattern-match it onto whatever you're actually building.

## Worked example — "Tire pressure trend" page

Pretend we want a new page under the Vehicle Systems area that shows tire pressure over time per axle, with deviation alerts and a Helix narration block. Here's how that lands in the repo.

### Step 1 — Decide what data you need

Before any code: is the data already captured? Look at `internal/telemetry/signals/` and the `signal_log` schema. Tire pressure is already a streamed signal (`tire_pressure_fl`, `tire_pressure_fr`, `tire_pressure_rl`, `tire_pressure_rr` in kPa per Tesla's convention, stored as SI Pa after normalisation).

If the data isn't captured, you'd add it to the signal normaliser first. In this case we're good.

### Step 2 — Repository method

Add a method to the relevant repository. Tire pressure is a vehicle-scoped signal, so it goes in `internal/repository/signals_repo.go` (or a tire-pressure-specific repo if the existing one is already busy):

```go
type TirePressureTrendPoint struct {
    Timestamp  time.Time `json:"timestamp"`
    FrontLeft  float64   `json:"front_left"`   // Pa
    FrontRight float64   `json:"front_right"`  // Pa
    RearLeft   float64   `json:"rear_left"`    // Pa
    RearRight  float64   `json:"rear_right"`   // Pa
}

func (r *SignalsRepo) TirePressureTrend(
    ctx context.Context,
    vehicleID int64,
    from, to time.Time,
    bucket time.Duration,
) ([]TirePressureTrendPoint, error) {
    // Parameterised SQL, time_bucket() from TimescaleDB
    // Return SI values; conversion happens at render time
}
```

Repository rules: parameterised queries, typed return, SI units everywhere, no business logic.

### Step 3 — Tests for the repository

Add `signals_repo_test.go` cases. The pattern in the codebase:

```go
func TestTirePressureTrend(t *testing.T) {
    db := testdb.New(t)
    repo := repository.NewSignalsRepo(db)

    testdb.SeedTirePressureSignals(t, db, /* … */)

    points, err := repo.TirePressureTrend(ctx, 1, from, to, time.Minute)
    require.NoError(t, err)
    require.Len(t, points, 60)
    // Assert SI values
}
```

Integration-test-tagged tests run against a real Postgres via `docker compose up postgres`. Run `go test -tags=integration ./internal/repository/...`.

### Step 4 — HTTP handler

Add the handler in `internal/api/tire_pressure_handlers.go`:

```go
func (s *Server) handleTirePressureTrend(w http.ResponseWriter, r *http.Request) {
    vehicleID, err := pathParamInt64(r, "vehicle_id")
    if err != nil {
        respondError(w, http.StatusBadRequest, "invalid vehicle_id", err)
        return
    }

    from, to, bucket, err := parseTrendQuery(r.URL.Query())
    if err != nil {
        respondError(w, http.StatusBadRequest, "invalid query", err)
        return
    }

    points, err := s.repos.Signals.TirePressureTrend(r.Context(), vehicleID, from, to, bucket)
    if err != nil {
        respondError(w, http.StatusInternalServerError, "loading trend", err)
        return
    }

    respondJSON(w, http.StatusOK, map[string]any{"points": points})
}
```

Handlers are thin: parse → validate → call repo → render. No business logic, no SQL.

### Step 5 — Route registration

In `internal/api/router.go`:

```go
r.Get("/api/v1/vehicles/{vehicle_id}/tire-pressure/trend", s.handleTirePressureTrend)
```

URL conventions:

- `/api/v1/<plural-resource>/<id>/<sub-resource>`
- Path params snake_case
- Query params snake_case (`?from=…&to=…&bucket=1m`)

If the new endpoint needs auth (it does — every business endpoint does), it lives inside the authenticated route group. The forward-auth middleware handles the rest.

### Step 6 — Handler tests

```go
func TestHandleTirePressureTrend(t *testing.T) {
    srv := testserver.New(t)
    res := srv.GET("/api/v1/vehicles/1/tire-pressure/trend?from=…&to=…&bucket=1m")
    require.Equal(t, http.StatusOK, res.Code)

    var body struct{ Points []TirePressureTrendPoint }
    require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
    require.Len(t, body.Points, 60)
}
```

### Step 7 — Frontend hook

In `web/src/api/hooks/useTirePressureTrend.ts`:

```ts
export interface TirePressureTrendPoint {
  timestamp: string;
  front_left: number;   // Pa
  front_right: number;
  rear_left: number;
  rear_right: number;
}

export function useTirePressureTrend(
  vehicleId: number | undefined,
  range: { from: string; to: string; bucket: string },
) {
  return useQuery({
    queryKey: ['tire-pressure-trend', vehicleId, range],
    enabled: vehicleId !== undefined,
    queryFn: () =>
      request<{ points: TirePressureTrendPoint[] }>(
        `/vehicles/${vehicleId}/tire-pressure/trend`,
        { params: { from: range.from, to: range.to, bucket: range.bucket } },
      ),
  });
}
```

Hook rules:

- URL omits `/api/v1`
- Query params snake_case
- Returns typed data
- `enabled` guards against undefined inputs
- `queryKey` includes everything that should bust the cache

### Step 8 — Page or widget

In `web/src/features/vehicle-systems/pages/TirePressureTrendPage.tsx`:

```tsx
export function TirePressureTrendPage() {
  const { vehicle } = useSelectedVehicle();
  const range = useDateRange('last_7_days');
  const { data, isLoading, error } = useTirePressureTrend(vehicle?.id, range);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError error={error} />;
  if (!data?.points.length) return <EmptyState />;

  return (
    <PageLayout title={t('tirePressure.trend.title', 'Tire Pressure Trend')}>
      <TirePressureTrendChart points={data.points} />
      <TirePressureSummary points={data.points} />
      <AITirePressureAnomalyExplanation
        featureId="anomaly-explanation"
        points={data.points}
      />
    </PageLayout>
  );
}
```

Page rules:

- Loading / error / empty states are mandatory
- Units, dates, currency render through `useUnits()` / `useFormatting()` / `useDateFormat()` — never `toLocaleString()` or hardcoded "kPa"
- Shared widgets come from `@/components/ui` / `@/components/charts` / `@/components/maps`
- User-visible strings via i18n with English fallback

### Step 9 — Route registration (frontend)

In `web/src/router/routes.tsx`:

```tsx
{
  path: '/vehicles/:vehicleId/tire-pressure/trend',
  element: lazy(() => import('@/features/vehicle-systems/pages/TirePressureTrendPage')),
}
```

If the navigation should appear in the sidebar, add it to `web/src/components/layout/Layout.tsx`.

### Step 10 — Page tests

```tsx
describe('TirePressureTrendPage', () => {
  it('renders the chart when data is present', async () => {
    server.use(rest.get('/api/v1/vehicles/1/tire-pressure/trend', (_req, res, ctx) =>
      res(ctx.json({ points: mockPoints })),
    ));
    render(<TirePressureTrendPage />, { wrapper: TestProviders });
    expect(await screen.findByTestId('tire-pressure-chart')).toBeInTheDocument();
  });

  it('shows the empty state when no data', async () => { /* … */ });
  it('shows the error state when the request fails', async () => { /* … */ });
});
```

### Step 11 — Helix narration (optional)

If you want a Helix-narrated insight on this page, the workflow:

1. **Register the feature** in `internal/ai/features/registry.go`:

   ```go
   {
     ID:          "tire-pressure-narration",
     DisplayName: "Tire pressure narration",
     Description: "Helix narrates trends and anomalies in tire pressure.",
     Category:    "narratives",
     DefaultOn:   false,
   }
   ```

2. **Add a strategy** under `internal/ai/strategies/tire_pressure_narration/strategy.go` implementing the strategy interface (`Render`, `Tools`, `Decorators`).

3. **Add a handler** under `internal/api/ai_handlers/ai_tire_pressure_narration_handler.go`.

4. **Wrap the route** in `internal/api/ai_routes.go`:

   ```go
   g.Wrap("tire-pressure-narration", h.handleTirePressureNarration)
   ```

5. **Regenerate the mirror**:

   ```bash
   go run ./tools/aigen
   ```

6. **Add a frontend component** under `web/src/features/vehicle-systems/components/AITirePressureNarration.tsx`, wrapped with `withAiFeature('tire-pressure-narration')` and rendered via the shared `AIFeatureCard` scaffold.

7. **Verify the contract** — `tools/aivet` will fail the build if any of the wrapping/registration steps are missing.

### Step 12 — Docs

Update at least one of:

- `docs/features/<area>.md` — if the new page belongs in an existing feature card
- `docs/features/<new-card>.md` — if it deserves its own card
- `docs/guide/api-endpoints.md` — for any new API route
- `docs/guide/helix-ai.md` — for any new Helix feature

If the change introduces a new env var, update `docs/guide/configuration.md` AND `.env.example` AND `helm/teslasync/values.yaml` in the same PR.

### Step 13 — Verify everything

```bash
# Backend
go vet ./...
go test -race ./...
go build ./...

# Frontend
cd web
npx tsc --noEmit
npm run lint
npm test
npm run build

# Helix contract (if you touched AI)
go run ./tools/aigen --check
go test ./test/phase50/...

# Docs (if you touched them)
cd docs
npm run docs:build
```

All of the above pass before opening the PR.

## Patterns for common shapes

### A new background job

Either:

- Add a scheduled method on an existing worker (in `cmd/automation-worker/` or similar) if it's a small responsibility, **or**
- Create a new binary in `cmd/<worker-name>/` if it's large enough to deserve its own lifecycle

Workers register with the shared scheduling helper and emit OpenTelemetry traces + structured logs.

### A new alert rule family

`internal/alerts/rules/<family>.go`. Implement the rule interface (`Evaluate(ctx, vehicleID) []FiredRule`). The typed-rules framework handles throttling, deduplication, and channel routing for you.

### A new notification channel

`internal/notifications/channels/<channel>.go`. Implement the channel interface (`Send(ctx, msg) error`). Register the channel in the notification dispatcher. The frontend gets a new entry in **Settings → Notifications** automatically if you add the channel to the metadata file.

### A new Tesla command

`internal/tesla/client_commands.go`. Add the endpoint definition. The route + handler are generic — they call the typed command method by name. The frontend gets a new button in the Command Center automatically if you add the metadata entry.

### A new export format

`internal/exports/formats/<format>.go`. Implement the format interface (`Render(ctx, w, rows) error`). Register in the format dispatcher. The frontend's export modal gets the new format in its dropdown.

### A new Helix feature

See step 11 above — the canonical six-step workflow.

## What NOT to do

- **Don't add a "quick endpoint" that bypasses the repository.** Even a one-line SQL query goes in a repository method. Future maintainers will thank you.
- **Don't write inline `style={ {...} }` in components.** Tailwind utility classes for almost everything; the `components/ui` library for the rest.
- **Don't fetch in `useEffect`.** TanStack Query exists. Use it.
- **Don't hardcode units.** `useUnits()` is one import away.
- **Don't ship a Helix feature that's on by default.** CI will block you, but more importantly the platform's privacy contract depends on it.
- **Don't edit `web/src/ai/features.ts` by hand.** Regenerate.
- **Don't add a route without updating the docs.** It will become invisible to new users.

## Where to learn more

- [Code Structure](/contributing/code-structure) — package responsibilities map
- [API Reference for Contributors](/contributing/api-reference) — the end-to-end pattern for a new resource
- [Helix AI](/guide/helix-ai) — the registry, strategy, decorator, and tool model in depth
