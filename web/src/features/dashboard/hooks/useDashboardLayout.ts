import { useState, useCallback, useMemo } from 'react';
import type {
  WidgetInstance,
  WidgetConfig,
  SavedDashboard,
  LegacyDashboardLayout,
  RGLLayout,
  RGLLayouts,
} from '../widgets/types';
import { WIDGET_REGISTRY, getWidgetDef } from '../widgets/registry';

const DASHBOARDS_KEY = 'teslasync-dashboards';
const ACTIVE_KEY = 'teslasync-active-dashboard';
const LEGACY_KEY = 'teslasync-dashboard-layout';

/* ─── Breakpoint constants ─── */
export const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 } as const;
export const GRID_COLS = { lg: 4, md: 3, sm: 2, xs: 1 } as const;
export const ROW_HEIGHT = 180;
export const GRID_MARGIN: [number, number] = [16, 16];

/* ─── Helpers ─── */
let nextId = Date.now();
function generateId(): string {
  return `w-${++nextId}`;
}

function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Build RGL Layout item from a WidgetInstance + its WidgetDef, at column x */
function buildLayoutItem(
  widget: WidgetInstance,
  cols: number,
  x: number,
  y: number,
): RGLLayout {
  const def = getWidgetDef(widget.widgetId);
  const defaultW = def?.defaultSize.cols ?? 1;
  const defaultH = def?.defaultSize.rows ?? 1;
  const minW = Math.min(def?.minSize.cols ?? 1, cols);
  const minH = def?.minSize.rows ?? 1;
  const maxW = Math.min(def?.maxSize.cols ?? cols, cols);
  const maxH = def?.maxSize.rows ?? 4;

  return {
    i: widget.id,
    x: x % cols,
    y,
    w: clampMinMax(Math.min(defaultW, cols), minW, maxW),
    h: clampMinMax(defaultH, minH, maxH),
    minW,
    minH,
    maxW,
    maxH,
  };
}

/** Build multi-breakpoint Layouts from a widget list (auto-flow placement) */
function buildDefaultLayouts(widgets: WidgetInstance[]): RGLLayouts {
  const layouts: RGLLayouts = {};
  for (const [bp, cols] of Object.entries(GRID_COLS)) {
    let x = 0;
    let y = 0;
    let rowMaxH = 0;
    const items: RGLLayout[] = [];

    for (const widget of widgets) {
      const item = buildLayoutItem(widget, cols, x, y);
      if (x + item.w > cols) {
        x = 0;
        y += rowMaxH;
        rowMaxH = 0;
        item.x = 0;
        item.y = y;
      }
      items.push(item);
      x += item.w;
      rowMaxH = Math.max(rowMaxH, item.h);
    }
    layouts[bp] = items;
  }
  return layouts;
}

/** Ensure layout has valid items for all widgets and respects current constraints */
function reconcileLayouts(
  layouts: RGLLayouts,
  widgets: WidgetInstance[],
): RGLLayouts {
  const widgetIds = new Set(widgets.map((w) => w.id));
  const result: RGLLayouts = {};

  for (const [bp, cols] of Object.entries(GRID_COLS)) {
    const existing: RGLLayout[] = layouts[bp] ?? [];
    const existingMap = new Map<string, RGLLayout>(existing.map((item) => [item.i, item]));

    const items: RGLLayout[] = [];
    for (const widget of widgets) {
      const def = getWidgetDef(widget.widgetId);
      const minW = Math.min(def?.minSize.cols ?? 1, cols);
      const minH = def?.minSize.rows ?? 1;
      const maxW = Math.min(def?.maxSize.cols ?? cols, cols);
      const maxH = def?.maxSize.rows ?? 4;

      const prev = existingMap.get(widget.id);
      if (prev) {
        items.push({
          ...prev,
          w: clampMinMax(prev.w, minW, maxW),
          h: clampMinMax(prev.h, minH, maxH),
          minW,
          minH,
          maxW,
          maxH,
        });
      } else {
        items.push(buildLayoutItem(widget, cols, 0, Infinity));
      }
    }
    // Remove stale widget references
    result[bp] = items.filter((item) => widgetIds.has(item.i));
  }
  return result;
}

/* ─── Default / Preset dashboards ─── */
function makePreset(
  id: string,
  name: string,
  widgetSpecs: { widgetId: string; config?: WidgetConfig }[],
  isDefault?: boolean,
): SavedDashboard {
  const widgets: WidgetInstance[] = widgetSpecs.map((spec, i) => ({
    id: `${id}-${i + 1}`,
    widgetId: spec.widgetId,
    config: spec.config,
  }));
  return {
    id,
    name,
    widgets,
    layouts: buildDefaultLayouts(widgets),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault,
  };
}

const DEFAULT_DASHBOARD = makePreset(
  'default',
  'Default',
  [
    { widgetId: 'vehicle-hero' },
    { widgetId: 'battery-gauge' },
    { widgetId: 'climate-status' },
    { widgetId: 'recent-drives' },
    { widgetId: 'charge-status' },
    { widgetId: 'security-status' },
    { widgetId: 'quick-nav' },
  ],
  true,
);

export const DASHBOARD_PRESETS: SavedDashboard[] = [
  DEFAULT_DASHBOARD,
  makePreset('commuter', 'Daily Commuter', [
    { widgetId: 'battery-gauge' },
    { widgetId: 'range-estimate' },
    { widgetId: 'charge-status' },
    { widgetId: 'climate-status' },
    { widgetId: 'security-status' },
    { widgetId: 'location-map' },
    { widgetId: 'quick-nav' },
  ]),
  makePreset('fleet_manager', 'Fleet Manager', [
    { widgetId: 'fleet-stats' },
    { widgetId: 'recent-drives' },
    { widgetId: 'charge-history' },
    { widgetId: 'drive-score' },
    { widgetId: 'vehicle-hero' },
    { widgetId: 'quick-nav' },
  ]),
  makePreset('data_nerd', 'Data Nerd', [
    { widgetId: 'live-signals' },
    { widgetId: 'energy-flow' },
    { widgetId: 'vehicle-twin' },
    { widgetId: 'battery-gauge' },
    { widgetId: 'drive-score' },
  ]),
];

/* ─── Migration from legacy format ─── */
function migrateLegacy(legacy: LegacyDashboardLayout): SavedDashboard {
  const widgets: WidgetInstance[] = legacy.widgets
    .filter((w) => WIDGET_REGISTRY.some((def) => def.id === w.widgetId))
    .map((w) => ({
      id: w.id,
      widgetId: w.widgetId,
      config: w.config as WidgetConfig | undefined,
    }));

  return {
    id: legacy.id || 'migrated',
    name: legacy.name || 'My Dashboard',
    widgets,
    layouts: buildDefaultLayouts(widgets),
    createdAt: legacy.createdAt,
    updatedAt: new Date().toISOString(),
    isDefault: true,
  };
}

/* ─── Load from storage with migration ─── */
function loadDashboards(): SavedDashboard[] {
  try {
    const stored = localStorage.getItem(DASHBOARDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SavedDashboard[];
      // Reconcile widgets against current registry
      return parsed.map((d) => ({
        ...d,
        widgets: d.widgets.filter((w) =>
          WIDGET_REGISTRY.some((def) => def.id === w.widgetId),
        ),
        layouts: reconcileLayouts(
          d.layouts ?? {},
          d.widgets.filter((w) =>
            WIDGET_REGISTRY.some((def) => def.id === w.widgetId),
          ),
        ),
      }));
    }
    // Try legacy migration
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as LegacyDashboardLayout;
      const migrated = migrateLegacy(parsed);
      const dashboards = [migrated];
      localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dashboards));
      localStorage.removeItem(LEGACY_KEY);
      return dashboards;
    }
  } catch {
    // Fall through to default
  }
  return [{ ...DEFAULT_DASHBOARD }];
}

function loadActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? 'default';
  } catch {
    return 'default';
  }
}

/* ─── Hook ─── */
export function useDashboardLayout() {
  const [dashboards, setDashboards] = useState<SavedDashboard[]>(loadDashboards);
  const [activeId, setActiveId] = useState<string>(loadActiveId);
  const [editMode, setEditMode] = useState(false);

  const activeDashboard = useMemo(() => {
    return dashboards.find((d) => d.id === activeId) ?? dashboards[0] ?? DEFAULT_DASHBOARD;
  }, [dashboards, activeId]);

  /* ─── Persistence ─── */
  const persist = useCallback((dbs: SavedDashboard[], active?: string) => {
    setDashboards(dbs);
    localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dbs));
    if (active !== undefined) {
      setActiveId(active);
      localStorage.setItem(ACTIVE_KEY, active);
    }
  }, []);

  const updateActive = useCallback(
    (updater: (d: SavedDashboard) => SavedDashboard) => {
      setDashboards((prev) => {
        const updated = prev.map((d) =>
          d.id === activeId ? updater({ ...d, updatedAt: new Date().toISOString() }) : d,
        );
        localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    [activeId],
  );

  /* ─── Layout actions ─── */
  const updateLayouts = useCallback(
    (layouts: RGLLayouts) => {
      updateActive((d) => ({ ...d, layouts }));
    },
    [updateActive],
  );

  const addWidget = useCallback(
    (widgetId: string) => {
      const def = WIDGET_REGISTRY.find((w) => w.id === widgetId);
      if (!def) return;
      const newWidget: WidgetInstance = {
        id: generateId(),
        widgetId,
      };
      updateActive((d) => {
        const widgets = [...d.widgets, newWidget];
        const layouts = reconcileLayouts(d.layouts, widgets);
        return { ...d, widgets, layouts };
      });
    },
    [updateActive],
  );

  const removeWidget = useCallback(
    (instanceId: string) => {
      updateActive((d) => {
        const widgets = d.widgets.filter((w) => w.id !== instanceId);
        const layouts = reconcileLayouts(d.layouts, widgets);
        return { ...d, widgets, layouts };
      });
    },
    [updateActive],
  );

  const updateWidgetConfig = useCallback(
    (instanceId: string, config: WidgetConfig) => {
      updateActive((d) => ({
        ...d,
        widgets: d.widgets.map((w) =>
          w.id === instanceId ? { ...w, config } : w,
        ),
      }));
    },
    [updateActive],
  );

  /* ─── Dashboard CRUD ─── */
  const switchDashboard = useCallback(
    (id: string) => {
      setActiveId(id);
      localStorage.setItem(ACTIVE_KEY, id);
    },
    [],
  );

  const createDashboard = useCallback(
    (name: string, fromPreset?: SavedDashboard) => {
      const id = `custom-${Date.now()}`;
      const base = fromPreset ?? DEFAULT_DASHBOARD;
      const newDash: SavedDashboard = {
        ...base,
        id,
        name,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persist([...dashboards, newDash], id);
      return id;
    },
    [dashboards, persist],
  );

  const renameDashboard = useCallback(
    (id: string, name: string) => {
      persist(
        dashboards.map((d) =>
          d.id === id ? { ...d, name, updatedAt: new Date().toISOString() } : d,
        ),
      );
    },
    [dashboards, persist],
  );

  const deleteDashboard = useCallback(
    (id: string) => {
      const target = dashboards.find((d) => d.id === id);
      if (!target || target.isDefault) return; // Can't delete default
      const remaining = dashboards.filter((d) => d.id !== id);
      if (remaining.length === 0) return; // Always keep at least one
      const nextActive = id === activeId
        ? (remaining.find((d) => d.isDefault)?.id ?? remaining[0].id)
        : activeId;
      persist(remaining, nextActive);
    },
    [dashboards, activeId, persist],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = DASHBOARD_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const id = createDashboard(preset.name, preset);
      return id;
    },
    [createDashboard],
  );

  const resetToDefault = useCallback(() => {
    persist([{ ...DEFAULT_DASHBOARD }], 'default');
  }, [persist]);

  /* ─── Import / Export ─── */
  const exportDashboard = useCallback(
    (id?: string) => {
      const dash = dashboards.find((d) => d.id === (id ?? activeId));
      if (!dash) return;
      const blob = new Blob([JSON.stringify(dash, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teslasync-dashboard-${dash.name.toLowerCase().replace(/\s+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [dashboards, activeId],
  );

  const importDashboard = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as SavedDashboard;
      if (!parsed.name || !parsed.widgets || !parsed.layouts) {
        throw new Error('Invalid layout file');
      }
      // Assign new ID, filter unknown widgets, reconcile layouts
      const id = `import-${Date.now()}`;
      const widgets = (parsed.widgets ?? []).filter((w) =>
        WIDGET_REGISTRY.some((def) => def.id === w.widgetId),
      );
      const newDash: SavedDashboard = {
        ...parsed,
        id,
        widgets,
        layouts: reconcileLayouts(parsed.layouts, widgets),
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persist([...dashboards, newDash], id);
    },
    [dashboards, persist],
  );

  /* ─── Auto arrange ─── */
  const autoArrange = useCallback(() => {
    updateActive((d) => ({
      ...d,
      layouts: buildDefaultLayouts(d.widgets),
    }));
  }, [updateActive]);

  /** Get the current widget size from the lg layout (for passing to widgets) */
  const getWidgetSize = useCallback(
    (instanceId: string): { cols: number; rows: number } => {
      const lgLayout: RGLLayout[] = activeDashboard.layouts.lg ?? [];
      const item = lgLayout.find((l: RGLLayout) => l.i === instanceId);
      if (item) return { cols: item.w, rows: item.h };
      const widget = activeDashboard.widgets.find((w) => w.id === instanceId);
      const def = widget ? getWidgetDef(widget.widgetId) : undefined;
      return def?.defaultSize ?? { cols: 1, rows: 1 };
    },
    [activeDashboard],
  );

  return {
    // Multi-dashboard
    dashboards,
    activeDashboard,
    activeId,
    switchDashboard,
    createDashboard,
    renameDashboard,
    deleteDashboard,
    applyPreset,
    resetToDefault,
    // Edit mode
    editMode,
    setEditMode,
    // Widget CRUD
    addWidget,
    removeWidget,
    updateWidgetConfig,
    // Layout
    updateLayouts,
    autoArrange,
    getWidgetSize,
    // Import / Export
    exportDashboard,
    importDashboard,
  };
}
