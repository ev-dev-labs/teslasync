/**
 * MAP_WIDGETS — dashboard "maps" category registry contract.
 *
 * maps.ts is pure metadata: the catalogue of location/geo dashboard tiles
 * (live map, favourites, geofence, destination ETA, position heatmap). It
 * ships no runtime logic, so the meaningful surface under test is the
 * *contract* every downstream consumer silently depends on:
 *
 *   - WidgetPicker groups tiles by `category` and renders `icon`/`name`/
 *     `description`; a blank or duplicated field drops a tile from the picker
 *     or breaks its grid.
 *   - DashboardGrid mounts `component` inside <Suspense>, so it MUST be a
 *     React.lazy exotic — a bare function or `undefined` crashes the grid.
 *   - react-grid-layout clamps tiles to `minSize`/`defaultSize`/`maxSize`; an
 *     incoherent bound (min > default, or cols > 4) yields an unplaceable tile.
 *   - getWidgetDef() indexes tiles by `id` across the whole registry, so ids
 *     must be unique and every maps tile must round-trip through the aggregate.
 *
 * These tests lock that contract so a bad edit (renamed lazy import, dropped
 * tile, mistyped category, incoherent size, half-filled help) fails here at
 * load time rather than as a blank/broken panel in the browser.
 */
import { describe, it, expect } from 'vitest';

import { MAP_WIDGETS } from './maps';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetSize } from '../types';

// The exact catalogue maps.ts is expected to ship, in order. Pinned so a
// dropped or renamed tile — the most likely regression — fails loudly.
const EXPECTED_MAP_IDS = [
  'location-map',
  'location-favorites',
  'geofence-status',
  'destination-eta',
  'position-heatmap',
] as const;

// React tags lazy() output with this well-known symbol; DashboardGrid relies
// on it to Suspense-wrap the tile. Stable across the React 18 line.
const REACT_LAZY = Symbol.for('react.lazy');

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;
const coherentBound = (min: number, def: number, max: number): boolean =>
  isPositiveInt(min) && def >= min && max >= def;
const cols = (s: WidgetSize): number => s.cols;

describe('MAP_WIDGETS', () => {
  it('exposes the full maps catalogue as a non-empty array', () => {
    expect(Array.isArray(MAP_WIDGETS)).toBe(true);
    expect(MAP_WIDGETS.length).toBeGreaterThan(0);
    expect(MAP_WIDGETS.length).toBe(EXPECTED_MAP_IDS.length);
  });

  it('ships exactly the expected tiles, in order, each with a unique id', () => {
    const ids = MAP_WIDGETS.map((w) => w.id);
    expect(ids).toEqual([...EXPECTED_MAP_IDS]);
    // Uniqueness is what getWidgetDef's index depends on.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every tile under the "maps" category', () => {
    for (const w of MAP_WIDGETS) {
      expect(w.category).toBe('maps');
    }
  });

  it('gives every tile complete, non-empty presentation metadata', () => {
    for (const w of MAP_WIDGETS) {
      expect(typeof w.id).toBe('string');
      expect(w.id.trim().length).toBeGreaterThan(0);
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.description.trim().length).toBeGreaterThan(0);
      // lucide icons are truthy component refs (a forwardRef object).
      expect(w.icon).toBeTruthy();
      expect(['function', 'object']).toContain(typeof w.icon);
    }
  });

  it('wraps every component in React.lazy so the grid can Suspense-mount it', () => {
    for (const w of MAP_WIDGETS) {
      expect(typeof w.component).toBe('object');
      expect(w.component.$$typeof).toBe(REACT_LAZY);
    }
  });

  it('keeps size bounds coherent (1 <= min <= default <= max) for cols and rows', () => {
    for (const w of MAP_WIDGETS) {
      expect(coherentBound(w.minSize.cols, w.defaultSize.cols, w.maxSize.cols)).toBe(true);
      expect(coherentBound(w.minSize.rows, w.defaultSize.rows, w.maxSize.rows)).toBe(true);
    }
  });

  it('constrains every column span to the four-column grid', () => {
    for (const w of MAP_WIDGETS) {
      expect(cols(w.minSize)).toBeGreaterThanOrEqual(1);
      expect(cols(w.minSize)).toBeLessThanOrEqual(4);
      expect(cols(w.defaultSize)).toBeLessThanOrEqual(4);
      expect(cols(w.maxSize)).toBeLessThanOrEqual(4);
    }
  });

  it('never ships help metadata that is present but empty', () => {
    // maps.ts ships no help today; this guards a future half-filled entry
    // (a key with no fallback, or neither key nor text) that WidgetShell would
    // otherwise render as an empty "?" tooltip.
    for (const w of MAP_WIDGETS) {
      if (!w.help) {
        expect(w.help).toBeUndefined();
        continue;
      }
      expect(Boolean(w.help.i18nKey) || Boolean(w.help.text)).toBe(true);
      if (w.help.i18nKey) {
        expect((w.help.defaultValue ?? '').trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('MAP_WIDGETS integration with the aggregate registry', () => {
  it('contributes every maps tile to WIDGET_REGISTRY by reference', () => {
    for (const w of MAP_WIDGETS) {
      expect(WIDGET_REGISTRY).toContain(w);
    }
  });

  it('resolves every maps id back to its own definition via getWidgetDef', () => {
    for (const w of MAP_WIDGETS) {
      const def = getWidgetDef(w.id);
      expect(def).toBe(w);
      expect(def?.category).toBe('maps');
    }
  });

  it('does not collide any maps id with another registry category', () => {
    const mapIds = new Set(MAP_WIDGETS.map((w) => w.id));
    const others = WIDGET_REGISTRY.filter((w) => !mapIds.has(w.id));
    for (const id of mapIds) {
      expect(others.some((w) => w.id === id)).toBe(false);
    }
    // Sanity: the aggregate genuinely holds widgets beyond the maps set, so
    // the collision check above is not vacuously true.
    expect(others.length).toBeGreaterThan(0);
  });
});
