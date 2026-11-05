import { getWidgetDef } from '../widgets/registry';
import type {
  RGLLayout, RGLLayouts, SavedDashboard, WidgetInstance, WidgetSizeClass,
} from '../widgets/types';
import type { WidgetArrangeAction } from '../components/dashboardLayoutActions';

export const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 600, xs: 0 } as const;
export const GRID_COLS = { lg: 4, md: 3, sm: 2, xs: 1 } as const;
export const ROW_HEIGHT = 80;
export const GRID_MARGIN: [number, number] = [16, 16];
const SIZE_CLASSES: WidgetSizeClass[] = ['small', 'medium', 'large', 'full'];

export function isWidgetSizeClass(value: unknown): value is WidgetSizeClass {
  return SIZE_CLASSES.some(size => size === value);
}

export function sizeClassForColumns(columns: number): WidgetSizeClass {
  return SIZE_CLASSES[Math.max(0, Math.min(3, Math.round(columns || 1) - 1))];
}

export function widgetSizeClass(widget: WidgetInstance): WidgetSizeClass {
  const def = getWidgetDef(widget.widgetId);
  return isWidgetSizeClass(widget.sizeClass)
    ? widget.sizeClass
    : def?.defaultSizeClass ?? sizeClassForColumns(def?.defaultSize.cols ?? 1);
}

export function widgetHeightBounds(widget: WidgetInstance, margin = GRID_MARGIN[1]) {
  const def = getWidgetDef(widget.widgetId);
  const min = def?.contentHeight?.min ?? 72;
  const registryMax = def?.contentHeight?.max ?? 900;
  const requested = widget.heightRows;
  const max = requested && Number.isFinite(requested)
    ? Math.max(min, Math.min(registryMax, requested * (ROW_HEIGHT + margin) - margin))
    : registryMax;
  return { min, max };
}

function overlaps(a: RGLLayout, b: RGLLayout) {
  return a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h - 0.0001 && a.y + a.h > b.y + 0.0001;
}

/** Search every free shelf, not just the preceding item's column. */
export function packOrderedWidgets(
  widgets: WidgetInstance[], columns: number, heights: ReadonlyMap<string, number> = new Map(),
  fillAvailableSpace = false,
): RGLLayout[] {
  const packed: RGLLayout[] = [];
  for (const widget of widgets) {
    const def = getWidgetDef(widget.widgetId);
    const w = Math.min(columns, SIZE_CLASSES.indexOf(widgetSizeClass(widget)) + 1);
    const h = heights.get(widget.id) ?? widget.heightRows ?? def?.defaultSize.rows ?? 2;
    const item: RGLLayout = {
      i: widget.id, x: 0, y: 0, w, h,
      minW: 1, maxW: columns, minH: 1, maxH: def?.maxSize.rows ?? 40,
      userSized: widget.heightRows !== undefined,
      static: false,
    };
    const shelves = [...new Set([0, ...packed.map(other => other.y + other.h)])].sort((a, b) => a - b);
    let placed = false;
    for (const y of shelves) {
      for (let x = 0; x <= columns - w; x++) {
        item.x = x;
        item.y = y;
        if (packed.every(other => !overlaps(item, other))) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    packed.push(item);
  }
  // An incomplete shelf should not leave a half-screen void. This is a
  // presentation span only; the user's size class is never rewritten.
  if (fillAvailableSpace) {
    for (const item of [...packed].reverse()) {
      for (let x = item.x; x >= 0; x--) {
        const candidate = { ...item, x, w: item.x + item.w - x };
        if (packed.some(other => other !== item && overlaps(candidate, other))) break;
        item.x = candidate.x;
        item.w = candidate.w;
      }
      while (item.x + item.w < columns) {
        const candidate = { ...item, w: item.w + 1 };
        if (packed.some(other => other !== item && overlaps(candidate, other))) break;
        item.w = candidate.w;
      }
    }
  }
  return packed;
}

export function orderedLayouts(widgets: WidgetInstance[]): RGLLayouts {
  return Object.fromEntries(Object.entries(GRID_COLS).map(([bp, columns]) =>
    [bp, packOrderedWidgets(widgets, columns)]));
}

export function widgetsInLayoutOrder(widgets: WidgetInstance[], layout: RGLLayout[]): WidgetInstance[] {
  const rank = new Map([...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item, index) => [item.i, index]));
  return [...widgets].sort((a, b) =>
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

export function arrangeOrderedWidget(
  widgets: WidgetInstance[], id: string, action: WidgetArrangeAction, columns: number,
): WidgetInstance[] | null {
  const index = widgets.findIndex(widget => widget.id === id);
  if (index < 0) return null;
  const next = [...widgets];
  if (action.startsWith('move-')) {
    const target = index + (action === 'move-up' || action === 'move-left' ? -1 : 1);
    if (target < 0 || target >= widgets.length) return null;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  const widget = widgets[index];
  if (action === 'make-wider' || action === 'make-narrower') {
    if (columns === 1) return null;
    const current = SIZE_CLASSES.indexOf(widgetSizeClass(widget)) + 1;
    const requested = current + (action === 'make-wider' ? 1 : -1);
    if (requested < 1 || requested > columns) return null;
    next[index] = { ...widget, sizeClass: sizeClassForColumns(requested) };
  } else {
    const current = widget.heightRows ?? getWidgetDef(widget.widgetId)?.defaultSize.rows ?? 2;
    const bounds = widgetHeightBounds({ ...widget, heightRows: undefined });
    const requested = Math.max((bounds.min + 16) / 96, Math.min((bounds.max + 16) / 96,
      current + (action === 'make-taller' ? 1 : -1)));
    if (requested === current) return null;
    next[index] = { ...widget, heightRows: requested };
  }
  return next;
}

/** Migrate once using the widest saved arrangement; subsequent reads ignore coordinates. */
export function normalizeDashboard(dashboard: SavedDashboard): SavedDashboard {
  const seen = new Set<string>();
  const valid = (dashboard.widgets ?? []).filter(widget => {
    if (!getWidgetDef(widget.widgetId) || seen.has(widget.id)) return false;
    seen.add(widget.id);
    return true;
  });
  const legacy = ['lg', 'md', 'sm', 'xs'].map(bp => dashboard.layouts?.[bp])
    .find(layout => layout?.length) ?? [];
  const source = dashboard.layoutVersion === 1 ? valid : widgetsInLayoutOrder(valid, legacy);
  const widgets = source.map(widget => {
    const saved = legacy.find(item => item.i === widget.id);
    const sizeClass = dashboard.layoutVersion !== 1 && saved && Number.isFinite(saved.w)
      ? sizeClassForColumns(saved.w) : widgetSizeClass(widget);
    const heightRows = widget.heightRows
      ?? (dashboard.layoutVersion !== 1 && saved?.userSized && Number.isFinite(saved.h) ? saved.h : undefined);
    return {
      ...widget, sizeClass,
      heightRows: typeof heightRows === 'number' && Number.isFinite(heightRows) && heightRows > 0
        ? heightRows : undefined,
    };
  });
  return { ...dashboard, layoutVersion: 1, widgets, layouts: orderedLayouts(widgets) };
}
