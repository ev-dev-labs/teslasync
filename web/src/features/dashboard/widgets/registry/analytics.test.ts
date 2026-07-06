/**
 * ANALYTICS_WIDGETS registry contract.
 *
 * This module is pure configuration — a catalogue of analytics dashboard
 * widgets, each a `WidgetDef` the grid renders on demand. There is no imperative
 * behaviour to drive with userEvent; the "behaviour under test" is the integrity
 * of the data contract every consumer (the widget picker, react-grid-layout, and
 * the saved-layout resolver) silently relies on:
 *
 *   1. Shape — every entry is a well-formed WidgetDef: non-empty id / name /
 *      description, the `analytics` category, an icon, three size boxes, and a
 *      code-split component. A typo'd category or an empty field would drop a
 *      widget from its picker section without any loud failure.
 *   2. Unique ids — the id is the primary key `getWidgetDef` looks up and the
 *      key the dashboard persists per instance; a duplicate makes one widget
 *      unreachable and lets its saved config clobber another's.
 *   3. Size bounds — minSize ≤ defaultSize ≤ maxSize on both axes (all positive
 *      integers) so react-grid-layout can never clamp a widget into an
 *      impossible box.
 *   4. Code splitting — every `component` is a `React.lazy` exotic so importing
 *      the registry into the bundle never eagerly pulls all 14 widget chunks.
 *   5. Wiring — each analytics id round-trips through the shared WIDGET_REGISTRY
 *      / getWidgetDef the app actually calls, resolving back to the very same
 *      object and staying tagged `analytics` (guards against a future global
 *      id collision with another category shadowing it).
 *
 * The registry is static data with no network or DOM side effects at import
 * time (`lazy()` never executes its import factory), so these assertions run
 * against the real exports with nothing mocked.
 */
import { describe, expect, it } from 'vitest';
import { ANALYTICS_WIDGETS } from './analytics';
import { getWidgetDef, WIDGET_REGISTRY } from './index';
import type { WidgetSize } from '../types';

/** Canonical marker React stamps onto every `React.lazy(...)` result. */
const REACT_LAZY = Symbol.for('react.lazy');

const AXES: ReadonlyArray<keyof WidgetSize> = ['cols', 'rows'];

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

describe('ANALYTICS_WIDGETS — catalogue shape', () => {
  it('exposes a non-empty catalogue that is entirely in the analytics category', () => {
    expect(Array.isArray(ANALYTICS_WIDGETS)).toBe(true);
    expect(ANALYTICS_WIDGETS.length).toBeGreaterThan(0);
    expect(ANALYTICS_WIDGETS.every((w) => w.category === 'analytics')).toBe(true);
  });

  it('gives every widget non-empty id / name / description metadata and an icon', () => {
    for (const w of ANALYTICS_WIDGETS) {
      expect(typeof w.id, `id type for ${w.name}`).toBe('string');
      expect(w.id.trim(), `id for ${w.name}`).not.toBe('');
      expect(w.name.trim(), `name for ${w.id}`).not.toBe('');
      expect(w.description.trim(), `description for ${w.id}`).not.toBe('');
      // lucide icons are forwardRef objects; treat any renderable as valid.
      expect(w.icon, `icon for ${w.id}`).toBeTruthy();
    }
  });
});

describe('ANALYTICS_WIDGETS — id uniqueness', () => {
  it('assigns a unique id to every widget', () => {
    const ids = ANALYTICS_WIDGETS.map((w) => w.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `duplicate ids: ${duplicates.join(', ')}`).toEqual([]);
    expect(new Set(ids).size).toBe(ANALYTICS_WIDGETS.length);
  });
});

describe('ANALYTICS_WIDGETS — size bounds', () => {
  it('keeps every cols/rows value a positive integer across all three size boxes', () => {
    const offenders: string[] = [];
    for (const w of ANALYTICS_WIDGETS) {
      const boxes: Array<[string, WidgetSize]> = [
        ['minSize', w.minSize],
        ['defaultSize', w.defaultSize],
        ['maxSize', w.maxSize],
      ];
      for (const [label, box] of boxes) {
        for (const axis of AXES) {
          if (!isPositiveInt(box[axis])) {
            offenders.push(`${w.id}.${label}.${axis}=${box[axis]}`);
          }
        }
      }
    }
    expect(offenders, `non-positive-int sizes:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('orders min ≤ default ≤ max on both axes for every widget', () => {
    const offenders: string[] = [];
    for (const w of ANALYTICS_WIDGETS) {
      for (const axis of AXES) {
        const min = w.minSize[axis];
        const def = w.defaultSize[axis];
        const max = w.maxSize[axis];
        if (!(min <= def && def <= max)) {
          offenders.push(`${w.id}.${axis}: min=${min} default=${def} max=${max}`);
        }
      }
    }
    expect(offenders, `bad size bounds:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

describe('ANALYTICS_WIDGETS — code splitting', () => {
  it('lazy-loads every widget component so none is bundled eagerly', () => {
    for (const w of ANALYTICS_WIDGETS) {
      const component = w.component as unknown as { $$typeof?: symbol };
      expect(component.$$typeof, `component for ${w.id} is not React.lazy`).toBe(REACT_LAZY);
    }
  });
});

describe('ANALYTICS_WIDGETS — shared registry wiring', () => {
  it('contributes every analytics widget object into WIDGET_REGISTRY by reference', () => {
    for (const w of ANALYTICS_WIDGETS) {
      expect(WIDGET_REGISTRY, `WIDGET_REGISTRY missing ${w.id}`).toContain(w);
    }
  });

  it('resolves each analytics id back to the same widget via getWidgetDef', () => {
    for (const w of ANALYTICS_WIDGETS) {
      const found = getWidgetDef(w.id);
      expect(found, `getWidgetDef('${w.id}') did not resolve`).toBe(w);
      expect(found?.category).toBe('analytics');
    }
  });

  it('returns undefined from getWidgetDef for an id that is not registered', () => {
    expect(getWidgetDef('definitely-not-a-real-widget-id')).toBeUndefined();
  });
});
