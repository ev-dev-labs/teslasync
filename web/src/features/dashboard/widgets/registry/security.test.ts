/**
 * SECURITY_WIDGETS registry contract.
 *
 * This module is pure configuration — a curated catalogue of the security
 * dashboard widgets, each a `WidgetDef` the grid renders on demand. There is no
 * imperative behaviour to drive with userEvent; the "behaviour under test" is the
 * integrity of the data contract every consumer (the widget picker,
 * react-grid-layout, and the saved-layout resolver) silently relies on:
 *
 *   1. Shape — every entry is a well-formed WidgetDef: non-empty id / name /
 *      description, the `security` category, an icon, three size boxes, and a
 *      code-split component. A typo'd category or an empty field would drop a
 *      widget from its picker section without any loud failure.
 *   2. Curated set — the catalogue exposes exactly the seven intended widgets,
 *      each mapped to its intended lucide icon. This locks the contract so an
 *      accidental deletion (a widget silently vanishing from its picker section)
 *      or a copy-paste id/icon regression fails loudly here rather than in prod.
 *   3. Unique ids — the id is the primary key `getWidgetDef` looks up and the
 *      key the dashboard persists per instance; a duplicate — within security OR
 *      shadowing another category in the shared registry — makes one widget
 *      unreachable and lets its saved config clobber another's.
 *   4. Size bounds — minSize ≤ defaultSize ≤ maxSize on both axes (all positive
 *      integers), and no box demands more columns than the widest grid
 *      breakpoint can render (GRID_COLS.lg === 4 in useDashboardLayout.ts), so
 *      react-grid-layout can never clamp a widget into an impossible box.
 *   5. Code splitting — every `component` is a `React.lazy` exotic so importing
 *      the registry into the bundle never eagerly pulls all widget chunks.
 *   6. Wiring — each security id round-trips through the shared WIDGET_REGISTRY /
 *      getWidgetDef the app actually calls, resolving back to the very same
 *      object and staying tagged `security`, and an unknown id resolves to
 *      undefined (the not-found branch every caller must tolerate).
 *
 * The registry is static data with no network or DOM side effects at import time
 * (`lazy()` never executes its import factory), so these assertions run against
 * the real exports with nothing mocked.
 */
import { describe, expect, it } from 'vitest';
import { Shield, DoorOpen, Eye, ShieldAlert, AlertOctagon, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SECURITY_WIDGETS } from './security';
import { getWidgetDef, WIDGET_REGISTRY } from './index';
import type { WidgetSize } from '../types';

/** Canonical marker React stamps onto every `React.lazy(...)` result. */
const REACT_LAZY = Symbol.for('react.lazy');

const AXES: ReadonlyArray<keyof WidgetSize> = ['cols', 'rows'];

/** Widest react-grid-layout breakpoint — GRID_COLS.lg in useDashboardLayout.ts. */
const MAX_GRID_COLS = 4;

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * The curated catalogue this module is contracted to expose, in registry order.
 * Adding or removing a security widget is an intentional change that must update
 * this table — that is the point: it guards against an accidental drop or a
 * copy-paste id/icon regression.
 */
const EXPECTED: ReadonlyArray<{ id: string; icon: LucideIcon }> = [
  { id: 'security-status', icon: Shield },
  { id: 'door-window-status', icon: DoorOpen },
  { id: 'sentry-event-log', icon: Eye },
  { id: 'safety-features', icon: ShieldAlert },
  { id: 'safety-history', icon: AlertOctagon },
  { id: 'guard-mode', icon: Shield },
  { id: 'vehicle-access', icon: Users },
];

describe('SECURITY_WIDGETS — catalogue shape', () => {
  it('exposes a non-empty catalogue that is entirely in the security category', () => {
    expect(Array.isArray(SECURITY_WIDGETS)).toBe(true);
    expect(SECURITY_WIDGETS.length).toBeGreaterThan(0);
    expect(SECURITY_WIDGETS.every((w) => w.category === 'security')).toBe(true);
  });

  it('gives every widget non-empty id / name / description metadata and an icon', () => {
    for (const w of SECURITY_WIDGETS) {
      expect(typeof w.id, `id type for ${w.name}`).toBe('string');
      expect(w.id.trim(), `id for ${w.name}`).not.toBe('');
      expect(w.name.trim(), `name for ${w.id}`).not.toBe('');
      expect(w.description.trim(), `description for ${w.id}`).not.toBe('');
      // lucide icons are forwardRef objects; treat any renderable as valid.
      expect(w.icon, `icon for ${w.id}`).toBeTruthy();
    }
  });
});

describe('SECURITY_WIDGETS — curated catalogue contract', () => {
  it('exposes exactly the expected security widget ids in registry order', () => {
    expect(SECURITY_WIDGETS.map((w) => w.id)).toEqual(EXPECTED.map((e) => e.id));
  });

  it('wires each widget to its intended lucide icon', () => {
    const byId = new Map(SECURITY_WIDGETS.map((w) => [w.id, w]));
    for (const { id, icon } of EXPECTED) {
      const widget = byId.get(id);
      expect(widget, `missing widget: ${id}`).toBeDefined();
      expect(widget?.icon, `icon for ${id}`).toBe(icon);
    }
  });
});

describe('SECURITY_WIDGETS — id uniqueness', () => {
  it('assigns a unique id to every widget', () => {
    const ids = SECURITY_WIDGETS.map((w) => w.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `duplicate ids: ${duplicates.join(', ')}`).toEqual([]);
    expect(new Set(ids).size).toBe(SECURITY_WIDGETS.length);
  });

  it('does not collide with an id contributed by any other category', () => {
    const collisions: string[] = [];
    for (const w of SECURITY_WIDGETS) {
      const count = WIDGET_REGISTRY.filter((r) => r.id === w.id).length;
      if (count !== 1) collisions.push(`${w.id} appears ${count}× in WIDGET_REGISTRY`);
    }
    expect(collisions, `cross-category id collisions:\n  ${collisions.join('\n  ')}`).toEqual([]);
  });
});

describe('SECURITY_WIDGETS — size bounds', () => {
  it('keeps every cols/rows value a positive integer across all three size boxes', () => {
    const offenders: string[] = [];
    for (const w of SECURITY_WIDGETS) {
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
    for (const w of SECURITY_WIDGETS) {
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

  it('never demands more columns than the widest grid breakpoint can render', () => {
    const offenders: string[] = [];
    for (const w of SECURITY_WIDGETS) {
      const boxes: Array<[string, WidgetSize]> = [
        ['minSize', w.minSize],
        ['defaultSize', w.defaultSize],
        ['maxSize', w.maxSize],
      ];
      for (const [label, box] of boxes) {
        if (box.cols > MAX_GRID_COLS) {
          offenders.push(`${w.id}.${label}.cols=${box.cols} > ${MAX_GRID_COLS}`);
        }
      }
    }
    expect(offenders, `widgets wider than the grid:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});

describe('SECURITY_WIDGETS — code splitting', () => {
  it('lazy-loads every widget component so none is bundled eagerly', () => {
    for (const w of SECURITY_WIDGETS) {
      const component = w.component as unknown as { $$typeof?: symbol };
      expect(component.$$typeof, `component for ${w.id} is not React.lazy`).toBe(REACT_LAZY);
    }
  });
});

describe('SECURITY_WIDGETS — shared registry wiring', () => {
  it('contributes every security widget object into WIDGET_REGISTRY by reference', () => {
    for (const w of SECURITY_WIDGETS) {
      expect(WIDGET_REGISTRY, `WIDGET_REGISTRY missing ${w.id}`).toContain(w);
    }
  });

  it('resolves each security id back to the same widget via getWidgetDef', () => {
    for (const w of SECURITY_WIDGETS) {
      const found = getWidgetDef(w.id);
      expect(found, `getWidgetDef('${w.id}') did not resolve`).toBe(w);
      expect(found?.category).toBe('security');
    }
  });

  it('returns undefined from getWidgetDef for an id that is not registered', () => {
    expect(getWidgetDef('definitely-not-a-real-widget-id')).toBeUndefined();
  });
});
