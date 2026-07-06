import { describe, it, expect } from 'vitest';
import {
  Battery, Gauge, TrendingUp, Activity, Navigation, Cpu, TrendingDown, HeartPulse,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BATTERY_WIDGETS } from './battery';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef } from '../types';

// ---------------------------------------------------------------------------
// registry/battery — WidgetDef contract tests
//
// battery.ts is a data-only module: it declares the ten "battery" dashboard
// widgets as `WidgetDef` records. It has no branches, so the value of a test
// here is to LOCK the exact invariants every consumer silently relies on, so a
// copy-paste edit to the registry can't regress the dashboard without a red
// test. Each block mirrors how a real consumer reads the data:
//   getWidgetDef / WidgetPicker  → `WIDGET_REGISTRY.find(w => w.id === id)` and
//                                  `new Map(reg.map(w => [w.id, w]))` — both
//                                  break silently on a duplicate id.
//   buildLayoutItem / clampMinMax → reads defaultSize/minSize/maxSize.cols|rows
//                                  and clamps; a `min > max` or out-of-grid
//                                  width silently collapses the widget.
//   React.lazy / <Suspense>       → `component` must be a real lazy element and
//                                  its loader must resolve to a module with a
//                                  default export (a typo'd import path only
//                                  explodes when the user adds the widget).
// ---------------------------------------------------------------------------

/** The battery roster, in declaration order. Adding/removing/reordering a
 *  widget is a deliberate act that must update this list (and the icon map). */
const EXPECTED_IDS = [
  'battery-gauge',
  'battery-radial-gauge',
  'range-estimate',
  'range-bar',
  'battery-degradation-trend',
  'energy-flow',
  'projected-range',
  'battery-cells',
  'battery-degradation-forecast',
  'battery-health-analytics',
] as const;

/** The exact icon each widget binds — locks the id→icon mapping the picker
 *  renders via `<w.icon />`. */
const EXPECTED_ICONS: Record<string, LucideIcon> = {
  'battery-gauge': Battery,
  'battery-radial-gauge': Battery,
  'range-estimate': Gauge,
  'range-bar': Gauge,
  'battery-degradation-trend': TrendingUp,
  'energy-flow': Activity,
  'projected-range': Navigation,
  'battery-cells': Cpu,
  'battery-degradation-forecast': TrendingDown,
  'battery-health-analytics': HeartPulse,
};

/** react.lazy internals (stable in React 18) — the registry's captured loader
 *  lives at `_payload._result` while `_status === -1` (Uninitialized). */
interface LazyInternal {
  $$typeof: symbol;
  _payload: { _status: number; _result: () => Promise<{ default: unknown }> };
  _init: unknown;
}

/** Mirror of `useDashboardLayout.ts` — the grid is 4 columns at its widest
 *  breakpoint (GRID_COLS.lg === 4) and clamps every size into [min, max]. */
const GRID_MAX_COLS = 4;
function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

describe('BATTERY_WIDGETS — roster & structure', () => {
  it('exposes exactly the ten battery widgets in a stable declaration order', () => {
    expect(BATTERY_WIDGETS).toHaveLength(EXPECTED_IDS.length);
    expect(BATTERY_WIDGETS.map((w) => w.id)).toEqual([...EXPECTED_IDS]);
  });

  it('gives every widget the full WidgetDef shape with correctly-typed fields', () => {
    for (const w of BATTERY_WIDGETS) {
      expect(typeof w.id, `${w.id}.id`).toBe('string');
      expect(typeof w.name, `${w.id}.name`).toBe('string');
      expect(typeof w.description, `${w.id}.description`).toBe('string');
      expect(w.category, `${w.id}.category`).toBe('battery');
      // icon is a renderable lucide component (forwardRef object or function).
      expect(['object', 'function'], `${w.id}.icon`).toContain(typeof w.icon);
      expect(w.icon, `${w.id}.icon`).not.toBeNull();
      for (const key of ['defaultSize', 'minSize', 'maxSize'] as const) {
        expect(typeof w[key].cols, `${w.id}.${key}.cols`).toBe('number');
        expect(typeof w[key].rows, `${w.id}.${key}.rows`).toBe('number');
      }
    }
  });

  it('has non-empty name + description copy and no duplicate names (picker search)', () => {
    for (const w of BATTERY_WIDGETS) {
      expect(w.name.trim().length, `${w.id}.name blank`).toBeGreaterThan(0);
      expect(w.description.trim().length, `${w.id}.description blank`).toBeGreaterThan(0);
    }
    const names = BATTERY_WIDGETS.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('binds each widget to its expected lucide icon', () => {
    for (const w of BATTERY_WIDGETS) {
      expect(w.icon, `${w.id} icon`).toBe(EXPECTED_ICONS[w.id]);
    }
  });
});

describe('BATTERY_WIDGETS — id contract (getWidgetDef / WIDGET_BY_ID)', () => {
  it('uses unique, kebab-case, whitespace-free ids', () => {
    const ids = BATTERY_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `${id} not kebab-case`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('resolves each id via getWidgetDef to the very same object reference', () => {
    for (const w of BATTERY_WIDGETS) {
      // getWidgetDef does `WIDGET_REGISTRY.find(...)`; spread preserves refs.
      expect(getWidgetDef(w.id)).toBe(w);
    }
  });

  it('keeps every battery id globally unique across the whole registry', () => {
    // A collision would make the WidgetPicker `new Map(reg.map(...))` and
    // getWidgetDef silently resolve the wrong (later) widget.
    const batteryIds = new Set<string>(EXPECTED_IDS);
    const collisions = WIDGET_REGISTRY.filter(
      (w) => batteryIds.has(w.id) && !(BATTERY_WIDGETS as WidgetDef[]).includes(w),
    );
    expect(collisions).toEqual([]);

    const allIds = WIDGET_REGISTRY.map((w) => w.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('is fully contained in the aggregated WIDGET_REGISTRY', () => {
    for (const w of BATTERY_WIDGETS) {
      expect(WIDGET_REGISTRY).toContain(w);
    }
  });
});

describe('BATTERY_WIDGETS — size contract (buildLayoutItem / clampMinMax)', () => {
  it('keeps every size within the grid and ordered min ≤ default ≤ max', () => {
    for (const w of BATTERY_WIDGETS) {
      for (const key of ['defaultSize', 'minSize', 'maxSize'] as const) {
        expect(w[key].cols, `${w.id}.${key}.cols floor`).toBeGreaterThanOrEqual(1);
        expect(w[key].cols, `${w.id}.${key}.cols ceil`).toBeLessThanOrEqual(GRID_MAX_COLS);
        expect(w[key].rows, `${w.id}.${key}.rows floor`).toBeGreaterThanOrEqual(1);
      }
      // Columns: min ≤ default ≤ max — the invariant clampMinMax relies on.
      expect(w.minSize.cols, `${w.id} minCols`).toBeLessThanOrEqual(w.defaultSize.cols);
      expect(w.defaultSize.cols, `${w.id} defCols`).toBeLessThanOrEqual(w.maxSize.cols);
      // Rows: same ordering (maxSize.rows is intentionally large, e.g. 40).
      expect(w.minSize.rows, `${w.id} minRows`).toBeLessThanOrEqual(w.defaultSize.rows);
      expect(w.defaultSize.rows, `${w.id} defRows`).toBeLessThanOrEqual(w.maxSize.rows);
    }
  });

  it('survives the lg (4-col) clamp unchanged — no silently-shrunk default', () => {
    const cols = GRID_MAX_COLS;
    for (const w of BATTERY_WIDGETS) {
      const minW = Math.min(w.minSize.cols, cols);
      const maxW = Math.min(w.maxSize.cols, cols);
      const resolvedW = clampMinMax(Math.min(w.defaultSize.cols, cols), minW, maxW);
      const resolvedH = clampMinMax(w.defaultSize.rows, w.minSize.rows, w.maxSize.rows);
      // The clamp must be a no-op: the declared default is honoured at lg.
      expect(resolvedW, `${w.id} width`).toBe(w.defaultSize.cols);
      expect(resolvedH, `${w.id} height`).toBe(w.defaultSize.rows);
    }
  });

  it('collapses to a valid single column on the xs (1-col) breakpoint', () => {
    const cols = 1;
    for (const w of BATTERY_WIDGETS) {
      const minW = Math.min(w.minSize.cols, cols);
      const maxW = Math.min(w.maxSize.cols, cols);
      const resolvedW = clampMinMax(Math.min(w.defaultSize.cols, cols), minW, maxW);
      expect(resolvedW, `${w.id} xs width`).toBe(1);
      expect(resolvedW).toBeGreaterThanOrEqual(1);
      expect(resolvedW).toBeLessThanOrEqual(cols);
    }
  });
});

describe('BATTERY_WIDGETS — lazy component contract (React.lazy / Suspense)', () => {
  it('registers each component as a genuine React.lazy element (code-split)', () => {
    for (const w of BATTERY_WIDGETS) {
      const lazy = w.component as unknown as LazyInternal;
      expect(lazy.$$typeof, `${w.id} $$typeof`).toBe(Symbol.for('react.lazy'));
      expect(typeof lazy._init, `${w.id} _init`).toBe('function');
      expect(typeof lazy._payload._result, `${w.id} loader`).toBe('function');
      // Uninitialized until React first renders it — proves it is lazy, not eager.
      expect(lazy._payload._status, `${w.id} status`).toBe(-1);
    }
  });

  it("resolves every widget's real loader to a module with a default export", async () => {
    await Promise.all(
      BATTERY_WIDGETS.map(async (w) => {
        const lazy = w.component as unknown as LazyInternal;
        // Invoke the registry's OWN captured import() — this validates the
        // real import path exists and the module exposes a `default` that
        // React.lazy can render. A typo'd path would reject here.
        const mod = await lazy._payload._result();
        expect(mod, `${w.id} module`).toBeDefined();
        expect(['object', 'function'], `${w.id} default export`).toContain(typeof mod.default);
        expect(mod.default, `${w.id} default export`).not.toBeNull();
      }),
    );
  });
});
