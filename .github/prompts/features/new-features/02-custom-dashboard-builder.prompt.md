---
description: "Custom Dashboard Builder: drag-and-drop widget layout with save/load"
---

# Custom Dashboard Builder

## Problem

The dashboard (DashboardPage.tsx, 446 lines) has a hardcoded layout with 7 widget
sections. Every user sees the same layout regardless of what they care about. A fleet
manager wants TCO and efficiency front-and-center. A daily commuter wants battery and
next charge time. A data nerd wants live telemetry graphs.

Users should be able to pick which widgets they see, arrange them, resize them, and
save their layout — like Grafana but built into the app.

## Current State

```
web/src/features/dashboard/pages/DashboardPage.tsx  — 446 lines, hardcoded layout
web/package.json                                     — NO drag-and-drop library
web/src/features/system/pages/RoadmapPage.tsx:152    — "Custom dashboard builder" listed as planned
```

### Current Dashboard Widgets (hardcoded)
1. VehicleHero — primary vehicle card
2. FleetStatsBar — summary stat cards
3. RecentActivity — drive/charge history
4. OtherVehiclesStrip — secondary vehicles
5. QuickNav — navigation shortcuts
6. LiveTelemetry — motor, climate, security, tire, media, location
7. LoadingSkeleton — loading state

## Task

### Step 1: Install DnD Library

```bash
cd web && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Why @dnd-kit:** Modern React-first, hook-based, accessible, lightweight (~12kB),
actively maintained. Better than react-beautiful-dnd (deprecated) or react-dnd (complex).

### Step 2: Define Widget Registry

Create `web/src/features/dashboard/widgets/registry.ts`:

```typescript
import { LucideIcon, Battery, Zap, Car, MapPin, Shield, Thermometer,
  Activity, BarChart3, Clock, Gauge, Wifi, TrendingUp } from 'lucide-react';

export interface WidgetDef {
  id: string;
  name: string;                    // "Battery Status"
  description: string;             // "Current battery level, range, charge state"
  icon: LucideIcon;
  category: WidgetCategory;
  defaultSize: WidgetSize;         // default grid dimensions
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: React.LazyExoticComponent<React.ComponentType<WidgetProps>>;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;                // actual rendered size
}

export interface WidgetSize {
  cols: number;  // 1-4 (in a 4-column grid)
  rows: number;  // 1-3
}

export type WidgetCategory = 'vehicle' | 'battery' | 'driving' | 'charging' |
  'climate' | 'security' | 'telemetry' | 'analytics' | 'system';

export const WIDGET_REGISTRY: WidgetDef[] = [
  // ── Vehicle ──
  {
    id: 'vehicle-hero',
    name: 'Vehicle Card',
    description: 'Vehicle name, model, state, battery at a glance',
    icon: Car,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 4, rows: 2 },
    component: lazy(() => import('./VehicleHeroWidget')),
  },
  {
    id: 'vehicle-twin',
    name: 'Digital Twin',
    description: 'Visual car state: doors, windows, lights',
    icon: Shield,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 3, rows: 3 },
    component: lazy(() => import('./DigitalTwinWidget')),
  },

  // ── Battery ──
  {
    id: 'battery-gauge',
    name: 'Battery Level',
    description: 'Battery percentage with radial gauge',
    icon: Battery,
    category: 'battery',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 2 },
    component: lazy(() => import('./BatteryGaugeWidget')),
  },
  {
    id: 'range-estimate',
    name: 'Range Estimate',
    description: 'Rated, ideal, and estimated range',
    icon: Gauge,
    category: 'battery',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 1 },
    component: lazy(() => import('./RangeEstimateWidget')),
  },
  {
    id: 'energy-flow',
    name: 'Energy Flow',
    description: 'Live power flow diagram',
    icon: Activity,
    category: 'battery',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./EnergyFlowWidget')),
  },

  // ── Driving ──
  {
    id: 'recent-drives',
    name: 'Recent Drives',
    description: 'Last 5 drives with distance and efficiency',
    icon: Car,
    category: 'driving',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./RecentDrivesWidget')),
  },
  {
    id: 'drive-score',
    name: 'Driving Score',
    description: 'Weekly efficiency and driving score',
    icon: TrendingUp,
    category: 'driving',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 2 },
    component: lazy(() => import('./DriveScoreWidget')),
  },

  // ── Charging ──
  {
    id: 'charge-status',
    name: 'Charge Status',
    description: 'Current charge state, amps, time remaining',
    icon: Zap,
    category: 'charging',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 3, rows: 2 },
    component: lazy(() => import('./ChargeStatusWidget')),
  },
  {
    id: 'charge-history',
    name: 'Charge History',
    description: 'Recent charging sessions chart',
    icon: BarChart3,
    category: 'charging',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./ChargeHistoryWidget')),
  },

  // ── Climate ──
  {
    id: 'climate-status',
    name: 'Climate',
    description: 'Inside/outside temp, HVAC state',
    icon: Thermometer,
    category: 'climate',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 1 },
    component: lazy(() => import('./ClimateStatusWidget')),
  },

  // ── Security ──
  {
    id: 'security-status',
    name: 'Security',
    description: 'Lock, sentry, doors, windows status',
    icon: Shield,
    category: 'security',
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 2, rows: 2 },
    component: lazy(() => import('./SecurityStatusWidget')),
  },

  // ── Telemetry ──
  {
    id: 'live-signals',
    name: 'Live Signals',
    description: 'Real-time signal values with sparklines',
    icon: Wifi,
    category: 'telemetry',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./LiveSignalsWidget')),
  },

  // ── Analytics ──
  {
    id: 'fleet-stats',
    name: 'Fleet Stats',
    description: 'Fleet-wide metrics and totals',
    icon: BarChart3,
    category: 'analytics',
    defaultSize: { cols: 4, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 1 },
    component: lazy(() => import('./FleetStatsWidget')),
  },

  // ── System ──
  {
    id: 'quick-nav',
    name: 'Quick Navigation',
    description: 'Shortcut links to key pages',
    icon: MapPin,
    category: 'system',
    defaultSize: { cols: 4, rows: 1 },
    minSize: { cols: 2, rows: 1 },
    maxSize: { cols: 4, rows: 1 },
    component: lazy(() => import('./QuickNavWidget')),
  },
  {
    id: 'location-map',
    name: 'Vehicle Location',
    description: 'Live vehicle location on map',
    icon: MapPin,
    category: 'vehicle',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 3 },
    component: lazy(() => import('./LocationMapWidget')),
  },
];
```

### Step 3: Create Dashboard Layout State

Create `web/src/features/dashboard/hooks/useDashboardLayout.ts`:

```typescript
export interface WidgetInstance {
  id: string;          // unique instance ID (uuid)
  widgetId: string;    // references WidgetDef.id
  position: number;    // sort order
  size: WidgetSize;    // current size
  config?: Record<string, unknown>;  // widget-specific config (e.g., which vehicle)
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_LAYOUT: DashboardLayout = {
  id: 'default',
  name: 'Default',
  widgets: [
    { id: '1', widgetId: 'vehicle-hero', position: 0, size: { cols: 2, rows: 1 } },
    { id: '2', widgetId: 'battery-gauge', position: 1, size: { cols: 1, rows: 1 } },
    { id: '3', widgetId: 'climate-status', position: 2, size: { cols: 1, rows: 1 } },
    { id: '4', widgetId: 'recent-drives', position: 3, size: { cols: 2, rows: 2 } },
    { id: '5', widgetId: 'charge-status', position: 4, size: { cols: 2, rows: 1 } },
    { id: '6', widgetId: 'security-status', position: 5, size: { cols: 1, rows: 1 } },
    { id: '7', widgetId: 'quick-nav', position: 6, size: { cols: 4, rows: 1 } },
  ],
};

export function useDashboardLayout() {
  // Load/save from localStorage (or backend /api/v1/settings/dashboard)
  const [layout, setLayout] = useState<DashboardLayout>(() => {
    const stored = localStorage.getItem('teslasync-dashboard-layout');
    return stored ? JSON.parse(stored) : DEFAULT_LAYOUT;
  });

  const [editMode, setEditMode] = useState(false);

  const saveLayout = useCallback((newLayout: DashboardLayout) => {
    setLayout(newLayout);
    localStorage.setItem('teslasync-dashboard-layout', JSON.stringify(newLayout));
  }, []);

  const addWidget = useCallback((widgetId: string) => { /* ... */ }, [layout]);
  const removeWidget = useCallback((instanceId: string) => { /* ... */ }, [layout]);
  const reorderWidgets = useCallback((activeId: string, overId: string) => { /* ... */ }, [layout]);
  const resizeWidget = useCallback((instanceId: string, size: WidgetSize) => { /* ... */ }, [layout]);
  const resetLayout = useCallback(() => saveLayout(DEFAULT_LAYOUT), [saveLayout]);

  return { layout, editMode, setEditMode, addWidget, removeWidget,
    reorderWidgets, resizeWidget, resetLayout, saveLayout };
}
```

### Step 4: Build the Dashboard Grid

Create `web/src/features/dashboard/components/DashboardGrid.tsx`:

Use `@dnd-kit/sortable` for drag reordering:

```tsx
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableWidget({ instance, editMode }: { instance: WidgetInstance; editMode: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instance.id,
    disabled: !editMode,
  });

  const widgetDef = WIDGET_REGISTRY.find(w => w.id === instance.widgetId);
  if (!widgetDef) return null;

  const Component = widgetDef.component;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${instance.size.cols}`,
    gridRow: `span ${instance.size.rows}`,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {editMode && (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
          bg-black/60 backdrop-blur-sm rounded-t-xl px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span {...attributes} {...listeners} className="cursor-grab text-white/40 hover:text-white/70">
            <GripVertical className="h-4 w-4" />
          </span>
          <span className="text-xs text-white/50">{widgetDef.name}</span>
          <button onClick={() => removeWidget(instance.id)} className="text-white/40 hover:text-red-400">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <Suspense fallback={<Skeleton className="h-full w-full rounded-xl" />}>
        <Component vehicleId={instance.config?.vehicleId} size={instance.size} />
      </Suspense>
    </div>
  );
}

export function DashboardGrid({ layout, editMode, onReorder, onRemove }: DashboardGridProps) {
  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={layout.widgets.map(w => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-[180px]">
          {layout.widgets
            .sort((a, b) => a.position - b.position)
            .map(w => (
              <SortableWidget key={w.id} instance={w} editMode={editMode} />
            ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

### Step 5: Widget Picker Drawer

Create `web/src/features/dashboard/components/WidgetPicker.tsx`:

A drawer/modal that shows available widgets grouped by category.
Users click to add a widget to their dashboard:

```tsx
function WidgetPicker({ open, onClose, onAddWidget, activeWidgetIds }: WidgetPickerProps) {
  const categories = groupBy(WIDGET_REGISTRY, w => w.category);

  return (
    <Drawer open={open} onClose={onClose} title={t('dashboard.addWidget', 'Add Widget')}>
      {Object.entries(categories).map(([cat, widgets]) => (
        <div key={cat}>
          <h3 className="text-xs uppercase text-white/40 mb-2">{cat}</h3>
          <div className="grid grid-cols-2 gap-2">
            {widgets.map(w => {
              const isAdded = activeWidgetIds.includes(w.id);
              return (
                <GlassPanel
                  key={w.id}
                  className={cn('p-3 cursor-pointer', isAdded && 'opacity-50')}
                  onClick={() => !isAdded && onAddWidget(w.id)}
                >
                  <w.icon className="h-5 w-5 text-[var(--theme-primary)]" />
                  <span className="text-sm font-medium">{w.name}</span>
                  <span className="text-xs text-white/40">{w.description}</span>
                </GlassPanel>
              );
            })}
          </div>
        </div>
      ))}
    </Drawer>
  );
}
```

### Step 6: Edit Mode Toggle

Add an edit button to the dashboard header:

```tsx
<PageContainer
  title={t('Dashboard')}
  actions={
    <div className="flex gap-2">
      {editMode ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => setShowPicker(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t('Add Widget')}
          </Button>
          <Button size="sm" variant="ghost" onClick={resetLayout}>
            {t('Reset')}
          </Button>
          <Button size="sm" onClick={() => setEditMode(false)}>
            {t('Done')}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
          <Settings className="h-4 w-4 mr-1" /> {t('Customize')}
        </Button>
      )}
    </div>
  }
>
```

### Step 7: Create Widget Components

Create individual widget files under `web/src/features/dashboard/widgets/`:

Each widget is a self-contained component that:
- Fetches its own data via existing API hooks
- Renders within its allocated grid space
- Handles loading/error/empty states
- Adapts layout based on `size` prop

```
widgets/
  registry.ts                  — Widget definitions
  VehicleHeroWidget.tsx        — Vehicle hero card (extract from current dashboard)
  BatteryGaugeWidget.tsx       — RadialGauge with battery %
  RangeEstimateWidget.tsx      — Rated/ideal/est range cards
  RecentDrivesWidget.tsx       — Last 5 drives list
  ChargeStatusWidget.tsx       — Current charge state
  ClimateStatusWidget.tsx      — Inside/outside temp
  SecurityStatusWidget.tsx     — Lock, sentry, doors
  LiveSignalsWidget.tsx        — Real-time signal sparklines
  FleetStatsWidget.tsx         — Fleet-wide metrics bar
  QuickNavWidget.tsx           — Navigation shortcuts
  DriveScoreWidget.tsx         — Weekly driving score
  ChargeHistoryWidget.tsx      — Charge session chart
  EnergyFlowWidget.tsx         — Power flow diagram
  LocationMapWidget.tsx        — Vehicle location map
  DigitalTwinWidget.tsx        — Vehicle digital twin (from prompt 01)
```

**Each widget should be extracted from existing dashboard/page code** — don't
rewrite logic, move it into the widget component.

### Step 8: Layout Presets

Offer pre-built layouts for common use cases:

```typescript
const LAYOUT_PRESETS: Record<string, DashboardLayout> = {
  default: { /* balanced layout */ },
  commuter: {
    name: 'Daily Commuter',
    widgets: [
      { widgetId: 'battery-gauge', size: { cols: 1, rows: 1 } },
      { widgetId: 'range-estimate', size: { cols: 1, rows: 1 } },
      { widgetId: 'charge-status', size: { cols: 2, rows: 1 } },
      { widgetId: 'climate-status', size: { cols: 1, rows: 1 } },
      { widgetId: 'location-map', size: { cols: 2, rows: 2 } },
    ],
  },
  fleet_manager: {
    name: 'Fleet Manager',
    widgets: [
      { widgetId: 'fleet-stats', size: { cols: 4, rows: 1 } },
      { widgetId: 'recent-drives', size: { cols: 2, rows: 2 } },
      { widgetId: 'charge-history', size: { cols: 2, rows: 2 } },
      { widgetId: 'drive-score', size: { cols: 1, rows: 1 } },
    ],
  },
  data_nerd: {
    name: 'Data Nerd',
    widgets: [
      { widgetId: 'live-signals', size: { cols: 4, rows: 2 } },
      { widgetId: 'energy-flow', size: { cols: 2, rows: 2 } },
      { widgetId: 'vehicle-twin', size: { cols: 2, rows: 2 } },
    ],
  },
};
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Default layout renders identically to current dashboard
- [ ] Edit mode shows drag handles and remove buttons
- [ ] Dragging reorders widgets correctly
- [ ] Adding a widget from picker places it at the end
- [ ] Removing a widget removes it from the grid
- [ ] Layout persists across page refreshes (localStorage)
- [ ] Resetting layout restores default
- [ ] Layout presets apply correctly
- [ ] Responsive: 2 columns on mobile, 4 on desktop
- [ ] Widget Suspense shows skeleton during lazy load

## Commit

```bash
git add -A
git commit -m "feat(web): add custom dashboard builder with drag-and-drop widgets

- Install @dnd-kit for drag-and-drop widget reordering
- Create 15-widget registry with lazy-loaded components
- Build DashboardGrid with sortable drag handles
- Add WidgetPicker drawer for adding/removing widgets
- Add edit mode toggle with customize/done/reset buttons
- Persist layout in localStorage
- Include 3 layout presets (commuter, fleet manager, data nerd)
- Extract existing dashboard sections into standalone widgets"
```
