/**
 * TIRE_WIDGETS registry — contract + invariant tests.
 *
 * `tires.ts` is a pure data module: it exports one static array of `WidgetDef`
 * descriptors that the dashboard consumes at three points, each guarding an
 * invariant TypeScript alone cannot express:
 *
 *   1. The widget picker (`WidgetPicker` / `WidgetCatalogueDialog`) groups the
 *      catalogue by `category`, renders `name`/`description`, and prints
 *      `defaultSize` as an "N×M grid" chip. A stray category, blank label, or
 *      nonsense size is a user-visible defect.
 *   2. `buildLayoutItem` in `useDashboardLayout` feeds `minSize`/`defaultSize`/
 *      `maxSize` straight into react-grid-layout's `minW/minH/maxW/maxH`. RGL
 *      misbehaves when `min > max`, so the `min ≤ default ≤ max` ordering (and
 *      a column count that fits the 4-wide grid) is a hard requirement.
 *   3. `getWidgetDef(id)` does a first-match `find` over the flattened
 *      `WIDGET_REGISTRY`. That only resolves a tire widget if (a) this file is
 *      actually spread into the registry index and (b) no other category reuses
 *      a tire id — otherwise a saved layout silently renders the wrong widget.
 *
 * These tests lock all three contracts against the real registry so any future
 * edit that drops a widget, duplicates an id, inverts a size bound, forgets the
 * `lazy()` wrapper, mis-points an import, or unwires the registry index fails
 * loudly here. The descriptor assertions stay DOM- and network-free; a final
 * block dynamically imports the two lazy targets to prove they resolve to real
 * default-exported components (a class of wiring bug the descriptor data alone
 * cannot catch).
 */
import { describe, expect, it } from 'vitest';
import { CircleDot } from 'lucide-react';

import { TIRE_WIDGETS } from './tires';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef } from '../types';

/**
 * React tags every `lazy()` result with this shared symbol. Asserting on it
 * proves each `component` is a genuine code-split boundary rather than a plain
 * component reference or an accidental `undefined`.
 */
const REACT_LAZY_TYPE = Symbol.for('react.lazy');

/**
 * The intended tire catalogue, in order. Kept explicit so an accidental drop,
 * rename, or reorder surfaces as a readable diff instead of silently shrinking
 * (or scrambling) the widget picker.
 */
const EXPECTED_IDS = ['tire-pressure-visual', 'tire-pressure-history'] as const;

/** kebab-case, lowercase, no leading/trailing/double hyphens. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The dashboard grid is 4 columns wide at its largest breakpoint. */
const GRID_COLUMNS = 4;

const ids = (defs: readonly WidgetDef[]): string[] => defs.map((w) => w.id);

describe('TIRE_WIDGETS — catalogue shape', () => {
  it('is a non-empty array matching the intended catalogue exactly', () => {
    expect(Array.isArray(TIRE_WIDGETS)).toBe(true);
    expect(TIRE_WIDGETS.length).toBe(EXPECTED_IDS.length);
    expect(ids(TIRE_WIDGETS)).toEqual([...EXPECTED_IDS]);
  });

  it('tags every entry with the "tires" category', () => {
    const misfiled = TIRE_WIDGETS.filter((w) => w.category !== 'tires').map((w) => w.id);
    expect(misfiled).toEqual([]);
  });

  it('has no duplicate ids within the group', () => {
    expect(new Set(ids(TIRE_WIDGETS)).size).toBe(TIRE_WIDGETS.length);
  });
});

describe('TIRE_WIDGETS — per-widget metadata', () => {
  it('gives every widget a kebab-case id and non-blank, trimmed copy', () => {
    const badId = TIRE_WIDGETS.filter((w) => !ID_PATTERN.test(w.id)).map((w) => w.id);
    const badName = TIRE_WIDGETS.filter(
      (w) => w.name.trim().length === 0 || w.name !== w.name.trim(),
    ).map((w) => w.id);
    const badDescription = TIRE_WIDGETS.filter((w) => w.description.trim().length === 0).map(
      (w) => w.id,
    );

    expect(badId).toEqual([]);
    expect(badName).toEqual([]);
    expect(badDescription).toEqual([]);
  });

  it('attaches a renderable icon — the CircleDot glyph — to every tire widget', () => {
    const missingIcon = TIRE_WIDGETS.filter((w) => {
      const kind = typeof w.icon;
      // lucide icons are forwardRef exotics (object); allow plain fn components too.
      return !w.icon || (kind !== 'object' && kind !== 'function');
    }).map((w) => w.id);

    expect(missingIcon).toEqual([]);
    // Both tire widgets intentionally share the CircleDot glyph.
    expect(TIRE_WIDGETS.every((w) => w.icon === CircleDot)).toBe(true);
  });

  it('wires every widget to a lazy-loaded component boundary', () => {
    const notLazy = TIRE_WIDGETS.filter(
      (w) => typeof w.component !== 'object' || w.component.$$typeof !== REACT_LAZY_TYPE,
    ).map((w) => w.id);

    expect(notLazy).toEqual([]);
  });

  it('gives each widget its own component boundary (no shared reference)', () => {
    const distinct = new Set(TIRE_WIDGETS.map((w) => w.component));
    expect(distinct.size).toBe(TIRE_WIDGETS.length);
  });
});

describe('TIRE_WIDGETS — grid size invariants', () => {
  it('uses positive integer dimensions for every size on both axes', () => {
    const bad = TIRE_WIDGETS.filter((w) =>
      [w.minSize, w.defaultSize, w.maxSize].some(
        (s) =>
          !Number.isInteger(s.cols) || !Number.isInteger(s.rows) || s.cols < 1 || s.rows < 1,
      ),
    ).map((w) => w.id);

    expect(bad).toEqual([]);
  });

  it('keeps min ≤ default ≤ max on both axes (react-grid-layout requires it)', () => {
    const inverted = TIRE_WIDGETS.filter(
      (w) =>
        w.minSize.cols > w.defaultSize.cols ||
        w.defaultSize.cols > w.maxSize.cols ||
        w.minSize.rows > w.defaultSize.rows ||
        w.defaultSize.rows > w.maxSize.rows,
    ).map((w) => w.id);

    expect(inverted).toEqual([]);
  });

  it('keeps column counts inside the 4-column grid width', () => {
    const overflow = TIRE_WIDGETS.filter(
      (w) => w.minSize.cols < 1 || w.maxSize.cols > GRID_COLUMNS,
    ).map((w) => w.id);

    expect(overflow).toEqual([]);
  });
});

describe('TIRE_WIDGETS — registry integration', () => {
  it('contributes every tire widget to WIDGET_REGISTRY by reference', () => {
    const orphaned = TIRE_WIDGETS.filter((w) => !WIDGET_REGISTRY.includes(w)).map((w) => w.id);
    expect(orphaned).toEqual([]);
  });

  it('resolves each tire id through getWidgetDef to the same object', () => {
    const unresolved = TIRE_WIDGETS.filter((w) => getWidgetDef(w.id) !== w).map((w) => w.id);
    expect(unresolved).toEqual([]);
    // Spot-check one concrete resolution so the assertion is not purely structural.
    expect(getWidgetDef('tire-pressure-visual')).toBe(
      TIRE_WIDGETS.find((w) => w.id === 'tire-pressure-visual'),
    );
  });

  it('shares no id with any other registry category', () => {
    const tireIds = new Set(ids(TIRE_WIDGETS));
    const collisions = WIDGET_REGISTRY.filter(
      (w) => w.category !== 'tires' && tireIds.has(w.id),
    ).map((w) => w.id);

    expect(collisions).toEqual([]);
  });

  it('returns undefined from getWidgetDef for an unknown tire id', () => {
    expect(getWidgetDef('tire-pressure-not-a-real-widget')).toBeUndefined();
  });
});

describe('TIRE_WIDGETS — catalogue content', () => {
  it('names and describes both tire widgets meaningfully', () => {
    const byId = new Map(TIRE_WIDGETS.map((w) => [w.id, w]));

    expect(byId.get('tire-pressure-visual')?.name).toBe('Tire Pressure Visual');
    expect(byId.get('tire-pressure-history')?.name).toBe('Tire Pressure History');

    // The visual widget is a per-tire diagram; the history widget is a trend.
    const visualDesc = byId.get('tire-pressure-visual')?.description.toLowerCase() ?? '';
    const historyDesc = byId.get('tire-pressure-history')?.description.toLowerCase() ?? '';

    expect(visualDesc).toContain('tire');
    expect(visualDesc).toContain('pressure');
    expect(historyDesc).toContain('trends');
    expect(historyDesc).toContain('range');
  });
});

describe('TIRE_WIDGETS — lazy targets resolve', () => {
  it('loads a distinct default-exported component for every lazy boundary', async () => {
    const modules = await Promise.all([
      import('../TirePressureVisualWidget'),
      import('../TirePressureHistoryWidget'),
    ]);

    for (const mod of modules) {
      expect(typeof mod.default).toBe('function');
    }
    // The two lazy targets must be different components, not a copy-paste alias.
    expect(modules[0].default).not.toBe(modules[1].default);
  });
});
