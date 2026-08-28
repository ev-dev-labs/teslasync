/**
 * Row-label derivation contract (A11Y-10 correction round).
 *
 * Both helpers are pure and exported, so the rules that decide what a
 * selection checkbox is called are asserted without rendering a table.
 *
 * The rule that matters most is a negative one: a database identifier
 * must never become a checkbox name. A screen reader reads an
 * unpronounceable token character by character — "Select 3 f a 9 c 2
 * dash 1 b 4 e …" — which is longer, conveys nothing, and cannot be
 * repeated back by a voice-control user. Generic "Select row" is the
 * better outcome in that case, so `isOpaqueRowKey` must be strict.
 */

import { describe, it, expect } from 'vitest';
import { extractRenderedText, isOpaqueRowKey } from '@/components/ui/DataTable';

describe('isOpaqueRowKey', () => {
  it.each([
    ['f47ac10b-58cc-4372-a567-0e02b2c3d479', 'canonical UUID v4'],
    ['F47AC10B-58CC-4372-A567-0E02B2C3D479', 'upper-case UUID'],
    ['9c8589018a57479181fe4c455b099bc9', 'dashless UUID / hex digest'],
    ['a1b2c3d4e5f6', '12-char hex digest'],
    ['4291', 'bare numeric primary key'],
    ['0', 'zero key'],
    ['   ', 'whitespace-only key'],
    ['', 'empty key'],
    ['V1StGXR8Z5jdHi6BMyT3sV9kQ2wLpN', 'nanoid-style token'],
    ['01ARZ3NDEKTSV4RRFFQ69G5FAV', 'ULID'],
  ])('rejects %s (%s)', (key) => {
    expect(isOpaqueRowKey(key)).toBe(true);
  });

  it.each([
    ['model-3', 'short hyphenated slug'],
    ['drives:list', 'namespaced id'],
    ['Morning commute', 'human phrase'],
    ['VehicleSpeed', 'signal name'],
    ['charge_state', 'snake-case field name'],
  ])('keeps %s (%s)', (key) => {
    expect(isOpaqueRowKey(key)).toBe(false);
  });

  it('keeps a long value that reads like prose', () => {
    // Length alone is not opacity — a spoken phrase is fine however long.
    expect(isOpaqueRowKey('Supercharger Mountain View, 12 March 2026')).toBe(false);
  });
});

describe('extractRenderedText', () => {
  it('reads a bare string or number', () => {
    expect(extractRenderedText('Morning commute')).toBe('Morning commute');
    expect(extractRenderedText(12)).toBe('12');
  });

  it('digs through the wrapper elements real renderers return', () => {
    expect(
      extractRenderedText(
        <div className="flex">
          <span className="font-medium">Grocery run</span>
        </div>,
      ),
    ).toBe('Grocery run');
  });

  it('skips aria-hidden decoration so icons never leak into a name', () => {
    expect(
      extractRenderedText(
        <div>
          <span aria-hidden="true">•</span>
          <span>Airport trip</span>
        </div>,
      ),
    ).toBe('Airport trip');
  });

  it('joins sibling fragments in reading order', () => {
    expect(
      extractRenderedText(
        <div>
          <span>Supercharger</span>
          <span>Mountain View</span>
        </div>,
      ),
    ).toBe('Supercharger Mountain View');
  });

  it('returns null for a cell with no readable content', () => {
    expect(extractRenderedText(<span aria-hidden="true">•</span>)).toBeNull();
    expect(extractRenderedText(null)).toBeNull();
    expect(extractRenderedText(undefined)).toBeNull();
    expect(extractRenderedText(false)).toBeNull();
    expect(extractRenderedText('   ')).toBeNull();
  });

  it('stops before recursing through a deeply nested cell', () => {
    // A guard against pathological renderers: the walk is bounded, so a
    // deeply buried string is simply not found rather than costing an
    // unbounded traversal on every row of every table.
    const deep = (
      <div>
        <div>
          <div>
            <div>
              <div>
                <span>buried</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
    expect(extractRenderedText(deep)).toBeNull();
  });
});
