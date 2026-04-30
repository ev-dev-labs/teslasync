---
applyTo: "web/**"
---

# React Frontend Instructions

## Architecture Overview

```
web/src/
  api/
    client.ts          # request<T>() wrapper — auto-adds /api/v1 prefix
    hooks/             # 15 domain hook files (TanStack Query v5)
    types.ts           # API response interfaces (snake_case, match Go JSON tags)
  features/            # 14 domain directories, each with pages/ subdirectory
    driving/pages/     # DrivingDynamicsPage.tsx, DriveDetailPage.tsx, etc.
    charging/pages/    # ChargingListPage.tsx, ChargingDetailPage.tsx, etc.
    ...
  components/          # 9 shared component categories (see catalog below)
  hooks/               # App-level hooks (useSettings, usePageTitle, useTheme)
  types/               # Domain type definitions
  lib/                 # Utilities: cn(), dateFormat, numberFormat, resilience
```

## Data Loading — TanStack Query ONLY

All data fetching uses hooks from `@/api/hooks/`. Never use `fetch()`, `useEffect` for data, or old `api.ts` functions.

```typescript
// ✅ CORRECT
import { useVehicles } from '@/api/hooks/useVehicles';
const { data: vehicles, isLoading } = useVehicles();
const items = data ?? [];  // safe before iterating

// ❌ WRONG — old API pattern
import { getVehicles } from '../api';
useEffect(() => { getVehicles().then(setVehicles) }, []);
```

### API Client Behavior
- `web/src/api/client.ts` exports `request<T>(path, options?)` 
- It auto-prepends `/api/v1` to all paths
- Hook URLs must NOT include `/api/v1/` — this causes double-prefix 404s
- Query parameters use **snake_case** (matching Go): `vehicle_id`, `drive_id`, not `vehicleId`

### Hook Files (15 files in api/hooks/)
```
useVehicles.ts      useCharging.ts     useDriving.ts       useEnergy.ts
useAnalytics.ts     useTelemetry.ts    useAdmin.ts         useNotifications.ts
useSettings.ts      useDashboard.ts    useExports.ts       useLocations.ts
useTrips.ts         useUser.ts         useVehicleSystems.ts
```

Before creating a new hook, check if one already exists in the relevant file.

## Shared Component Library

**RULE: Pages/features MUST import from these barrels. Never import libraries directly.**

### components/ui/ (22 exports)
Button, Badge, Card (+ CardHeader, CardFooter), Input, Modal, Select, Tabs, GlassPanel,
StatusPill, Toggle, Tooltip, ConfirmDialog, IconBox, TabNav, Accordion, Pagination,
DataTable (+ useSortToggle, Column type), Drawer, Breadcrumb, CommandPalette, Textarea, Logo

### components/charts/ (10+ exports + recharts re-exports)
ChartContainer, RadialGauge, MiniChart, AreaChartWrapper, Sparkline, ChartTooltip,
ChartGradient, chartUtils (CHART_COLORS, NEON_COLORS, chartGrid, axisTick, safe, fmt)
**Re-exports:** AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Brush, ComposedChart, ScatterChart,
Scatter, ReferenceLine, Legend

### components/data-display/ (10 exports)
StatCard, MetricCard, MetricBar, InlineMetric, AnimatedNumber, KVList, StatusBadge,
ProgressRing, Timeline, TimelineItem

### components/layout/ (4 exports)
PageContainer, Grid, Stack, PageHeader

### components/feedback/ (9 exports)
Spinner, Skeleton, ChartSkeleton, StatSkeleton, EmptyState, ErrorDisplay, PageLoader,
QueryError, AlertBanner

### components/forms/ (3 exports)
FormSection, DateRangeFilter, RuleBuilder

### components/maps/ (3+ exports + react-leaflet re-exports)
MapLayerSwitcher, MapTileLayer (+ MapStyle type), MapInvalidator
**Re-exports:** MapContainer, Polyline, Marker, Popup, CircleMarker, useMap

### components/motion/ (4 exports)
FadeIn, StaggerContainer, StaggerItem, CarAnimation

### components/vehicles/ (1 export)
VehicleHeroCard

## Import Rules

```typescript
// ✅ CORRECT — import from category barrel
import { Button, Badge, GlassPanel } from '@/components/ui';
import { LineChart, Area, XAxis, ChartContainer } from '@/components/charts';
import { MapContainer, Polyline } from '@/components/maps';
import { StatCard, MetricCard } from '@/components/data-display';
import { PageContainer, Grid } from '@/components/layout';
import { FadeIn, StaggerContainer } from '@/components/motion';
import { EmptyState, Skeleton } from '@/components/feedback';

// ❌ WRONG — direct library import in pages/features
import { LineChart } from 'recharts';
import { MapContainer } from 'react-leaflet';
import { motion } from 'framer-motion';

// ❌ WRONG — importing from component root
import { Button } from '@/components/Button';
import { X } from '@/components/SomeFile';
```

## Styling Rules

- **Tailwind CSS only** — no inline `style={{}}` with static values
- Use `cn()` from `@/lib/cn` for conditional classes (replaces old `clsx`)
- **Exceptions where `style={{}}` is acceptable:**
  - Dynamic computed values: `style={{ width: \`${percent}%\` }}`
  - Conditional ternary values: `style={{ color: isActive ? '#22c55e' : '#ef4444' }}`
  - Array-indexed colors: `style={{ fill: CHART_COLORS[index] }}`
  - Recharts library API: `wrapperStyle`, `contentStyle`, `labelStyle`

```typescript
// ❌ WRONG — static CSS variable in inline style
style={{ color: 'var(--text-primary)' }}
style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}

// ✅ CORRECT — Tailwind equivalents
className="text-white/90"
className="bg-white/[0.03] border border-white/[0.06]"
```

## Null Safety & Empty States

Every section MUST always render its panel shell. Never hide entire sections when data is null.

```typescript
// ❌ WRONG — hides entire section
{data && <GlassPanel><Content data={data} /></GlassPanel>}

// ✅ CORRECT — panel always shows, content has explicit empty state
<GlassPanel className="p-6">
  <h2 className="text-lg font-semibold text-white/90">{t('section.title')}</h2>
  {data ? (
    <Content data={data} />
  ) : (
    <EmptyState icon={Info} message={t('section.noData', 'No data available yet')} />
  )}
</GlassPanel>
```

For optional numeric fields, use explicit "no data" display rather than silent zero:
```typescript
// ❌ RISKY — 0 could mean "unknown" not "actually zero"
<StatCard value={battery ?? 0} />

// ✅ BETTER — explicit unknown handling
<StatCard value={battery != null ? fmtNumber(battery) : '—'} />
```

For safe iteration:
```typescript
const items = data ?? [];
// Now safe to call items.map(), items.length, items.filter()
```

## Page Structure Template

Every page MUST use PageContainer and follow this structure:

```tsx
export default function ExamplePage() {
  const { t } = useTranslation();
  usePageTitle(t('example.title', 'Example'));

  const { data, isLoading, error } = useSomeHook();

  return (
    <PageContainer
      title={t('example.title', 'Example')}
      subtitle={t('example.subtitle', 'Description')}
      loading={isLoading}
      error={error ? String(error) : null}
    >
      {/* Section 1 — always visible */}
      <FadeIn>
        <GlassPanel className="p-6">
          {data ? <RichContent /> : <EmptyState message={t('example.noData')} />}
        </GlassPanel>
      </FadeIn>

      {/* Section 2 — chart with placeholder */}
      <FadeIn delay={0.05}>
        <ChartContainer title={t('example.chart')} height={300}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>...</AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('example.noChartData')} />
          )}
        </ChartContainer>
      </FadeIn>
    </PageContainer>
  );
}
```

## i18n

All user-visible strings use `useTranslation()`:
```typescript
const { t } = useTranslation();
// Always provide fallback: t('key', 'Fallback English text')
<h2>{t('page.section.title', 'Section Title')}</h2>
```

## TypeScript

- Strict mode — all props and state typed
- API types use snake_case matching Go JSON tags
- Nullable Go pointers (`*float64`) → `number | null` in TS
- Use `Record<string, unknown>` for dynamic objects, never `any`
- All pages must pass `npx tsc --noEmit`

## Unit-Aware Display (CRITICAL — see unit-conversion.instructions.md)

Every page displaying measurements (distance, speed, temperature, pressure)
MUST convert between the car's source unit and the user's display preference.

```typescript
// ✅ CORRECT — convert + correct label
import { toDisplayDistance, distanceLabel } from '@/lib/unitConversion';
const userUnit = settings?.unit_of_length === 'km' ? 2 : 1;
<StatCard value={toDisplayDistance(d.distance_mi ?? 0, d.distance_unit ?? 0, userUnit, 1)}
          suffix={distanceLabel(userUnit)} />

// ❌ WRONG — raw value with assumed unit
<StatCard value={d.distance_mi} suffix="mi" />
```

See `unit-conversion.instructions.md` for the full pattern, all affected pages,
and conversion factors.

## API Response Type Alignment

Frontend types MUST match Go JSON tags exactly. The `db:` tag and `json:` tag
on Go structs use the same snake_case name.

```typescript
// ✅ GOOD — matches Go json tags exactly
interface Drive {
  id: number;
  vehicle_id: number;
  start_ts: string;           // not start_date
  distance_mi: number;        // not distance (includes unit suffix)
  max_speed_mph: number | null; // nullable → | null
  distance_unit: number;      // unit enum (0=unknown, 1=mi, 2=km)
  temp_unit: number;          // unit enum
}

// ❌ BAD — doesn't match Go tags
interface Drive {
  startDate: string;          // Go sends start_ts
  distance: number;           // Go sends distance_mi
  speedMax: number;           // Go sends max_speed_mph
}
```

When Go model fields change, frontend types MUST be updated in the same PR.

## Design System

- **Dark-first glassmorphism** — frosted glass panels with `backdrop-blur`
- **5 color themes** via CSS custom properties (Neon Cyan, Tesla Red, Matrix Green, Royal Purple, Solar Amber)
- Neon accent colors that glow on hover/focus
- All animations via Framer Motion through `@/components/motion/`
- Icons from `lucide-react` (import individually)

## Performance Best Practices

### Memoization Rules
```typescript
// ✅ USE useMemo for expensive computations
const chartData = useMemo(() => 
  drives.map(d => ({ x: d.startDate, y: convertDistance(d.distance) })),
  [drives, convertDistance]
);

// ✅ USE useMemo for derived/filtered data
const filteredDrives = useMemo(() => 
  (drives ?? []).filter(d => d.startDate >= startDate && d.startDate <= endDate),
  [drives, startDate, endDate]
);

// ❌ DON'T useMemo for trivial operations
const name = useMemo(() => `${first} ${last}`, [first, last]); // unnecessary

// ❌ DON'T create new objects in JSX props (causes child re-renders)
<Grid cols={{ default: 1, md: 2 }} />  // ← new object every render
// ✅ BETTER — define outside component or useMemo
const gridCols = { default: 1, md: 2 } as const;
<Grid cols={gridCols} />
```

### Code Splitting
- ALL route-level pages use `React.lazy()`:
  ```typescript
  const DrivingPage = lazy(() => import('./features/driving/pages/DrivingListPage'));
  ```
- Heavy components (maps, complex charts) can also be lazy-loaded
- Use `<Suspense fallback={<PageLoader />}>` around lazy components

### TanStack Query Caching
```typescript
// Live data — refresh every 5 seconds
{ refetchInterval: 5_000, staleTime: 3_000 }

// Dashboard data — refresh on window focus, stale after 30s
{ staleTime: 30_000 }

// Static reference data — cache for 5 minutes
{ staleTime: 5 * 60_000 }

// Write-once data — cache indefinitely
{ staleTime: Infinity }

// Disable automatic fetch — only when condition met
{ enabled: !!vehicleId }
```

### Bundle Size
- Import lucide-react icons individually: `import { Zap } from 'lucide-react'`
- Never `import * as Icons from 'lucide-react'`
- Recharts and Leaflet are re-exported through component barrels — this enables tree-shaking

## Accessibility (a11y)

Minimum requirements for all components:

```typescript
// ✅ Interactive elements need accessible labels
<Button aria-label={t('action.save')}>
  <Save className="h-4 w-4" />
</Button>

// ✅ Form inputs need labels
<label htmlFor="vehicle-select">{t('select.vehicle')}</label>
<Select id="vehicle-select" options={vehicleOptions} />

// ✅ Images need alt text
<img src={mapTile} alt={t('map.satellite', 'Satellite view')} />

// ✅ Color is not the only indicator — use icons/text alongside
<Badge variant="danger"><AlertTriangle className="h-3 w-3 mr-1" /> Critical</Badge>

// ✅ Keyboard navigation — interactive elements are focusable
// All shared components (Button, Select, Tabs, Modal) handle this already
```

- Screen reader support: Use semantic HTML via shared components
- Focus management: Modal/Drawer trap focus. Dialog auto-focuses first input
- Motion: Respect `prefers-reduced-motion` (Framer Motion handles this)

## Error Handling Patterns

### Query Error Handling
```typescript
const { data, isLoading, error } = useSomeHook();

// PageContainer handles loading/error states automatically
<PageContainer
  loading={isLoading}
  error={error ? String(error) : null}
>
  {/* Content only renders when not loading and no error */}
</PageContainer>
```

### Per-Section Error Handling
For pages with multiple independent data sources:
```typescript
const { data: drives, error: drivesError } = useDrives(vehicleIdStr);
const { data: stats, error: statsError } = useDrivingStats(vehicleIdStr);

// Each section handles its own error/empty state
<GlassPanel>
  {drivesError ? (
    <QueryError message={t('drives.fetchError')} />
  ) : drives?.length ? (
    <DrivesList data={drives} />
  ) : (
    <EmptyState message={t('drives.empty')} />
  )}
</GlassPanel>
```

### Error Boundaries
Critical sections should be wrapped:
```typescript
<ErrorBoundary fallback={<ErrorDisplay message={t('section.crashed')} />}>
  <ComplexChartSection data={data} />
</ErrorBoundary>
```

## State Management Decision Tree

```
Is it server data? → TanStack Query hook (useQuery/useMutation)
Is it URL state (page, filter, sort)? → React Router (useSearchParams)
Is it form state? → useState (local to form component)
Is it UI state (modal open, tab active)? → useState (local to component)
Is it shared across many components? → Context (useSettings, useTheme)
Is it derived from other state? → useMemo (computed, no separate state)
```

**Never** use Redux, Zustand, or other state libraries — TanStack Query + React state + Context covers everything.

## Custom Hook Patterns

### When to Create a Custom Hook
- Logic is used by 2+ components
- Complex state logic with multiple useState/useEffect
- Encapsulates a side effect (resize observer, intersection observer, polling)

### Hook Naming & Structure
```typescript
// hooks/useSettings.ts — app-wide settings from context
export function useSettings() {
  const ctx = useContext(SettingsContext);
  // ... derive convertDistance, convertSpeed, etc.
  return { convertDistance, convertSpeed, distanceUnit, speedUnit, tempUnit };
}

// hooks/useDebounce.ts — generic utility hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
```

### Hook Rules
- Prefix with `use`
- Never call hooks conditionally
- Keep hooks focused — one concern per hook
- Return stable references (useMemo/useCallback for objects/functions)

## Responsive Design

All pages must work on mobile (375px) through desktop (1920px+):

```typescript
// Use Grid component with responsive breakpoints
<Grid cols={{ default: 1, sm: 2, md: 3, lg: 4 }} gap={4}>

// Use Tailwind responsive prefixes
className="text-sm md:text-base lg:text-lg"
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
className="p-4 md:p-6"

// Hide/show based on screen size
className="hidden md:block"  // desktop only
className="block md:hidden"  // mobile only
```

- Touch targets: minimum 44×44px for interactive elements
- Text: minimum 14px (sm) on mobile
- Charts: reduce height on mobile, consider horizontal scroll for data tables

## Form Handling

```typescript
// Simple forms: useState
const [name, setName] = useState('');
const mutation = useCreateItem();

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  mutation.mutate({ name });
};

// Form submission feedback
<Button 
  type="submit" 
  loading={mutation.isPending}
  disabled={mutation.isPending || !name.trim()}
>
  {t('form.save')}
</Button>

// Optimistic updates with TanStack Query
const mutation = useMutation({
  mutationFn: updateItem,
  onMutate: async (newData) => {
    await queryClient.cancelQueries({ queryKey: ['items'] });
    const previous = queryClient.getQueryData(['items']);
    queryClient.setQueryData(['items'], (old) => /* optimistic update */);
    return { previous };
  },
  onError: (err, vars, context) => {
    queryClient.setQueryData(['items'], context?.previous);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['items'] });
  },
});
```

## File Naming Conventions

```
components/ui/Button.tsx          # PascalCase for components
components/ui/index.ts            # barrel export
api/hooks/useVehicles.ts          # camelCase with "use" prefix for hooks
lib/dateFormat.ts                 # camelCase for utilities
types/driving.ts                  # camelCase for type files
features/driving/pages/           # kebab-case for feature directories
  DrivingListPage.tsx             # PascalCase + "Page" suffix for pages
```

## Component & Page Size Limits

**CRITICAL: No monolith files.** Every page and component must follow these limits:

```
❌ NEVER create a page file over 300 lines
❌ NEVER create a component file over 200 lines
❌ NEVER put multiple visual sections in one file
✅ DO decompose pages into sub-components from the start
✅ DO create a components/ subdirectory next to the page
✅ DO keep the main page file as a thin orchestrator (150-200 lines max)
```

### Page Decomposition Pattern

When creating a new page with multiple sections (stats + charts + tables + filters):

```
features/{domain}/
  pages/
    MyNewPage.tsx              # Thin shell: ~150-200 lines (layout + imports only)
  components/{page-name}/
    SummaryStats.tsx           # One section per file
    TrendChart.tsx             # One chart per file
    DataTable.tsx              # One table per file
    FilterBar.tsx              # Controls/filters
    helpers.ts                 # Page-specific helpers
    constants.ts               # Page-specific constants
    index.ts                   # Barrel export
```

### Main Page Template (thin orchestrator)

```tsx
export default function MyNewPage() {
  const { t } = useTranslation();
  usePageTitle(t('page.title'));
  const { data, isLoading } = useSomeHook();

  return (
    <PageContainer title={t('page.title')} loading={isLoading}>
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <SummaryStats data={data} />
        <FilterBar onFilter={setFilter} />
      </Grid>
      <TrendChart data={data?.trends ?? []} />
      <DataTable items={data?.items ?? []} />
    </PageContainer>
  );
}
```

### When to Extract

- **2+ chart sections** → each chart in its own file
- **Stat card group** (3+ cards) → own file
- **Table with custom columns** → own file
- **Filter/controls bar** → own file
- **Any helper function > 20 lines** → `helpers.ts`
- **Constants/config arrays** → `constants.ts`
