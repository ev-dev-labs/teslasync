import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { verticalCompactor } from 'react-grid-layout';
import type {
  WidgetInstance,
  WidgetConfig,
  SavedDashboard,
  DashboardSettings,
  LegacyDashboardLayout,
  RGLLayout,
  RGLLayouts,
} from '../widgets/types';
import { WIDGET_REGISTRY, getWidgetDef } from '../widgets/registry';
import { useUndoRedo } from './useUndoRedo';
import {
  useDashboardLayouts,
  useSaveDashboardLayouts,
} from '@/api/hooks/useSettings';
import type { DashboardLayoutsPayload } from '@/api/hooks/useSettings';
import { broadcast, subscribe } from '@/lib/broadcast';

const DASHBOARDS_KEY = 'teslasync-dashboards';
const ACTIVE_KEY = 'teslasync-active-dashboard';
const LEGACY_KEY = 'teslasync-dashboard-layout';
const WIDGET_REGISTRY_IDS = new Set(WIDGET_REGISTRY.map((w) => w.id));

/* ─── Breakpoint constants ─── */
export const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 } as const;
export const GRID_COLS = { lg: 4, md: 3, sm: 2, xs: 1 } as const;
export const ROW_HEIGHT = 80;
export const GRID_MARGIN: [number, number] = [16, 16];

/* ─── Undo/Redo snapshot ─── */
interface DashboardSnapshot {
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
}

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
  const maxH = def?.maxSize.rows ?? 20;

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

/** Guard against corrupt layout data (NaN, 0, undefined) from localStorage */
function sanitizeLayouts(layouts: RGLLayouts): RGLLayouts {
  const result: RGLLayouts = {};
  for (const [bp, items] of Object.entries(layouts)) {
    result[bp] = (items as RGLLayout[]).map((item) => ({
      ...item,
      w: Math.max(Number.isFinite(item.w) ? item.w : 1, 1),
      h: Math.max(Number.isFinite(item.h) ? item.h : 1, 1),
      x: Math.max(Number.isFinite(item.x) ? item.x : 0, 0),
      y: Math.max(Number.isFinite(item.y) ? item.y : 0, 0),
    }));
  }
  return result;
}

/**
 * Apply vertical compaction to every breakpoint's layout — slide items up
 * to fill `y` gaps left behind by widget removal, add-after-remove, or
 * other historical edits. Preserves user-resized `w`/`h` and relative
 * order (compactor only changes `y`, not size).
 *
 * Required because react-grid-layout v2 `findOrGenerateResponsiveLayout`
 * EARLY-RETURNS a clone of the saved layout for the current breakpoint
 * WITHOUT applying the compactor (chunk-55DQUWLA.js:525-548). So unless
 * we canonicalize gaps out at the data layer, removed-widget holes survive
 * across reloads forever and the dashboard accumulates blank vertical
 * space over the life of the user's saved layout.
 */
function compactLayouts(layouts: RGLLayouts): RGLLayouts {
  const result: RGLLayouts = {};
  for (const [bp, items] of Object.entries(layouts)) {
    const cols = GRID_COLS[bp as keyof typeof GRID_COLS];
    if (cols === undefined || items.length === 0) {
      result[bp] = items as RGLLayout[];
      continue;
    }
    // verticalCompactor.compact returns a fresh array with each item's `y`
    // squashed up against the floor + previously placed items in its column
    // range. It also sets `moved: false` on each item it processed.
    result[bp] = verticalCompactor.compact(items as RGLLayout[], cols) as RGLLayout[];
  }
  return result;
}

/** Ensure layout has valid items for all widgets and respects current constraints */
export function reconcileLayouts(
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
      const maxH = def?.maxSize.rows ?? 20;

      const prev = existingMap.get(widget.id);
      if (prev) {
        // Preserve user-saved sizes — only enforce min/max from registry
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
  // Slide items up to fill gaps left by removed widgets, add-after-remove,
  // or historical resize-up edits. Without this any code path that flows
  // through reconcileLayouts would let `y` gaps accumulate indefinitely —
  // RGL v2 does not compact existing saved breakpoint layouts at mount.
  return compactLayouts(result);
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
    // Include the onboarding checklist by default for new users so they
    // have a clear path through first-run setup. The widget
    // self-hides once dismissed or the celebration window after 100 % expires.
    // Existing users with persisted layouts are unaffected (their layouts
    // hydrate from backend / localStorage and bypass this default seed).
    { widgetId: 'onboarding-checklist' },
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
  makePreset('charging_focus', 'Charging Hub', [
    { widgetId: 'charge-status-live' },
    { widgetId: 'battery-radial-gauge' },
    { widgetId: 'charge-session-chart' },
    { widgetId: 'charge-cost-tracker' },
    { widgetId: 'charging-schedule' },
    { widgetId: 'range-bar' },
    { widgetId: 'energy-flow-animated' },
  ]),
  makePreset('security_monitor', 'Security Monitor', [
    { widgetId: 'door-window-status' },
    { widgetId: 'sentry-event-log' },
    { widgetId: 'location-map' },
    { widgetId: 'vehicle-hero-card' },
    { widgetId: 'alert-feed' },
    { widgetId: 'command-quick-actions' },
  ]),
  makePreset('road_trip', 'Road Trip', [
    { widgetId: 'battery-radial-gauge' },
    { widgetId: 'range-bar' },
    { widgetId: 'location-map' },
    { widgetId: 'weather-at-car' },
    { widgetId: 'tire-pressure-visual' },
    { widgetId: 'climate-control-panel' },
    { widgetId: 'recent-drives-list' },
    { widgetId: 'drive-efficiency-chart' },
  ]),
  makePreset('performance', 'Performance', [
    { widgetId: 'drive-score-gauge' },
    { widgetId: 'speed-heatmap' },
    { widgetId: 'drive-efficiency-chart' },
    { widgetId: 'battery-degradation-trend' },
    { widgetId: 'energy-flow-animated' },
    { widgetId: 'live-signal-sparklines' },
  ]),
  makePreset('kiosk_wall', 'Wall Display', [
    { widgetId: 'vehicle-hero' },
    { widgetId: 'battery-radial-gauge' },
    { widgetId: 'charge-status-live' },
    { widgetId: 'location-map' },
    { widgetId: 'weather-at-car' },
    { widgetId: 'uptime-monitor' },
  ]),
  makePreset('minimal', 'Minimal', [
    { widgetId: 'battery-radial-gauge' },
    { widgetId: 'charge-status' },
    { widgetId: 'climate-status' },
    { widgetId: 'quick-nav' },
  ]),
];

/* ─── Migration from legacy format ─── */
function migrateLegacy(legacy: LegacyDashboardLayout): SavedDashboard {
  const widgets: WidgetInstance[] = (legacy.widgets ?? [])
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

/* ─── Row height migration ─── */
const ROW_HEIGHT_VERSION_KEY = 'teslasync-row-height-version';
const CURRENT_ROW_VERSION = 2; // v1=180px, v2=80px

function migrateRowHeight(dashboards: SavedDashboard[]): SavedDashboard[] {
  const savedVersion = parseInt(localStorage.getItem(ROW_HEIGHT_VERSION_KEY) ?? '1', 10);
  if (savedVersion >= CURRENT_ROW_VERSION) return dashboards;

  // Scale factor: old ROW_HEIGHT / new ROW_HEIGHT = 180/80 = 2.25
  const scale = 2.25;
  const migrated = dashboards.map((d) => ({
    ...d,
    layouts: Object.fromEntries(
      Object.entries(d.layouts).map(([bp, items]) => [
        bp,
        (items as RGLLayout[]).map((item) => ({
          ...item,
          h: Math.max(Math.round(item.h * scale), 2),
          y: Math.round(item.y * scale),
          minH: item.minH ? Math.max(Math.round(item.minH * scale), 2) : undefined,
          maxH: item.maxH ? Math.round(item.maxH * scale) : undefined,
        })),
      ]),
    ) as RGLLayouts,
  }));

  localStorage.setItem(ROW_HEIGHT_VERSION_KEY, String(CURRENT_ROW_VERSION));
  localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(migrated));
  return migrated;
}

/* ─── Load from storage with migration ─── */
function loadDashboards(): SavedDashboard[] {
  try {
    const stored = localStorage.getItem(DASHBOARDS_KEY);
    if (stored) {
      let parsed = JSON.parse(stored) as SavedDashboard[];
      // Migrate row heights from old ROW_HEIGHT=180 to new ROW_HEIGHT=80
      parsed = migrateRowHeight(parsed);
      // Reconcile widgets against current registry. Compute the valid-widget
      // set once (DRY) and guard against a corrupt entry whose `widgets` is
      // missing — one bad dashboard must not nuke the entire saved list.
      return parsed.map((d) => {
        const validWidgets = (d.widgets ?? []).filter((w) =>
          WIDGET_REGISTRY.some((def) => def.id === w.widgetId),
        );
        return {
          ...d,
          widgets: validWidgets,
          layouts: sanitizeLayouts(
            reconcileLayouts(d.layouts ?? {}, validWidgets),
          ),
        };
      });
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

/** Returns true if localStorage contains only the default dashboard (no custom data). */
function isLocalStorageDefaultOnly(): boolean {
  try {
    const raw = localStorage.getItem(DASHBOARDS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as SavedDashboard[];
    return parsed.length <= 1 && parsed[0]?.id === 'default';
  } catch {
    return true;
  }
}

/* ─── Hook ─── */
export function useDashboardLayout() {
  const [dashboards, setDashboards] = useState<SavedDashboard[]>(loadDashboards);
  const [activeId, setActiveId] = useState<string>(loadActiveId);
  const [editMode, setEditMode] = useState(false);
  const [hydratedFromBackend, setHydratedFromBackend] = useState(false);

  /* ─── Backend sync hooks ─── */
  const { data: backendLayouts } = useDashboardLayouts();
  const saveMutation = useSaveDashboardLayouts();

  /* ─── Debounced backend write ─── */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);
  const syncToBackend = useCallback(
    (dbs: SavedDashboard[], active: string) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setDirty(true);
      debounceTimerRef.current = setTimeout(() => {
        const payload: DashboardLayoutsPayload = {
          dashboards: dbs,
          active_id: active,
        };
        saveMutation.mutate(payload, {
          onSuccess: () => setDirty(false),
        });
      }, 2000);
    },
    [saveMutation],
  );

  /* ─── Hydrate from backend on first load ─── */
  useEffect(() => {
    if (hydratedFromBackend || !backendLayouts) return;
    setHydratedFromBackend(true);

    const hasBackendData =
      Array.isArray(backendLayouts.dashboards) && backendLayouts.dashboards.length > 0;
    if (!hasBackendData) return;

    // Only hydrate if localStorage has no custom data (default-only or empty)
    if (!isLocalStorageDefaultOnly()) return;

    // Use backend data — user switched browser or cleared cookies
    const restored = backendLayouts.dashboards as SavedDashboard[];
    const restoredActiveId = backendLayouts.active_id || 'default';

    // Reconcile restored dashboards against current widget registry
    const reconciled = restored.map((d) => {
      const validWidgets = (d.widgets ?? []).filter((w) =>
        WIDGET_REGISTRY.some((def) => def.id === w.widgetId),
      );
      return {
        ...d,
        widgets: validWidgets,
        layouts: sanitizeLayouts(
          reconcileLayouts(d.layouts ?? {}, validWidgets),
        ),
      };
    });

    if (reconciled.length === 0) return;

    setDashboards(reconciled);
    localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(reconciled));
    const finalActiveId = reconciled.some((d) => d.id === restoredActiveId)
      ? restoredActiveId
      : reconciled[0].id;
    setActiveId(finalActiveId);
    localStorage.setItem(ACTIVE_KEY, finalActiveId);
  }, [backendLayouts, hydratedFromBackend]);

  /* ─── Cross-tab sync ─── */
  // When another tab mutates the dashboard layout, re-read from
  // localStorage so this tab's React state reflects the change. The
  // sibling tab already wrote the new snapshot via persist/updateActive.
  useEffect(() => {
    return subscribe((m) => {
      if (m.type !== 'dashboard.layout') return;
      try {
        const raw = localStorage.getItem(DASHBOARDS_KEY);
        if (raw) setDashboards(JSON.parse(raw) as SavedDashboard[]);
        const active = localStorage.getItem(ACTIVE_KEY);
        if (active) setActiveId(active);
      } catch {
        /* ignore malformed peer write */
      }
    });
  }, []);

  const activeDashboard = useMemo(() => {
    return dashboards.find((d) => d.id === activeId) ?? dashboards[0] ?? DEFAULT_DASHBOARD;
  }, [dashboards, activeId]);

  const activeDashRef = useRef(activeDashboard);
  activeDashRef.current = activeDashboard;
  const dashboardsRef = useRef(dashboards);
  dashboardsRef.current = dashboards;

  /* ─── Undo/Redo history ─── */
  const {
    canUndo, canRedo, undoCount,
    set: pushSnapshot,
    undo: undoSnapshot,
    redo: redoSnapshot,
    reset: resetSnapshot,
  } = useUndoRedo<DashboardSnapshot>({
    widgets: activeDashboard.widgets,
    layouts: activeDashboard.layouts,
  });

  /* ─── Persistence ─── */
  const persist = useCallback((dbs: SavedDashboard[], active?: string) => {
    setDashboards(dbs);
    localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(dbs));
    const resolvedActive = active !== undefined ? active : activeId;
    if (active !== undefined) {
      setActiveId(active);
      localStorage.setItem(ACTIVE_KEY, active);
    }
    syncToBackend(dbs, resolvedActive);
    // Let other tabs reload their layout state from the freshly-written
    // localStorage snapshot.
    broadcast({ type: 'dashboard.layout' });
  }, [activeId, syncToBackend]);

  const updateActive = useCallback(
    (updater: (d: SavedDashboard) => SavedDashboard) => {
      setDashboards((prev) => {
        const updated = prev.map((d) =>
          d.id === activeId ? updater({ ...d, updatedAt: new Date().toISOString() }) : d,
        );
        localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(updated));
        syncToBackend(updated, activeId);
        broadcast({ type: 'dashboard.layout' });
        return updated;
      });
    },
    [activeId, syncToBackend],
  );

  /* ─── Layout actions ─── */
  const updateLayouts = useCallback(
    (layouts: RGLLayouts) => {
      pushSnapshot({ widgets: activeDashRef.current.widgets, layouts });
      updateActive((d) => ({ ...d, layouts }));
    },
    [updateActive, pushSnapshot],
  );

  const addWidgets = useCallback(
    (widgetIds: string[]) => {
      const current = activeDashRef.current;
      const existingWidgetIds = new Set(current.widgets.map((w) => w.widgetId));
      const newWidgets: WidgetInstance[] = [];

      for (const widgetId of widgetIds) {
        if (existingWidgetIds.has(widgetId) || !WIDGET_REGISTRY_IDS.has(widgetId)) continue;
        existingWidgetIds.add(widgetId);
        newWidgets.push({
          id: generateId(),
          widgetId,
        });
      }

      if (newWidgets.length === 0) return;

      const widgets = [...current.widgets, ...newWidgets];
      const layouts = reconcileLayouts(current.layouts, widgets);
      pushSnapshot({ widgets, layouts });
      updateActive((d) => ({ ...d, widgets, layouts }));
    },
    [updateActive, pushSnapshot],
  );

  const addWidget = useCallback(
    (widgetId: string) => addWidgets([widgetId]),
    [addWidgets],
  );

  const removeWidget = useCallback(
    (instanceId: string) => {
      const current = activeDashRef.current;
      const widgets = current.widgets.filter((w) => w.id !== instanceId);
      const layouts = reconcileLayouts(current.layouts, widgets);
      pushSnapshot({ widgets, layouts });
      updateActive((d) => ({ ...d, widgets, layouts }));
    },
    [updateActive, pushSnapshot],
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
      const dash = dashboardsRef.current.find((d) => d.id === id);
      if (dash) resetSnapshot({ widgets: dash.widgets, layouts: dash.layouts });
    },
    [resetSnapshot],
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
      resetSnapshot({ widgets: newDash.widgets, layouts: newDash.layouts });
      return id;
    },
    [dashboards, persist, resetSnapshot],
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
      if (!target || target.isDefault) return;
      const remaining = dashboards.filter((d) => d.id !== id);
      if (remaining.length === 0) return;
      const nextActive = id === activeId
        ? (remaining.find((d) => d.isDefault)?.id ?? remaining[0].id)
        : activeId;
      persist(remaining, nextActive);
      if (id === activeId) {
        const nextDash = remaining.find((d) => d.id === nextActive);
        if (nextDash) resetSnapshot({ widgets: nextDash.widgets, layouts: nextDash.layouts });
      }
    },
    [dashboards, activeId, persist, resetSnapshot],
  );

  const reorderDashboards = useCallback(
    (fromIndex: number, toIndex: number) => {
      setDashboards((prev) => {
        const result = [...prev];
        const [moved] = result.splice(fromIndex, 1);
        // Guard against out-of-range indices: `Array.prototype.splice` on a
        // bad `fromIndex` yields `undefined`, which would otherwise be
        // re-inserted and corrupt the dashboard list. Treat it as a no-op.
        if (moved === undefined) return prev;
        result.splice(toIndex, 0, moved);
        localStorage.setItem(DASHBOARDS_KEY, JSON.stringify(result));
        syncToBackend(result, activeId);
        // Match every other list mutation so peer tabs re-read the reordered
        // snapshot from localStorage instead of drifting out of sync.
        broadcast({ type: 'dashboard.layout' });
        return result;
      });
    },
    [activeId, syncToBackend],
  );

  const duplicateDashboard = useCallback(
    (id: string, name?: string) => {
      const source = dashboards.find((d) => d.id === id);
      if (!source) return;

      const newId = `dup-${Date.now()}`;
      // Build a mapping from old widget IDs to new ones
      const idMap = new Map<string, string>();
      const widgets = source.widgets.map((w) => {
        const newWidgetId = generateId();
        idMap.set(w.id, newWidgetId);
        return { ...w, id: newWidgetId };
      });

      // Remap layout item `i` values to match new widget IDs
      const remappedLayouts: RGLLayouts = {};
      for (const [bp, items] of Object.entries(source.layouts)) {
        remappedLayouts[bp] = (items as RGLLayout[]).map((item) => ({
          ...item,
          i: idMap.get(item.i) ?? item.i,
        }));
      }
      // Reconcile (which now also compacts) so a duplicate of a dashboard
      // that had accumulated gaps comes back clean — and re-clamps to the
      // current registry min/max in case the source was old.
      const layouts = reconcileLayouts(remappedLayouts, widgets);

      const duplicate: SavedDashboard = {
        ...source,
        id: newId,
        name: name?.trim() || `${source.name} (Copy)`,
        icon: source.icon,
        isDefault: false,
        widgets,
        layouts,
        settings: source.settings ? { ...source.settings } : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      persist([...dashboards, duplicate], newId);
      resetSnapshot({ widgets: duplicate.widgets, layouts: duplicate.layouts });
    },
    [dashboards, persist, resetSnapshot],
  );

  const updateDashboardSettings = useCallback(
    (id: string, settings: DashboardSettings) => {
      persist(
        dashboards.map((d) =>
          d.id === id ? { ...d, settings, updatedAt: new Date().toISOString() } : d,
        ),
      );
    },
    [dashboards, persist],
  );

  const updateDashboardIcon = useCallback(
    (id: string, icon: string) => {
      persist(
        dashboards.map((d) =>
          d.id === id ? { ...d, icon, updatedAt: new Date().toISOString() } : d,
        ),
      );
    },
    [dashboards, persist],
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
    resetSnapshot({ widgets: DEFAULT_DASHBOARD.widgets, layouts: DEFAULT_DASHBOARD.layouts });
  }, [persist, resetSnapshot]);

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
      resetSnapshot({ widgets: newDash.widgets, layouts: newDash.layouts });
    },
    [dashboards, persist, resetSnapshot],
  );

  /** Import a pre-validated SavedDashboard directly (used by ImportPreviewModal) */
  const importDashboardFromData = useCallback(
    (dashboard: SavedDashboard) => {
      const finalDash: SavedDashboard = {
        ...dashboard,
        layouts: reconcileLayouts(dashboard.layouts, dashboard.widgets),
        isDefault: false,
      };
      persist([...dashboardsRef.current, finalDash], finalDash.id);
      resetSnapshot({ widgets: finalDash.widgets, layouts: finalDash.layouts });
    },
    [persist, resetSnapshot],
  );

  /* ─── Auto arrange ─── */
  const autoArrange = useCallback(() => {
    const current = activeDashRef.current;
    const layouts = buildDefaultLayouts(current.widgets);
    pushSnapshot({ widgets: current.widgets, layouts });
    updateActive((d) => ({ ...d, layouts }));
  }, [updateActive, pushSnapshot]);

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

  /* ─── Undo / Redo ─── */
  // Run restored snapshots through reconcileLayouts so they get re-clamped
  // to the current registry min/max AND vertically compacted — matches the
  // canonical layout invariant the rest of the app maintains. Without this
  // an undo/redo could resurface a pre-fix layout with accumulated gaps.
  const undo = useCallback(() => {
    const prev = undoSnapshot();
    if (prev) {
      updateActive((d) => ({
        ...d,
        widgets: prev.widgets,
        layouts: reconcileLayouts(prev.layouts, prev.widgets),
      }));
    }
  }, [updateActive, undoSnapshot]);

  const redo = useCallback(() => {
    const next = redoSnapshot();
    if (next) {
      updateActive((d) => ({
        ...d,
        widgets: next.widgets,
        layouts: reconcileLayouts(next.layouts, next.widgets),
      }));
    }
  }, [updateActive, redoSnapshot]);

  const pinToVehicle = useCallback(
    (id: string, vehicleId: number | null | undefined) => {
      persist(
        dashboards.map((d) =>
          d.id === id
            ? { ...d, vehicleId: vehicleId ?? null, updatedAt: new Date().toISOString() }
            : d,
        ),
      );
    },
    [dashboards, persist],
  );

  /**
   * Filter dashboards visible for a given vehicle id. A dashboard is visible
   * when it has no vehicle scope (user-global) OR is pinned to the active
   * vehicle. Pass `null`/`undefined` to see only user-global dashboards.
   */
  const visibleFor = useCallback(
    (vehicleId: number | null | undefined): SavedDashboard[] => {
      return dashboards.filter((d) => {
        const scope = d.vehicleId;
        if (scope == null) return true;
        return vehicleId != null && scope === vehicleId;
      });
    },
    [dashboards],
  );

  return {
    // Multi-dashboard
    dashboards,
    activeDashboard,
    activeId,
    visibleFor,
    pinToVehicle,
    switchDashboard,
    createDashboard,
    renameDashboard,
    deleteDashboard,
    reorderDashboards,
    duplicateDashboard,
    updateDashboardSettings,
    updateDashboardIcon,
    applyPreset,
    resetToDefault,
    // Edit mode
    editMode,
    setEditMode,
    // Unsaved-changes badge — true while a backend write is debounced/in flight.
    dirty,
    // Widget CRUD
    addWidget,
    addWidgets,
    removeWidget,
    updateWidgetConfig,
    // Layout
    updateLayouts,
    autoArrange,
    getWidgetSize,
    // Import / Export
    exportDashboard,
    importDashboard,
    importDashboardFromData,
    // Undo / Redo
    canUndo,
    canRedo,
    undoCount,
    undo,
    redo,
  };
}
