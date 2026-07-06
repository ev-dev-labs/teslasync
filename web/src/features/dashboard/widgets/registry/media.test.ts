/**
 * MEDIA_WIDGETS registry — contract + invariant coverage for the dashboard's
 * "media" widget-catalogue slice (`registry/media.ts`).
 *
 * This module is pure static metadata: an array of `WidgetDef` records the
 * widget picker / dashboard grid read synchronously to render catalogue cards
 * and seed default layouts. Its `component` fields are `React.lazy(...)` thunks
 * whose import factories are deferred, so importing the registry here touches
 * no network and pulls in none of the heavy widget bodies.
 *
 * What this file pins:
 *   - the exported surface: exactly the two media widgets, in order, keyed by
 *     the ids the saved-layout JSON + `getWidgetDef` lookups depend on;
 *   - id + name uniqueness within the slice (a duplicate id would let one def
 *     silently shadow the other in `getWidgetDef` / the picker);
 *   - the full `WidgetDef` shape per entry — non-empty, trimmed id/name/
 *     description, the *specific* lucide `icon` each card must show, the
 *     `'media'` category, and a `component` that is a genuine `React.lazy`
 *     element (never an eagerly-imported module body);
 *   - the size-box invariant `min <= default <= max` on both axes with positive
 *     integer units — a mis-ordered box breaks react-grid-layout clamping;
 *   - the specific metadata for each widget so a rename/resize is a conscious,
 *     reviewed change rather than a silent drift;
 *   - integration with the aggregate registry: every slice entry is reachable
 *     through `WIDGET_REGISTRY` and resolves by id via `getWidgetDef` to the
 *     same object reference the picker renders.
 */
import { describe, it, expect } from 'vitest';
import { Music, ListMusic } from 'lucide-react';
import { MEDIA_WIDGETS } from './media';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetCategory, WidgetDef } from '../types';

// Symbol React tags every `React.lazy(...)` result with. Asserting on it proves
// each widget body stays code-split (deferred import) rather than eager.
const REACT_LAZY = Symbol.for('react.lazy');

const lazyMarker = (w: WidgetDef): symbol | undefined =>
  (w.component as unknown as { $$typeof?: symbol }).$$typeof;

const cases: Array<[string, WidgetDef]> = MEDIA_WIDGETS.map(
  (w): [string, WidgetDef] => [w.id, w],
);

describe('MEDIA_WIDGETS registry', () => {
  it('exports exactly the two media widgets in a stable order', () => {
    expect(Array.isArray(MEDIA_WIDGETS)).toBe(true);
    expect(MEDIA_WIDGETS).toHaveLength(2);
    expect(MEDIA_WIDGETS.map((w) => w.id)).toEqual([
      'media-now-playing',
      'media-history',
    ]);
  });

  it('keeps every widget id unique within the slice', () => {
    const ids = MEDIA_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every widget name unique within the slice', () => {
    const names = MEDIA_WIDGETS.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('files every widget under the "media" category', () => {
    const cats: WidgetCategory[] = MEDIA_WIDGETS.map((w) => w.category);
    expect(cats).toEqual(['media', 'media']);
  });

  it.each(cases)('widget "%s" satisfies the WidgetDef contract', (_id, w) => {
    expect(typeof w.id).toBe('string');
    expect(w.id.length).toBeGreaterThan(0);
    // ids double as saved-layout keys — no stray whitespace may creep in.
    expect(w.id).toBe(w.id.trim());

    expect(typeof w.name).toBe('string');
    expect(w.name.trim().length).toBeGreaterThan(0);
    expect(w.name).toBe(w.name.trim());

    expect(typeof w.description).toBe('string');
    expect(w.description.trim().length).toBeGreaterThan(0);

    // lucide icons are forwardRef components (objects) or plain function
    // components — either way a truthy, renderable reference, never nullish.
    expect(w.icon).toBeTruthy();
    expect(['function', 'object']).toContain(typeof w.icon);

    // The body must stay code-split: a React.lazy element, not an eager import.
    expect(lazyMarker(w)).toBe(REACT_LAZY);
  });

  it('wires each card to its distinct, expected lucide icon', () => {
    const byId = new Map(MEDIA_WIDGETS.map((w) => [w.id, w]));
    expect(byId.get('media-now-playing')?.icon).toBe(Music);
    expect(byId.get('media-history')?.icon).toBe(ListMusic);
    // Two different icons — a copy/paste that reused one icon would regress here.
    expect(byId.get('media-now-playing')?.icon).not.toBe(
      byId.get('media-history')?.icon,
    );
  });

  it('gives each widget its own lazy component thunk', () => {
    const [nowPlaying, history] = MEDIA_WIDGETS;
    expect(nowPlaying.component).not.toBe(history.component);
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

  it('pins the media-now-playing widget metadata', () => {
    const now = MEDIA_WIDGETS.find((w) => w.id === 'media-now-playing');
    expect(now).toBeDefined();
    expect(now?.name).toBe('Now Playing');
    expect(now?.description).toContain('song');
    expect(now?.description).toContain('artist');
    expect(now?.defaultSize).toEqual({ cols: 2, rows: 2 });
    expect(now?.minSize).toEqual({ cols: 1, rows: 2 });
    expect(now?.maxSize).toEqual({ cols: 4, rows: 40 });
  });

  it('pins the media-history widget metadata', () => {
    const hist = MEDIA_WIDGETS.find((w) => w.id === 'media-history');
    expect(hist).toBeDefined();
    expect(hist?.name).toBe('Media History');
    expect(hist?.description).toContain('Recently played');
    expect(hist?.description).toContain('artist');
    expect(hist?.defaultSize).toEqual({ cols: 2, rows: 4 });
    expect(hist?.minSize).toEqual({ cols: 1, rows: 2 });
    expect(hist?.maxSize).toEqual({ cols: 4, rows: 40 });
  });

  it('surfaces every media widget through the aggregate WIDGET_REGISTRY', () => {
    for (const w of MEDIA_WIDGETS) {
      // Spread into WIDGET_REGISTRY preserves object identity, not a clone.
      expect(WIDGET_REGISTRY).toContain(w);
    }
  });

  it('resolves each media widget id via getWidgetDef to the same reference', () => {
    for (const w of MEDIA_WIDGETS) {
      expect(getWidgetDef(w.id)).toBe(w);
    }
    expect(getWidgetDef('media-does-not-exist')).toBeUndefined();
  });
});
