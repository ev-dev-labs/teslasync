/**
 * ALERT_WIDGETS registry — contract + invariant coverage for the dashboard's
 * "alerts" widget-catalogue slice (`registry/alerts.ts`).
 *
 * This module is pure static metadata: an array of `WidgetDef` records the
 * widget picker / dashboard grid read synchronously to render catalogue cards
 * and seed default layouts. Its `component` fields are `React.lazy(...)` thunks
 * whose import factories are deferred, so importing the registry here touches
 * no network and pulls in none of the heavy widget bodies.
 *
 * What this file pins:
 *   - the exported surface: exactly the two alert widgets, in order, keyed by
 *     the ids the saved-layout JSON + `getWidgetDef` lookups depend on;
 *   - id uniqueness within the slice (a duplicate would let one def silently
 *     shadow the other in `getWidgetDef` / the picker);
 *   - the full `WidgetDef` shape per entry — non-empty id/name/description, a
 *     renderable lucide `icon`, the `'alerts'` category, and a `component` that
 *     is a genuine `React.lazy` element (never an eagerly-imported module);
 *   - the size-box invariant `min ≤ default ≤ max` on both axes with positive
 *     integer units — a mis-ordered box breaks react-grid-layout clamping;
 *   - the specific metadata for each widget so a rename/resize is a conscious,
 *     reviewed change rather than a silent drift.
 */
import { describe, it, expect } from 'vitest';
import { ALERT_WIDGETS } from './alerts';
import type { WidgetCategory, WidgetDef } from '../types';

// Symbol React tags every `React.lazy(...)` result with. Asserting on it proves
// each widget body stays code-split (deferred import) rather than eager.
const REACT_LAZY = Symbol.for('react.lazy');

const cases: Array<[string, WidgetDef]> = ALERT_WIDGETS.map(
  (w): [string, WidgetDef] => [w.id, w],
);

describe('ALERT_WIDGETS registry', () => {
  it('exports exactly the two alert widgets in a stable order', () => {
    expect(Array.isArray(ALERT_WIDGETS)).toBe(true);
    expect(ALERT_WIDGETS).toHaveLength(2);
    expect(ALERT_WIDGETS.map((w) => w.id)).toEqual([
      'alert-feed',
      'notification-stats',
    ]);
  });

  it('keeps every widget id unique within the slice', () => {
    const ids = ALERT_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every widget under the "alerts" category', () => {
    const cats: WidgetCategory[] = ALERT_WIDGETS.map((w) => w.category);
    expect(cats).toEqual(['alerts', 'alerts']);
  });

  it.each(cases)('widget "%s" satisfies the WidgetDef contract', (_id, w) => {
    expect(typeof w.id).toBe('string');
    expect(w.id.length).toBeGreaterThan(0);

    expect(typeof w.name).toBe('string');
    expect(w.name.trim().length).toBeGreaterThan(0);

    expect(typeof w.description).toBe('string');
    expect(w.description.trim().length).toBeGreaterThan(0);

    // lucide icons are forwardRef components (objects) or plain function
    // components — either way a truthy, renderable reference, never nullish.
    expect(w.icon).toBeTruthy();
    expect(['function', 'object']).toContain(typeof w.icon);

    // The body must stay code-split: a React.lazy element, not an eager import.
    const marker = (w.component as unknown as { $$typeof?: symbol }).$$typeof;
    expect(marker).toBe(REACT_LAZY);
  });

  it.each(cases)(
    'widget "%s" declares a coherent min <= default <= max size box',
    (_id, w) => {
      for (const axis of ['cols', 'rows'] as const) {
        const min = w.minSize[axis];
        const def = w.defaultSize[axis];
        const max = w.maxSize[axis];

        for (const v of [min, def, max]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
        expect(min).toBeLessThanOrEqual(def);
        expect(def).toBeLessThanOrEqual(max);
      }
    },
  );

  it('pins the alert-feed widget metadata', () => {
    const feed = ALERT_WIDGETS.find((w) => w.id === 'alert-feed');
    expect(feed).toBeDefined();
    expect(feed?.name).toBe('Alert Feed');
    expect(feed?.description).toContain('severity');
    expect(feed?.defaultSize).toEqual({ cols: 2, rows: 4 });
    expect(feed?.minSize).toEqual({ cols: 2, rows: 4 });
    expect(feed?.maxSize).toEqual({ cols: 4, rows: 40 });
  });

  it('pins the notification-stats widget metadata', () => {
    const stats = ALERT_WIDGETS.find((w) => w.id === 'notification-stats');
    expect(stats).toBeDefined();
    expect(stats?.name).toBe('Notification Stats');
    expect(stats?.description).toContain('delivery');
    expect(stats?.defaultSize).toEqual({ cols: 2, rows: 2 });
    expect(stats?.minSize).toEqual({ cols: 1, rows: 2 });
    expect(stats?.maxSize).toEqual({ cols: 4, rows: 40 });
  });
});
