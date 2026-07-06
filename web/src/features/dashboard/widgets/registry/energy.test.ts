import { describe, it, expect } from 'vitest';

import { ENERGY_WIDGETS } from './energy';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef } from '../types';

// ---------------------------------------------------------------------------
// energy widget registry — data-contract lock
//
// energy.ts is a declarative module: no components, hooks, or side effects, just
// the `ENERGY_WIDGETS: WidgetDef[]` catalog. Its value is entirely in the shape
// of the data, and several consumers depend on that shape structurally:
//
//   getWidgetDef / WIDGET_BY_ID (WidgetPicker) key on `id` — a duplicate id
//     anywhere in the merged registry silently shadows a widget.
//   useDashboardLayout.buildLayoutItem clamps the initial tile via
//     `clampMinMax(default, min, max)` per axis — so `min <= default <= max`
//     (and `min <= max`) must hold or the tile silently resizes on first paint.
//   WidgetPicker groups by `category` and renders `name`/`description`/`icon`.
//   DashboardGrid renders `component` inside <Suspense>, so it MUST be a real
//     React.lazy element whose import specifier resolves to a default export.
//   WidgetShell forwards `help` to a HelpTooltip; `defaultValue` is the copy
//     shown until the i18n key is translated.
//
// Each block below mirrors one of those consumer contracts so a copy-paste edit
// to the catalog (a wrong size, a stray id collision, an eager component, a
// missing help default) fails here instead of at runtime. Nothing is rendered —
// the lazy factories are resolved directly, which needs no providers.
// ---------------------------------------------------------------------------

// React tags every value returned by React.lazy() with this registered symbol.
const REACT_LAZY = Symbol.for('react.lazy');

// GRID_COLS.lg — the widest breakpoint buildLayoutItem clamps widths against.
const GRID_LG_COLS = 4;

// The canonical energy catalog. Order + ids are a contract: WidgetPicker lists
// them in this order and saved dashboards persist widgets by id, so a rename or
// reorder is a breaking change that this pin makes visible.
const EXPECTED_IDS = [
  'energy-flow-animated',
  'vampire-drain',
  'sleep-efficiency',
  'solar-production',
  'live-power-flow',
  'energy-site-info',
  'backup-history',
  'power-flow-history',
  'energy-stats',
] as const;

// Widgets that intentionally opt into contextual "?" help copy (WidgetShell).
const EXPECTED_HELP_IDS = ['vampire-drain', 'sleep-efficiency'];
const helpIdSet = new Set<string>(EXPECTED_HELP_IDS);

const REQUIRED_KEYS = [
  'id',
  'name',
  'description',
  'icon',
  'category',
  'defaultSize',
  'minSize',
  'maxSize',
  'component',
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Mirror of useDashboardLayout.clampMinMax — the grid's tile-sizing clamp. */
function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// React.lazy stashes its `() => import(...)` ctor at `_payload._result` while the
// payload is uninitialised (status -1, i.e. never rendered). Reaching for it lets
// us prove the import specifier resolves to a default export without mounting the
// widget — mounting would require QueryClient/Router/i18n providers.
function lazyImportFactory(
  component: WidgetDef['component'],
): (() => Promise<{ default?: unknown }>) | undefined {
  const payload = (component as unknown as { _payload?: { _result?: unknown } })._payload;
  const result = payload?._result;
  return typeof result === 'function'
    ? (result as () => Promise<{ default?: unknown }>)
    : undefined;
}

describe('ENERGY_WIDGETS — catalog shape', () => {
  it('is a non-empty array of widget definitions', () => {
    expect(Array.isArray(ENERGY_WIDGETS)).toBe(true);
    expect(ENERGY_WIDGETS.length).toBeGreaterThan(0);
  });

  it('exposes exactly the expected energy widgets in a stable order', () => {
    expect(ENERGY_WIDGETS.map((w) => w.id)).toEqual([...EXPECTED_IDS]);
    expect(ENERGY_WIDGETS).toHaveLength(EXPECTED_IDS.length);
  });

  it('gives every entry the full WidgetDef surface', () => {
    for (const w of ENERGY_WIDGETS) {
      for (const key of REQUIRED_KEYS) {
        expect(w, `${w.id} is missing "${key}"`).toHaveProperty(key);
      }
    }
  });
});

describe('ENERGY_WIDGETS — identity & category contract', () => {
  it('tags every widget with the energy category', () => {
    for (const w of ENERGY_WIDGETS) {
      expect(w.category, w.id).toBe('energy');
    }
  });

  it('uses unique, kebab-case slug ids', () => {
    const ids = ENERGY_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `"${id}" is not a kebab-case slug`).toMatch(SLUG);
    }
  });

  it('gives every widget non-empty name + description copy', () => {
    for (const w of ENERGY_WIDGETS) {
      expect(w.name.trim().length, `${w.id} name`).toBeGreaterThan(0);
      expect(w.description.trim().length, `${w.id} description`).toBeGreaterThan(0);
    }
  });

  it('is globally addressable — getWidgetDef resolves each id to this exact def', () => {
    // WidgetPicker's WIDGET_BY_ID and useDashboardLayout both key on id via
    // getWidgetDef (a `.find` on the merged registry). Identity equality proves
    // the energy entry is the one the whole app resolves — not a shadow.
    for (const w of ENERGY_WIDGETS) {
      expect(getWidgetDef(w.id), `${w.id} is not resolvable`).toBe(w);
    }
  });

  it('appears exactly once in the merged registry (no cross-category shadowing)', () => {
    for (const w of ENERGY_WIDGETS) {
      const matches = WIDGET_REGISTRY.filter((r) => r.id === w.id);
      expect(matches, `${w.id} occurrences in WIDGET_REGISTRY`).toHaveLength(1);
      expect(matches[0]).toBe(w);
    }
    // Sanity: the energy slice is actually part of the merged registry.
    expect(WIDGET_REGISTRY.length).toBeGreaterThanOrEqual(ENERGY_WIDGETS.length);
  });
});

describe('ENERGY_WIDGETS — size invariants (mirror useDashboardLayout)', () => {
  it('has positive integer cols/rows for every size band', () => {
    for (const w of ENERGY_WIDGETS) {
      const bands = [
        ['default', w.defaultSize],
        ['min', w.minSize],
        ['max', w.maxSize],
      ] as const;
      for (const [band, size] of bands) {
        expect(Number.isInteger(size.cols), `${w.id} ${band}.cols is an int`).toBe(true);
        expect(Number.isInteger(size.rows), `${w.id} ${band}.rows is an int`).toBe(true);
        expect(size.cols, `${w.id} ${band}.cols > 0`).toBeGreaterThan(0);
        expect(size.rows, `${w.id} ${band}.rows > 0`).toBeGreaterThan(0);
      }
    }
  });

  it('orders min <= default <= max on both axes', () => {
    for (const w of ENERGY_WIDGETS) {
      expect(w.minSize.cols, `${w.id} cols min<=default`).toBeLessThanOrEqual(w.defaultSize.cols);
      expect(w.defaultSize.cols, `${w.id} cols default<=max`).toBeLessThanOrEqual(w.maxSize.cols);
      expect(w.minSize.rows, `${w.id} rows min<=default`).toBeLessThanOrEqual(w.defaultSize.rows);
      expect(w.defaultSize.rows, `${w.id} rows default<=max`).toBeLessThanOrEqual(w.maxSize.rows);
    }
  });

  it('keeps min <= max so clampMinMax can never invert a tile', () => {
    for (const w of ENERGY_WIDGETS) {
      expect(w.minSize.cols, `${w.id} cols min<=max`).toBeLessThanOrEqual(w.maxSize.cols);
      expect(w.minSize.rows, `${w.id} rows min<=max`).toBeLessThanOrEqual(w.maxSize.rows);
    }
  });

  it('survives the buildLayoutItem clamp as a no-op at the widest breakpoint', () => {
    // Replicate the exact width/height derivation in
    // useDashboardLayout.buildLayoutItem at lg (4 cols): the first-paint tile
    // must equal the grid-capped default — never a silently shrunk/grown size.
    for (const w of ENERGY_WIDGETS) {
      const minW = Math.min(w.minSize.cols, GRID_LG_COLS);
      const maxW = Math.min(w.maxSize.cols, GRID_LG_COLS);
      const cappedDefaultW = Math.min(w.defaultSize.cols, GRID_LG_COLS);

      const w0 = clampMinMax(cappedDefaultW, minW, maxW);
      const h0 = clampMinMax(w.defaultSize.rows, w.minSize.rows, w.maxSize.rows);

      expect(w0, `${w.id} initial width`).toBe(cappedDefaultW);
      expect(h0, `${w.id} initial height`).toBe(w.defaultSize.rows);
    }
  });

  it('pins the load-bearing default sizes of the flagship widgets', () => {
    const byId = (id: string) => ENERGY_WIDGETS.find((w) => w.id === id);
    expect(byId('energy-flow-animated')?.defaultSize).toEqual({ cols: 2, rows: 4 });
    expect(byId('sleep-efficiency')?.defaultSize).toEqual({ cols: 1, rows: 2 });
    expect(byId('energy-stats')?.minSize).toEqual({ cols: 1, rows: 2 });
  });
});

describe('ENERGY_WIDGETS — icon & lazy component wiring', () => {
  it('binds every widget to a renderable lucide icon', () => {
    for (const w of ENERGY_WIDGETS) {
      expect(w.icon, `${w.id} icon`).toBeTruthy();
      // lucide icons are forwardRef objects; some builds expose them as functions.
      expect(['function', 'object']).toContain(typeof w.icon);
    }
  });

  it('code-splits every widget behind React.lazy (never an eager import)', () => {
    for (const w of ENERGY_WIDGETS) {
      expect(w.component, `${w.id} component`).toBeTruthy();
      expect(typeof w.component, `${w.id} lazy element is an object`).toBe('object');
      expect(w.component.$$typeof, `${w.id} $$typeof`).toBe(REACT_LAZY);
    }
  });

  it('resolves every lazy import to a module with a default component export', async () => {
    for (const w of ENERGY_WIDGETS) {
      const factory = lazyImportFactory(w.component);
      expect(factory, `${w.id} must be lazy(() => import(...))`).toBeTypeOf('function');
      if (typeof factory !== 'function') continue;

      const mod = await factory();
      expect(mod, `${w.id} module namespace`).toBeTruthy();
      // A named-only export here would crash Suspense at runtime.
      expect(['function', 'object']).toContain(typeof mod.default);
      expect(mod.default, `${w.id} default export`).toBeTruthy();
    }
  });
});

describe('ENERGY_WIDGETS — contextual help contract', () => {
  it('attaches help copy to exactly the widgets that opt in', () => {
    const withHelp = ENERGY_WIDGETS.filter((w) => w.help).map((w) => w.id).sort();
    expect(withHelp).toEqual([...EXPECTED_HELP_IDS].sort());
  });

  it('gives every help entry a namespaced i18n key AND a non-empty default string', () => {
    // WidgetShell forwards help.{i18nKey,defaultValue} to HelpTooltip; the
    // default is the always-present fallback shown before the key is translated.
    for (const w of ENERGY_WIDGETS) {
      if (!w.help) continue;
      expect(w.help.i18nKey, `${w.id} help.i18nKey`).toBeTruthy();
      expect(w.help.i18nKey?.startsWith('help.'), `${w.id} help key namespace`).toBe(true);
      expect((w.help.defaultValue ?? '').trim().length, `${w.id} help.defaultValue`).toBeGreaterThan(0);
    }
  });

  it('leaves non-opted-in widgets without a help block', () => {
    for (const w of ENERGY_WIDGETS) {
      if (helpIdSet.has(w.id)) continue;
      expect(w.help, `${w.id} should not declare help`).toBeUndefined();
    }
  });
});
