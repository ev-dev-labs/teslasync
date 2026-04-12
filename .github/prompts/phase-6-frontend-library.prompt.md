---
description: "Phase 6 — Frontend shared component library: all UI primitives, layouts, charts, maps, forms"
---

# Phase 6: Frontend Shared Component Library

**Branch:** `refactor/full-rewrite`
**Can run in parallel with backend phases 3–5.**

**Read ENGINEERING_GUIDELINES.md:** §4.1–4.7 (entire frontend component section)

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

Build EVERY component from the §4.2 catalog. Each component must: use `forwardRef`, accept `className` via `cn()`, support dark mode, include a11y attributes.

### 1. `web/src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
### 2. `web/src/lib/fsm.ts` — FSM state display configs (vehicleStates, chargingSubStates, tripStates, etc.) per §8.13

### 3. `web/src/components/ui/` — 16 primitives
Button, IconButton, Badge, Card (with Card.Header, Card.Footer compound), Input, Select, Checkbox, Toggle, Modal, ConfirmDialog, Tabs, Tooltip, Avatar, Divider, StateBadge
- `index.ts` barrel export

### 4. `web/src/components/layout/` — 8 components
AppShell, Sidebar, Header, PageContainer (with loading/error/empty states), SplitPane, Stack, Grid, Section
- `index.ts` barrel export

### 5. `web/src/components/feedback/` — 8 components
Spinner, Skeleton, ErrorDisplay, ErrorBoundary, EmptyState, Toast + useToast, ProgressBar, Banner
- `index.ts` barrel export

### 6. `web/src/components/data-display/` — 6 components
DataTable (generic, sortable, with Column type), StatCard (with trend + loading skeleton), KVList, Timeline, DescriptionList, Metric
- `index.ts` barrel export

### 7. `web/src/components/charts/` — 5 wrappers
ChartContainer (title + loading/empty), TimeSeriesChart, BarChart, GaugeChart, PieChart
- Wrap Recharts — feature code NEVER imports recharts directly
- `index.ts` barrel export

### 8. `web/src/components/maps/` — 5 wrappers
MapContainer, MapMarker, MapRoute, MapCluster, MapBounds
- Wrap Leaflet — feature code NEVER imports react-leaflet directly
- `index.ts` barrel export

### 9. `web/src/components/forms/` — 5 components
FormField, FormSection, SearchInput (with debounce), DateRangePicker, NumberInput
- `index.ts` barrel export

### 10. `web/src/components/motion/` — 5 wrappers
FadeIn, SlideIn, AnimatedList, AnimatedNumber, Collapse
- Wrap Framer Motion — feature code NEVER imports framer-motion directly
- `index.ts` barrel export

### 11. `web/src/hooks/` — 10 shared hooks
useDebounce, useLocalStorage, useMediaQuery (+ useIsMobile/useIsTablet/useIsDesktop), useOnClickOutside, useInterval, useChartTheme, useCopyToClipboard, useKeyboardShortcut, usePagination, useConfirm
- `index.ts` barrel export

### 12. `web/src/api/client.ts` — single API client per §4.8

### 13. Tests for every component
- Smoke: renders with default props
- Variants: each variant renders correctly
- Interaction: onClick, onChange, keyboard
- Accessibility: roles, aria attributes

## Acceptance Criteria

```bash
cd web && npx tsc --noEmit && npm run lint && npm run test -- --coverage
```

- [ ] Zero TypeScript errors. Paste output.
- [ ] Zero lint errors. Paste output.
- [ ] All tests pass with ≥70% coverage. Paste output.
- [ ] Every component uses forwardRef + cn() + className prop
- [ ] Every category has barrel `index.ts`
- [ ] ZERO business logic in shared components
- [ ] ZERO feature-specific imports in shared components
- [ ] Chart/Map/Motion wrappers fully encapsulate the underlying library
