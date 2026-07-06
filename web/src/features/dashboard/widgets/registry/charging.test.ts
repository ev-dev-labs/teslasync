/**
 * CHARGING_WIDGETS registry — contract + invariant tests.
 *
 * `charging.ts` is a pure data module: it exports one static array of
 * `WidgetDef` descriptors that the dashboard reads at three points, each of
 * which relies on an invariant that TypeScript alone cannot express:
 *
 *   1. The widget picker (`WidgetPicker` / `WidgetCatalogueDialog`) groups the
 *      catalogue by `category`, renders `name`/`description`, and prints the
 *      `defaultSize` as an "N×M grid" chip. A stray category, blank label, or
 *      nonsense size is a user-visible defect.
 *   2. `buildLayoutItem` in `useDashboardLayout` feeds `minSize`/`defaultSize`/
 *      `maxSize` straight into react-grid-layout's `minW/minH/maxW/maxH`. RGL
 *      misbehaves if `min > max`, so the min ≤ default ≤ max ordering (and a
 *      column count that fits the 4-wide grid) is a hard requirement.
 *   3. `getWidgetDef(id)` does a first-match `find` over the flattened
 *      `WIDGET_REGISTRY`. That only resolves a charging widget if (a) this file
 *      is actually spread into the registry index and (b) no other category
 *      reuses a charging id — otherwise a saved layout silently renders the
 *      wrong (or no) widget.
 *
 * These tests lock all three contracts against the real registry so any future
 * edit that drops a widget, duplicates an id, inverts a size bound, forgets the
 * `lazy()` wrapper, or unwires the registry index fails loudly here. The suite
 * is intentionally network- and DOM-free — it asserts on the descriptor data
 * and its integration with the registry index, nothing more.
 */
import { describe, expect, it } from 'vitest';

import { CHARGING_WIDGETS } from './charging';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef } from '../types';

/**
 * React tags every `lazy()` result with this shared symbol. Asserting on it
 * proves each `component` is a genuine code-split boundary rather than a plain
 * component reference or an accidental `undefined`.
 */
const REACT_LAZY_TYPE = Symbol.for('react.lazy');

/**
 * The intended charging catalogue, in order. Kept explicit so an accidental
 * drop, rename, or reorder surfaces as a readable diff instead of silently
 * shrinking (or scrambling) the widget picker.
 */
const EXPECTED_IDS = [
  'charge-status',
  'charge-status-live',
  'charge-history',
  'charge-session-chart',
  'charge-cost-tracker',
  'charging-schedule',
  'cost-forecast',
  'charging-optimizer',
  'wall-connector',
  'charging-telemetry',
  'supercharger-history',
  'charge-plans',
  'charging-session-detail',
] as const;

/** kebab-case, lowercase, no leading/trailing/double hyphens. */
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The dashboard grid is 4 columns wide at its largest breakpoint. */
const GRID_COLUMNS = 4;

const ids = (defs: readonly WidgetDef[]): string[] => defs.map((w) => w.id);

describe('CHARGING_WIDGETS — catalogue shape', () => {
  it('is a non-empty array matching the intended catalogue exactly', () => {
    expect(Array.isArray(CHARGING_WIDGETS)).toBe(true);
    expect(CHARGING_WIDGETS.length).toBe(EXPECTED_IDS.length);
    expect(ids(CHARGING_WIDGETS)).toEqual([...EXPECTED_IDS]);
  });

  it('tags every entry with the "charging" category', () => {
    const misfiled = CHARGING_WIDGETS.filter((w) => w.category !== 'charging').map((w) => w.id);
    expect(misfiled).toEqual([]);
  });

  it('has no duplicate ids within the group', () => {
    expect(new Set(ids(CHARGING_WIDGETS)).size).toBe(CHARGING_WIDGETS.length);
  });
});

describe('CHARGING_WIDGETS — per-widget metadata', () => {
  it('gives every widget a kebab-case id and non-blank, trimmed copy', () => {
    const badId = CHARGING_WIDGETS.filter((w) => !ID_PATTERN.test(w.id)).map((w) => w.id);
    const badName = CHARGING_WIDGETS.filter(
      (w) => w.name.trim().length === 0 || w.name !== w.name.trim(),
    ).map((w) => w.id);
    const badDescription = CHARGING_WIDGETS.filter((w) => w.description.trim().length === 0).map(
      (w) => w.id,
    );

    expect(badId).toEqual([]);
    expect(badName).toEqual([]);
    expect(badDescription).toEqual([]);
  });

  it('attaches a renderable icon to every widget', () => {
    const missingIcon = CHARGING_WIDGETS.filter((w) => {
      const kind = typeof w.icon;
      // lucide icons are forwardRef exotics (object); allow plain fn components too.
      return !w.icon || (kind !== 'object' && kind !== 'function');
    }).map((w) => w.id);

    expect(missingIcon).toEqual([]);
  });

  it('wires every widget to a lazy-loaded component boundary', () => {
    const notLazy = CHARGING_WIDGETS.filter(
      (w) => typeof w.component !== 'object' || w.component.$$typeof !== REACT_LAZY_TYPE,
    ).map((w) => w.id);

    expect(notLazy).toEqual([]);
  });
});

describe('CHARGING_WIDGETS — grid size invariants', () => {
  it('uses positive integer dimensions for every size on both axes', () => {
    const bad = CHARGING_WIDGETS.filter((w) =>
      [w.minSize, w.defaultSize, w.maxSize].some(
        (s) =>
          !Number.isInteger(s.cols) ||
          !Number.isInteger(s.rows) ||
          s.cols < 1 ||
          s.rows < 1,
      ),
    ).map((w) => w.id);

    expect(bad).toEqual([]);
  });

  it('keeps min ≤ default ≤ max on both axes (react-grid-layout requires it)', () => {
    const inverted = CHARGING_WIDGETS.filter(
      (w) =>
        w.minSize.cols > w.defaultSize.cols ||
        w.defaultSize.cols > w.maxSize.cols ||
        w.minSize.rows > w.defaultSize.rows ||
        w.defaultSize.rows > w.maxSize.rows,
    ).map((w) => w.id);

    expect(inverted).toEqual([]);
  });

  it('keeps column counts inside the 4-column grid width', () => {
    const overflow = CHARGING_WIDGETS.filter(
      (w) => w.minSize.cols < 1 || w.maxSize.cols > GRID_COLUMNS,
    ).map((w) => w.id);

    expect(overflow).toEqual([]);
  });
});

describe('CHARGING_WIDGETS — registry integration', () => {
  it('contributes every charging widget to WIDGET_REGISTRY by reference', () => {
    const orphaned = CHARGING_WIDGETS.filter((w) => !WIDGET_REGISTRY.includes(w)).map((w) => w.id);
    expect(orphaned).toEqual([]);
  });

  it('resolves each charging id through getWidgetDef to the same object', () => {
    const unresolved = CHARGING_WIDGETS.filter((w) => getWidgetDef(w.id) !== w).map((w) => w.id);
    expect(unresolved).toEqual([]);
    // Spot-check one concrete resolution so the assertion is not purely structural.
    expect(getWidgetDef('wall-connector')).toBe(CHARGING_WIDGETS.find((w) => w.id === 'wall-connector'));
  });

  it('shares no id with any other registry category', () => {
    const chargingIds = new Set(ids(CHARGING_WIDGETS));
    const collisions = WIDGET_REGISTRY.filter(
      (w) => w.category !== 'charging' && chargingIds.has(w.id),
    ).map((w) => w.id);

    expect(collisions).toEqual([]);
  });

  it('returns undefined from getWidgetDef for an unknown id', () => {
    expect(getWidgetDef('charge-status-not-a-real-widget')).toBeUndefined();
  });
});

describe('CHARGING_WIDGETS — catalogue content', () => {
  it('describes the wall-connector and supercharger widgets meaningfully', () => {
    const byId = new Map(CHARGING_WIDGETS.map((w) => [w.id, w]));

    expect(byId.get('wall-connector')?.description.toLowerCase()).toContain('wall connector');
    expect(byId.get('supercharger-history')?.description.toLowerCase()).toContain('supercharger');
    expect(byId.get('charge-status')?.name).toBe('Charge Status');
  });
});
