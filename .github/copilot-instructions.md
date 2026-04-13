# TeslaSync — Copilot Instructions

## ⚠️ COMPLETION & INTEGRITY STANDARDS

These rules exist because agents consistently violate them. Read carefully.

### Anti-Dishonesty
```
❌ DO NOT claim "all checks pass" without actually running them
❌ DO NOT say "TypeScript compiles clean" without running `npx tsc --noEmit`
❌ DO NOT say "0 violations found" without running grep/audit commands
❌ DO NOT report completion percentages you haven't verified
✅ DO run every verification command and paste the actual output
✅ DO show the raw terminal output, not a summary of what you think it says
```

### Anti-Shortcuts
```
❌ DO NOT stub pages with "Coming soon" or "No data available" as the only content
❌ DO NOT reduce a 600-line page to 100 lines and call it "refactored"
❌ DO NOT gate ALL page content behind a single `{data && ...}` or `empty={!data}`
❌ DO NOT skip sections that seem complex — implement ALL of them
❌ DO NOT create placeholder components that render nothing useful
❌ DO NOT use `any` type to avoid writing proper interfaces
✅ DO implement every section the original page had
✅ DO keep line count within ±30% of the original (unless genuinely simpler)
✅ DO show section-by-section evidence that each section renders
```

### Anti-Laziness
```
❌ DO NOT copy-paste the same component 5 times instead of creating a shared one
❌ DO NOT hardcode data that should come from API hooks
❌ DO NOT skip error handling, loading states, or empty states
❌ DO NOT omit i18n on "just a few strings"
❌ DO NOT leave TODO/FIXME comments instead of implementing the code
❌ DO NOT import a library just to use one function — check if a shared util exists
✅ DO handle loading, error, AND empty states for every data source
✅ DO create shared components when you see the same pattern 2+ times
✅ DO write complete implementations, not scaffolds
```

### Anti-Revert (CRITICAL)
```
❌ DO NOT revert to old code patterns to "fix" issues in refactored code
❌ DO NOT re-import from old `../api` or `../../api` — fix the new hooks instead
❌ DO NOT restore old `pages/` imports — fix the new `features/` code
❌ DO NOT bring back clsx, old fetch patterns, or class components
❌ DO NOT undo the shared component architecture to bypass a bug
❌ DO NOT copy old page code wholesale — adapt it to the new architecture
❌ DO NOT reintroduce direct recharts/leaflet/framer-motion imports

When fixing a bug in refactored code:
✅ DO fix the NEW code using the NEW architecture (hooks, shared components, Tailwind)
✅ DO check the old code in git history for LOGIC reference only, not for copy-paste
✅ DO use: import from @/components/, @/api/hooks/, @/lib/ — never from old paths
✅ DO keep all refactoring improvements (i18n, null safety, shared components)

If something worked in the old code but not in the new code:
  1. Understand WHY it worked (what data, what endpoint, what logic)
  2. Reproduce that LOGIC in the new architecture
  3. Never transplant old code directly — it will reintroduce every violation we fixed
```

### Verification Protocol
Before reporting any task as complete, you MUST:
1. **Run TypeScript**: `cd web && npx tsc --noEmit` — paste output
2. **Run violations audit**: Check for inline styles, raw HTML, wrong imports — paste counts
3. **Compare line counts**: New file must be ≥ 70% of original (for restorations)
4. **Count sections**: grep for GlassPanel/ChartContainer — compare against original
5. **Verify hooks**: Confirm every hook URL matches a route in `internal/api/router.go`

**If you cannot run a verification step, say so explicitly — do not fabricate results.**

---

## Project Overview

TeslaSync is a **self-hosted Tesla Fleet Intelligence Platform** — Go 1.25 backend + React 18 SPA.
Collects, analyzes, and visualizes Tesla vehicle data via Fleet API + Fleet Telemetry streaming.
**Repository:** `github.com/ev-dev-labs/teslasync`

## Architecture

```
React SPA (Vite 5) ──▶ Nginx reverse proxy ──▶ Go API Server (:8080)
                                                  │   │   │   │
                                            Postgres Redis MQTT Tesla API
```

**Services:** teslasync (:8080), web (:3000), notification-worker (:8081), export-worker (:8082), postgres, redis, mosquitto, grafana, fleet-telemetry (optional)

## ⛔ PROHIBITED PATTERNS — These will be rejected in code review

```
❌ 1. INLINE STYLES with static CSS variables
   BAD:  style={{ color: 'var(--text-primary)' }}
   GOOD: className="text-white/90"
   EXCEPTION: Dynamic computed values (ternary, CHART_COLORS[i]), Recharts wrapperStyle/contentStyle

❌ 2. RAW HTML elements (use shared components)
   BAD:  <button onClick={...}>Save</button>
   GOOD: <Button onClick={...}>Save</Button>
   Applies to: button, input, textarea, select, table — always use @/components/ui/ equivalents

❌ 3. DIRECT library imports in pages/features
   BAD:  import { LineChart } from 'recharts'
   BAD:  import { MapContainer } from 'react-leaflet'
   GOOD: import { LineChart, Area, XAxis } from '@/components/charts'
   GOOD: import { MapContainer, Polyline } from '@/components/maps'

❌ 4. OLD API imports or fetch/useEffect for data loading
   BAD:  import { getVehicles } from '../api'
   BAD:  useEffect(() => { fetch('/api/...').then(setData) }, [])
   GOOD: import { useVehicles } from '@/api/hooks/useVehicles'

❌ 5. HARDCODED English strings
   BAD:  <h2>Battery Health</h2>
   GOOD: <h2>{t('battery.health.title', 'Battery Health')}</h2>

❌ 6. HIDING sections when data is null (must always show with placeholder)
   BAD:  {data && <Panel>...</Panel>}
   GOOD: <Panel>{data ? <Content /> : <EmptyState message={t('...')} />}</Panel>

❌ 7. DOUBLE PREFIX in API hook URLs
   The request() client auto-adds /api/v1 — hooks must NOT include it
   BAD:  request('/api/v1/vehicles')     → fetches /api/v1/api/v1/vehicles
   GOOD: request('/vehicles')            → fetches /api/v1/vehicles

❌ 8. camelCase query parameters (backend uses snake_case)
   BAD:  vehicleId=${id}
   GOOD: vehicle_id=${id}

❌ 9. MONOLITH component files (max 1 exported component per file)
   BAD:  export { A, B, C, D, E } from './MegaFile'
   GOOD: One component per file, barrel re-export from index.ts

❌ 10. IMPORTING from component root (use category barrels)
   BAD:  import { X } from '@/components/SomeFile'
   GOOD: import { X } from '@/components/ui'
   GOOD: import { X } from '@/components/charts'
```

## Frontend Architecture (Refactored)

### Directory Structure
```
web/src/
  api/
    client.ts          # request<T>() — resilient fetch, auto-adds /api/v1
    hooks/             # 15 TanStack Query hook files (one per domain)
    types.ts           # API response interfaces (snake_case, matching Go JSON tags)
  features/            # 14 domain directories
    {domain}/pages/    # Page components (code-split with React.lazy)
  components/          # 9 shared component categories (see below)
  hooks/               # App-level hooks (useSettings, usePageTitle, etc.)
  types/               # Domain type definitions
  lib/                 # Utilities (cn, dateFormat, numberFormat, resilience)
```

### Shared Component Library (ALWAYS use these)
```
components/ui/           — 22 exports: Button, Badge, Card, Input, Modal, Select, Tabs, GlassPanel, Toggle, Tooltip, DataTable, Textarea, etc.
components/charts/       — 10+ exports: ChartContainer, RadialGauge, Sparkline, ChartTooltip, ChartGradient + re-exports from recharts
components/data-display/ — 10 exports: StatCard, MetricCard, MetricBar, AnimatedNumber, KVList, StatusBadge, Timeline, etc.
components/layout/       — 4 exports: PageContainer, Grid, Stack, PageHeader
components/feedback/     — 9 exports: Spinner, Skeleton, EmptyState, ErrorDisplay, QueryError, AlertBanner, etc.
components/forms/        — 3 exports: FormSection, DateRangeFilter, RuleBuilder
components/maps/         — 3+ exports: MapLayerSwitcher, MapTileLayer + re-exports from react-leaflet
components/motion/       — 4 exports: FadeIn, StaggerContainer, StaggerItem, CarAnimation
components/vehicles/     — 1 export: VehicleHeroCard
```

### API Hook Files (15 files in api/hooks/)
```
useVehicles.ts   useCharging.ts  useDriving.ts     useEnergy.ts      useAnalytics.ts
useTelemetry.ts  useAdmin.ts     useNotifications.ts useSettings.ts  useDashboard.ts
useExports.ts    useLocations.ts useTrips.ts       useUser.ts       useVehicleSystems.ts
```

### Page Template (every page MUST follow this)
```tsx
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { useSomeHook } from '@/api/hooks/useSomeHook';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function SomePage() {
  const { t } = useTranslation();
  usePageTitle(t('page.title'));
  const { data, isLoading } = useSomeHook();

  return (
    <PageContainer title={t('page.title')} loading={isLoading}>
      <FadeIn>
        <GlassPanel>
          {data ? <Content /> : <EmptyState message={t('page.noData')} />}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
```

### Null Safety Rules
- All optional fields: `value ?? 0`, `label ?? '—'`, `items ?? []`
- All hook data: `const items = data ?? []` before iterating
- Never call `.map()`, `.filter()`, `.length` on potentially undefined data

## Go Backend Architecture

### Key Conventions
- **Go 1.25**, CGO_ENABLED=0, zerolog only, `fmt.Errorf("context: %w", err)`
- **Router:** Chi v5, all endpoints under `/api/v1/`, struct-based handlers
- **Database:** pgx v5 pool, repository pattern, parameterized queries only
- **Response helpers:** `writeJSON(w, status, data)`, `writeError(w, status, msg)`
- **Resilience:** Circuit breaker (gobreaker), retry with backoff, health monitor

### Backend Route Map (source of truth: `internal/api/router.go`)
The frontend hooks MUST match these exact paths (without `/api/v1/` prefix):
```
/vehicles, /vehicles/{vehicleID}/state, /vehicles/{vehicleID}/energy, /vehicles/{vehicleID}/battery
/drives, /drives/{driveID}, /drives/{driveID}/telemetry
/charging, /charging/{sessionID}/telemetry
/motor/, /motor/latest
/tire-pressure/latest, /climate/latest, /security/latest, /media/latest
/analytics/fleet, /analytics/tco, /analytics/sleep, /analytics/regen, /analytics/battery-degradation
/analytics/speed-profile, /analytics/temperature-impact, /analytics/route-efficiency
/signals/{vehicleID}/available, /signals/{vehicleID}/live, /signals/{vehicleID}/{signalName}/history
/alerts, /alerts/rules, /alerts/test
/notifications, /notifications/logs, /notifications/stats
/system/status, /system/health, /system/audit, /system/version
```

### Model Conventions
```go
type Vehicle struct {
    ID          int64     `json:"id" db:"id"`
    DisplayName string    `json:"display_name" db:"display_name"`  // snake_case JSON
}
```
- Nullable fields → pointers (`*float64`, `*string`, `*time.Time`)
- Frontend types MUST use snake_case matching Go JSON tags

## Engineering Principles

### DRY — Don't Repeat Yourself
- Extract repeated logic into shared components, hooks, or utility functions
- If a pattern appears 3+ times → extract it
- Frontend: shared components in `components/`, shared hooks in `hooks/`
- Backend: shared utilities in `internal/platform/`, shared models in `internal/models/`

### SOLID
- **Single Responsibility:** One component/handler/repo per concern
- **Open/Closed:** Extend via composition, not modification (functional options in Go, component props in React)
- **Interface Segregation:** Small focused interfaces (Go ports), specific prop types (React)
- **Dependency Inversion:** Go handlers accept interfaces, React components accept callbacks

### Separation of Concerns
- **Frontend:** Pages orchestrate, components render, hooks fetch, lib/ transforms
- **Backend:** Handlers route, repos query, models define, adapters integrate
- Never put business logic in handlers — delegate to service/repo layer
- Never put API calls in React components — delegate to hooks

## Git Conventions

### Commit Messages (Conventional Commits)
```
type(scope): description

feat(web):     Add battery degradation chart
fix(api):      Handle nil pointer in drive handler
refactor(web): Extract shared StatCard component
perf(db):      Add index for vehicle_id on positions
docs:          Update API route documentation
test(api):     Add unit tests for charging handler
chore:         Update Go dependencies
```

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `ci`, `style`
Scope: `web`, `api`, `db`, `mqtt`, `helm`, `ci`, or specific feature name

### Branch Naming
```
feature/add-battery-cells-page
fix/drive-detail-missing-panels
refactor/extract-shared-chart-container
```

### Pull Request Standards
- Title follows conventional commit format
- Description includes: what changed, why, how to test
- All CI checks must pass before merge
- Self-review checklist: types pass, lint clean, no regressions

## Security Practices

### Frontend
- **XSS Prevention:** Never use `dangerouslySetInnerHTML`. React auto-escapes by default — keep it that way
- **Input Sanitization:** All user inputs go through shared `<Input>` / `<Textarea>` components
- **Auth Tokens:** Never store tokens in localStorage — use httpOnly cookies via Authentik/ForwardAuth
- **Sensitive Data:** Never log PII (VINs, tokens, locations) to browser console in production
- **Dependencies:** Renovate/Dependabot keeps deps updated, Trivy scans for CVEs

### Backend
- **SQL Injection:** Parameterized queries ONLY (`$1`, `$2`) — never string interpolation
- **Authentication:** All `/api/v1/*` routes behind Authentik ForwardAuth middleware
- **Secrets:** All secrets via environment variables, encrypted at rest in DB (`internal/crypto/`)
- **Input Validation:** Validate all request params before use. Use `DecodeAndValidate[T]` for request bodies
- **Rate Limiting:** httprate middleware on write endpoints (`POST`, `PUT`, `DELETE`)
- **CORS:** Strict origin whitelist in middleware
- **TLS:** All production traffic over TLS. mTLS for Fleet Telemetry

## Performance Standards

### Frontend Performance Budget
- **First Contentful Paint:** < 1.5s on 4G
- **Bundle Size:** Code-split all routes with `React.lazy()` — no route loads the full app bundle
- **Images:** Use responsive images, lazy load below-the-fold content
- **Re-renders:** Avoid unnecessary re-renders:
  - Use `useMemo` for expensive computations (sorting, filtering, chart data transforms)
  - Use `useCallback` for callbacks passed to memoized children
  - Don't create objects/arrays in JSX props (creates new references each render)
- **TanStack Query caching:** Set appropriate `staleTime` (default 0 = always refetch, live data = 5s, static = 5min)

### Backend Performance
- **Database:** Use indexes for frequently-queried columns. Use `EXPLAIN ANALYZE` for slow queries
- **Connection Pool:** pgx pool sized for expected concurrency (MaxConns=25)
- **Caching:** Redis for frequently-accessed, rarely-changing data (vehicle state, user preferences)
- **Pagination:** All list endpoints support `limit` + `offset` parameters
- **N+1 Prevention:** Batch queries instead of querying in loops
- **Timeouts:** All external API calls have `context.WithTimeout` (Tesla API: 30s, geocoding: 10s)

## Error Handling Philosophy

### Frontend
- **Network errors:** TanStack Query handles retry (3 retries by default). Display `QueryError` component
- **API errors:** Show user-friendly message via `ErrorDisplay`, log technical details to console
- **Render errors:** Error boundaries catch component crashes, show fallback UI
- **Empty data:** Always show `EmptyState` with helpful message — never a blank panel
- **Loading:** Show `Skeleton` or `Spinner` — never a frozen/unresponsive UI

### Backend
- **Return errors, never panic:** `return fmt.Errorf("fetch vehicle %d: %w", id, err)`
- **Wrap with context:** Every error includes what operation failed
- **HTTP error responses:** Use structured JSON `{"error": "message", "code": "NOT_FOUND"}`
- **Log at boundaries:** Log errors at handler level, not deep in repos
- **Graceful degradation:** If Redis is down, fall back to in-memory cache. If MQTT is down, queue locally

## Testing Standards

### Frontend Testing (Vitest + Testing Library)
- **Unit tests** for utility functions (`lib/`)
- **Component tests** for shared components — render + interaction
- **Hook tests** for custom hooks with `renderHook`
- **Page tests** for critical user flows with mocked API
- Test the behavior, not the implementation:
  ```typescript
  // ❌ BAD — testing implementation
  expect(component.state.isOpen).toBe(true);
  
  // ✅ GOOD — testing behavior
  await userEvent.click(screen.getByRole('button', { name: /open/i }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  ```

### Backend Testing
- **Unit tests** for repos, handlers, and business logic
- **Table-driven tests** for multiple input scenarios:
  ```go
  tests := []struct {
      name    string
      input   int64
      want    *models.Vehicle
      wantErr bool
  }{
      {"valid ID", 1, &models.Vehicle{ID: 1}, false},
      {"not found", 999, nil, false},
      {"zero ID", 0, nil, true},
  }
  ```
- **Race detection:** Always run with `-race` flag
- **Test coverage:** Aim for 80%+ on critical paths (handlers, repos, Tesla client)

### CI Pipeline
- **GitHub Actions:** lint → test → security → build → publish
- **Go:** `golangci-lint run` + `go test -race ./...` + `govulncheck`
- **Frontend:** `npm run lint` + `npx tsc --noEmit` + `npm test`
- **Security:** Trivy (container scan) + CodeQL (SAST) + govulncheck (Go vulns)
- **Helm:** `helm lint` + `helm template` validation

## Observability Standards

### Structured Logging (zerolog)
```go
// ✅ GOOD — structured, contextual, appropriate level
log.Info().
    Str("vehicle_id", fmt.Sprint(id)).
    Str("action", "fetch_state").
    Dur("duration", elapsed).
    Msg("vehicle state fetched")

// ❌ BAD
fmt.Printf("got vehicle %d in %v\n", id, elapsed)
log.Info().Msg(fmt.Sprintf("vehicle %d state: %v", id, state))
```

**Log Levels:**
- `Error` — operation failed, needs attention
- `Warn` — degraded but functional (cache miss, retry needed)
- `Info` — significant business events (drive started, charge complete)
- `Debug` — development diagnostics (query params, response sizes)

### Metrics (Prometheus)
- All handlers expose request count, duration, and error rate
- Custom business metrics: active vehicles, drives/day, charge sessions
- Available at `/metrics` endpoint

### Health Checks
- `/healthz` — liveness (is the process alive?)
- `/readyz` — readiness (are dependencies connected?)
- Both return 200 OK with JSON health status

## Documentation Standards

- **Code comments:** Only for non-obvious "why", not "what"
  ```go
  // ✅ GOOD — explains why
  // Circuit breaker opens after 10 failures to prevent cascading timeouts to Tesla API
  
  // ❌ BAD — restates the code
  // Create a new vehicle handler
  func NewVehicleHandler(db *database.DB) *VehicleHandler {
  ```
- **API documentation:** Router is the source of truth. Keep route comments in `router.go`
- **README:** Keep deployment/setup docs in `docs/` (VitePress)
- **Type documentation:** Complex types get JSDoc comments explaining fields
