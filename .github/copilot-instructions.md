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
3. **Compare line counts**: Count the page file PLUS any extracted components in the same feature directory. Total must be ≥ 70% of original. Properly decomposed pages (page + sub-components) are preferred over monoliths.
4. **Count sections**: grep for GlassPanel/ChartContainer — compare against original
5. **Verify hooks**: Confirm every hook URL matches a route in `internal/api/router.go`

**If you cannot run a verification step, say so explicitly — do not fabricate results.**

---

## Project Overview

TeslaSync is a **self-hosted Tesla Fleet Intelligence Platform** — Go 1.25 backend + React 18 SPA.
Collects, analyzes, and visualizes Tesla vehicle data via Fleet API + Fleet Telemetry streaming.
**Repository:** `github.com/ev-dev-labs/teslasync`

## ⚠️ ACTIVE MIGRATION: Phase-48 — SI Canonical Mega-PR (no legacy)

> **Status:** methodology committed, execution pending. Branch
> `refactor/signals-rewrite`, methodology at
> `.github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md`,
> pre-execution decisions locked at HEAD `66b5705c`. User mandate (verbatim):
> *"we need just the new one. and all must use the new one. no legacy"* —
> single mega-PR across 6 vertical slices, no temporary dual-shape adapters
> beyond the explicit Slice 4 share-link transition.
>
> Renames every legacy unit-suffixed Go field
> (`DistanceMi`, `DurationMin`, `EnergyUsedKwh`, `RegenKwh`, `AvgSpeedMph`,
> `MaxSpeedMph`, `AvgPowerKw` and 97 peers across `Trip`, `ChargingSession`,
> `EnergyDailySummary`, etc.) to SI canonical (`DistanceM`, `DurationS`,
> `EnergyUsedWh`, …`Mps`, …`W`). Frontend `useSettings.ts` legacy converter
> block + `unitConversion.ts` `@deprecated` block are DELETED in Slice 5 —
> DO NOT add new callers of the legacy helpers.

```
❌ DO NOT add new Go struct fields with `Mi`/`Min`/`Mph`/`Kwh`/`Kw`/`Psi` suffixes
   — use `M`, `S`, `Mps`, `Wh`, `W`, `Kpa` instead.
❌ DO NOT add new JSON/DB column names ending in `_mi`/`_min`/`_mph`/`_kwh`/`_kw`/`_psi`
   — use `_m`/`_s`/`_mps`/`_wh`/`_w`/`_kpa`.
❌ DO NOT call `useSettings()`'s legacy converter block
   (`convertDistance`/`convertSpeed`/`convertTemp`/`convertEfficiency`/
   `convertPressure`/`fmtDistance`/`fmtSpeed`/`fmtTemp`/`fmtPressure`)
   — being deleted in Slice 5.
❌ DO NOT call any `@deprecated`-marked function in
   `web/src/lib/unitConversion.ts` (block at L397+).
✅ DO read SI directly from the API. Phase-42 migration 000185 already
   stores everything as SI in the database.
✅ DO convert at the display boundary using `useUnits()` (web/src/hooks/useUnits.ts)
   + the SI converters/formatters in `web/src/lib/unitConversion.ts` (L1-395).
✅ DO check the methodology document's 6-slice plan + 5 risk register
   (R1 write-path corruption, R2 charge_rate_mph misname, R3 OpenAPI
   contract, R4 camelCaseKeys dual-shape, R5 useSettings non-unit responsibilities)
   before starting any change that touches a unit-suffixed field.
```

If you find yourself touching a Drive/Charging/Trip/Energy struct field
mid-stream, STOP and read
`.github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md`.
Slice ordering matters — out-of-order edits introduce write-path corruption.

## ✅ COMPLETED MIGRATION: Phase-42 — Tesla Fleet Telemetry Pipeline Rewrite

> **Status:** COMPLETE. Phase-42 final-gate v2 PASSED at commit `b1dd7ea4`
> (see `.github/prompts/db-refactor/logs/phase-42-9999v2-final-gate.log`).
> The v1 gate (`9999-final-gate.log`) is BLOCKED on log-discipline gaps;
> v2 supersedes it via artifact-coverage verification.
> ADR-004 (`.github/ARCHITECTURE.md`) and
> `.github/instructions/tesla-pipeline.instructions.md` are now the canonical
> sources for all Tesla pipeline work. Pre-tag the repo as `phase-42-complete`
> before starting subsequent phases — phase-42 contains one-way DROP CASCADE
> + tombstone operations.

```
❌ DO NOT add new code under `internal/telemetry/*`
   — the directory was deleted by phase-42 prompt 0080.
❌ DO NOT add new hand-written enum parsers under `internal/enums/parse_*`
   — replaced by generated code from the vendored Tesla proto.
❌ DO NOT add new tables that mirror Fleet Telemetry fields directly
   — phase-42 routes everything through `internal/tesla/normalize.Pipeline`.
❌ DO NOT bypass `signal.Store` (L1) by writing to Redis or signal_log directly
   — the layered live-state contract still applies (see "Signal Data" below).
❌ DO NOT add per-vehicle or value-conditional routing to `routing.yaml`
   — routing is field-static and vehicle-agnostic by ADR-004 #8.
✅ DO put new Tesla-vendor-specific code under `internal/tesla/*`
   (codec, units, unit_history, bootstrap, config, router, normalize).
✅ DO put new vendor-agnostic signal/state primitives under `internal/signal/*`.
✅ DO prefix new Tesla-vendor-specific tables with `tesla_*`
   (e.g., `tesla_vehicle_unit_history`). Existing unprefixed tables are
   grandfathered until a future rename migration.
✅ DO route ALL new ingest paths through `(*normalize.Pipeline).Process`
   — it is THE one entry; reflective coverage test enforces this.
✅ DO treat `router.Writer` failures as logged + counted (via
   `tesla_router_writer_failures_total`), NEVER propagated to MQTT
   redelivery. Only codec failures (malformed bytes) trigger redelivery.
```

If you find yourself wanting to bend any of these rules, STOP and consult
the user — phase-42's locked decisions in ADR-004 may need to be revisited
rather than worked around.

## Architecture

> Telemetry-pipeline rules: see .github/instructions/tesla-pipeline.instructions.md

```
React SPA (Vite 5) ──▶ Nginx reverse proxy ──▶ Go API Server (:8080)
                                                  │   │   │   │
                                          TimescaleDB Redis MQTT Tesla API
                                              │
                                          signal_log (hypertable)
                                          drives / charging_sessions
                                          cagg_fleet_stats / cagg_battery_daily
```

**Services:** teslasync-api (:8080), teslasync-web (:80), notification-worker, export-worker, automation-worker, command-proxy, timescaledb, redis, mosquitto

**Data flow:** Tesla Fleet Telemetry → MQTT → Go API → signal.Store L1 + Redis HSET/PubSub L2 + signal_log history → FSM/SSE/API → Frontend

## Language Servers (LSP) — Use for Code Intelligence

When available, prefer LSP tools over grep/text matching for:
- Finding references, callers, implementations
- Checking type compatibility and interface conformance
- Navigating imports and symbol definitions

### Go (gopls)
```bash
# Already installed at C:\Users\AtulM\go\bin\gopls.exe
# Start: gopls serve -listen=:37374
# Use for: finding all callers of a function, checking interface implementations,
# tracing signal flow (ProcessSignals → trackStateTransition → commitStateTransition)
```

### TypeScript (typescript-language-server)
```bash
# Installed globally: typescript-language-server --stdio
# Use for: resolving @/ alias paths, checking API response types,
# validating camelCaseKeys transform compatibility, finding unused exports
```

### When to Use LSP vs Grep
- **LSP**: "Who calls FlushDriveTelemetry?", "What implements Flusher interface?", "What type does this function return?"
- **Grep**: "Find all files with inline styles", "Count occurrences of empty={}", "Search for string literals"

### API Response Type Validation
Many bugs in this project stem from frontend TypeScript interfaces not matching Go API response shapes, especially after `camelCaseKeys()` transforms snake_case to camelCase. When modifying an API endpoint or frontend page:
1. Check the Go struct's JSON tags (`json:"field_name"`)
2. After `camelCaseKeys`, both `field_name` AND `fieldName` exist in the response
3. Frontend can access either — prefer snake_case (original) for consistency
4. Run `npx tsc --noEmit` to catch compile-time type errors

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

❌ 11. NEON TEXT for body content
   BAD:  <td className="text-neon-cyan">{value}</td>
   BAD:  <p className="text-neon-green">Description text</p>
   GOOD: <td className="text-cyan-300">{value}</td>
   GOOD: <p className="text-emerald-300">Description text</p>
   EXCEPTION: short labels (≤4 chars / 1 word) inside a chip that ALSO has
   bg-neon-{same}/10+ and border-neon-{same}/20+ on the same element.
   For pure body text with no semantic color, use text-white/90.
   Toned-down map: cyan→cyan-300, green→emerald-300, amber→amber-300,
   red→rose-300, purple→purple-300, blue→indigo-300, pink→pink-300.

❌ 12. AD-HOC TYPOGRAPHY classes
   BAD:  <h2 className="text-lg font-semibold tracking-tight text-white">…</h2>
   BAD:  <span className="text-[10px] text-white/40">label</span>
   GOOD: <SectionTitle>…</SectionTitle>
   GOOD: <Caption>label</Caption>
   GOOD: <Text variant="bodySm">…</Text>

   For new pages: import from @/components/ui — Heading, Text, PageTitle,
   SectionTitle, PanelTitle, Subhead, Caption, HelperText, ErrorText,
   Label, MetricValue, MetricLabel, Code.

   For one-offs that genuinely don't fit a role: use typography tokens from
   @/lib/tokens — typography.size, typography.weight, typography.color.

   Never use raw text-white/N or text-gray-N — use typography.color or the
   --text-primary / --text-secondary / --text-muted CSS vars so light theme
   keeps working.
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

### Configuration Sync (CRITICAL)
When adding, renaming, or removing an environment variable in `internal/config/config.go`:
```
❌ DO NOT add a config var to only one deployment target
✅ ALWAYS update ALL THREE locations in the same commit:
   1. internal/config/config.go          — Go env var binding (envStr/envBool/envDuration)
   2. docker-compose.yml                 — local dev environment variable
   3. helm/teslasync/templates/           — configmap.yaml (non-secret) or secret.yaml (credentials)
      helm/teslasync/values.yaml          — default value + documentation comment
```
- Non-sensitive values → `configmap.yaml` + `values.yaml`
- Secrets (passwords, API keys, tokens) → `secret.yaml` + `values.yaml` (conditional)
- If the var has a sensible default in config.go, use the same default in docker-compose and values.yaml
- Verify with: `helm template test helm/teslasync | grep YOUR_NEW_VAR`

### Signal Data — Layered Live-State Contract
TeslaSync uses layered live signal state. `signal.Store` is the local in-process L1
for telemetry/FSM/session hot paths. Redis HSET `vehicle:{vehicleID}:signals` is the
shared L2 for cross-pod current-state reads and restart recovery. `signal_log` is the
durable TimescaleDB history for charts, point-in-time reconstruction, analytics, and
completion logic.
```
❌ DO NOT read current state from snapshot tables (positions, security_events, climate_snapshots)
❌ DO NOT add new endpoints that query snapshot tables for "latest" current values
❌ DO NOT remove or bypass SignalStore hot-path reads just because Redis exists
❌ DO NOT make Redis a synchronous blocker for MQTT/telemetry ingestion
✅ DO keep SignalStore as local L1 for telemetry, FSM/reconciliation, sessions, and merge context
✅ DO use Redis for cross-pod live reads, restart recovery, and SSE fanout
✅ DO use signal_log for historical data, charts, timelines, replay, and point-in-time snapshots
✅ DO preserve Redis keys/channels: vehicle:{vehicleID}:signals, vehicle_signals, signal_log:backlog
✅ DO treat cross-pod live values older than 2 minutes as stale and legacy scalar Redis values as unknown freshness
✅ DO use LIVE_SIGNAL_STORE_MODE=local as the rollback switch for Redis-backed distributed live reads
❌ DO NOT claim FSM/reconciliation is active-active across pods without vehicle-owner routing, leases, or pod affinity
❌ DO NOT treat Redis Pub/Sub SSE as durable replay; clients recover missed state through polling/live reads
```

### Telemetry Pipeline End-to-End (Phase-42)

> Full diagram + decision record: `.github/ARCHITECTURE.md` ADR-004.
> Detailed file-level rules: `.github/instructions/tesla-pipeline.instructions.md`.

**The flow (memorize this — every backend change touches it):**

```
Vehicle ─mTLS▶ Fleet Telemetry ─MQTT▶ PipelineSubscriber ─▶ Codec ─▶ normalize.Pipeline ─▶ Router ─▶ Writers ─▶ {dest tables, signal_log}
                                       (telemetry/{VIN}/v/  (per-field    (ToSI per vehicle units)   (routing.yaml)              │
                                          {Field};            JSON body                                                            │
                                          filter              → []Atomic)                                                          │
                                          {base}/+/v/+)                                                                            │
                                                                                                                                   ├─▶ signal.Store (L1, in-process)
                                                                                                                                   ├─▶ Redis HSET vehicle:{id}:signals (L2, cross-pod)
                                                                                                                                   └─▶ Redis Pub/Sub ─▶ SSE hub ─▶ SPA EventSource
                                                                                                                                                                FSM (drive/charge/park, 15s reconciliation)
                                                                                                                                                                REST handlers (history reads from signal_log)
```

**Five rules every agent must internalize:**

1. **`normalize.Pipeline.ProcessAtomics` is THE one ingest entry.** Adding any other path is forbidden — a reflective coverage test enforces this and `mqtt.Pipeline` exposes only this method. Vendor-specific decode goes in `internal/tesla/*`; vendor-agnostic signal primitives go in `internal/signal/*`.
2. **The pipeline writes SI on disk.** Meters, m/s, °C, Pa, Wh. Never miles, mph, °F, psi, kWh in any DB column, API field, Go struct field, or TS interface. User display preference is applied **only** at the React render boundary by `useUnits()` / `useFormatting()`.
3. **`routing.yaml` is field-static and vehicle-agnostic.** Per-vehicle or value-conditional routing is forbidden by ADR-004 #8. To route a new field: re-vendor proto → `go generate ./internal/tesla/protomodel/...` → add a routing.yaml entry → done.
4. **Failure semantics are split.** Codec failures (malformed JSON, kind mismatch, unknown enum) wrap `codec.ErrPayloadDrop` and route to the DLQ via `handlePipelineError` (the broker is acked so it never redelivers a poison pill). Writer failures (DB down, schema mismatch) MUST be logged + counted via `tesla_router_writer_failures_total` and NEVER propagate to MQTT redelivery — otherwise a stuck table blocks the whole stream.
5. **Live state is layered, not replaced.** L1 `signal.Store` for hot paths (FSM, sessions). L2 Redis for cross-pod + restart recovery. Durable `signal_log` for charts, replay, point-in-time. Don't bypass L1 by reading Redis directly in FSM/telemetry/session code paths.

**The proto identifier paradox:** Tesla's vendored proto has misnamed fields (e.g. field 256 `ChargeRateMilePerHour` whose wire content is *meters of range added per hour*). The proto identifier is upstream-owned and immutable — our generator MUST emit it verbatim. The semantic truth lives in three places: the SignalMeta `UnitKind` (e.g. `UnitKindDistance` not `UnitKindSpeed`), the JSON wire field name (`range_added_meters_per_hour`), and an audit-pin test (`TestRangeAddedMetersPerHour_R2_AuditPin`). Renaming the proto identifier silently breaks runtime telemetry plumbing — see the Phase-48 R2 finding.

**Boot-time sanity** (look for these lines in `docker logs teslasync-api`):
```
"phase-42 PipelineSubscriber started" topic=telemetry/+/v/+ codec_failure_disposition=dlq_ack
"phase-42a: fleet-telemetry PipelineSubscriber active" writer_count=12
"signal store hydrated from signal_log via stateReader"
"FSM vehicle state engine active — declarative transition table with 20 transitions"
"SSE event hub: Redis Pub/Sub subscription started"
```
If any of these are missing, the pipeline is degraded — investigate before assuming the system is healthy.

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
- **Caching:** Redis for shared live signal cache, SSE fanout, restart recovery, and ordinary cached data; keep telemetry/FSM hot paths on local SignalStore.
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

---

## Architecture Decisions

See [ARCHITECTURE.md](.github/ARCHITECTURE.md) for all PA/PE-approved architecture decision records (ADRs).
Agents: you MUST read ARCHITECTURE.md before modifying any backend handler or data query.
