/**
 * useActiveFilterChips unit tests.
 *
 * The hook is a pure derive: it maps a `{ key: ChipConfig }` record plus a
 * `{ key: value }` snapshot into the ordered `FilterChipDescriptor[]` that
 * `<ActiveFilterChips>` renders. These tests exercise every branch of that
 * mapping — empty/default dropping, the default vs. custom `isEmpty` and
 * `format` paths, key ordering, per-chip `onRemove` → `setter(undefined)`
 * wiring, memoisation stability, and the null-safety guards for undefined
 * config / state / entries.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  useActiveFilterChips,
  type ChipConfig,
  type ChipConfigRecord,
} from '../useActiveFilterChips';

// Store heterogeneous, correctly-typed entries in one record without
// repeating the `never`-widening cast at every call site (mirrors how a
// real page would build its config with a typed helper).
function chip<V>(c: ChipConfig<V>): ChipConfig<never> {
  return c as unknown as ChipConfig<never>;
}

describe('useActiveFilterChips', () => {
  it('returns an empty array when the config is empty', () => {
    const { result } = renderHook(() => useActiveFilterChips({}, {}));
    expect(result.current).toEqual([]);
  });

  it('maps a single active filter into one descriptor with key/label/value', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      vehicle: chip<string>({ label: 'Vehicle', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { vehicle: 'Model 3' }),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      key: 'vehicle',
      label: 'Vehicle',
      value: 'Model 3',
    });
    expect(typeof result.current[0].onRemove).toBe('function');
  });

  it('drops keys whose value is empty by default (null / undefined / "" / [])', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      a: chip<unknown>({ label: 'A', setter }),
      b: chip<unknown>({ label: 'B', setter }),
      c: chip<unknown>({ label: 'C', setter }),
      d: chip<unknown>({ label: 'D', setter }),
      e: chip<unknown>({ label: 'E', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, {
        a: null,
        b: undefined,
        c: '',
        d: [],
        // `e` is intentionally absent from the snapshot entirely.
      }),
    );
    expect(result.current).toEqual([]);
  });

  it('keeps non-empty falsy values (0 and false render via defaultFormat)', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      count: chip<number>({ label: 'Count', setter }),
      flag: chip<boolean>({ label: 'Flag', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { count: 0, flag: false }),
    );
    expect(result.current).toHaveLength(2);
    expect(result.current.map((c) => c.value)).toEqual(['0', 'false']);
  });

  it('formats arrays with the default comma-join formatter', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      tags: chip<string[]>({ label: 'Tags', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { tags: ['battery', 'charging'] }),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].value).toBe('battery, charging');
  });

  it('uses a custom format function when provided', () => {
    const setter = vi.fn();
    const format = vi.fn((v: number) => `${v} kWh`);
    const config: ChipConfigRecord = {
      energy: chip<number>({ label: 'Energy', setter, format }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { energy: 42 }),
    );
    expect(format).toHaveBeenCalledWith(42);
    expect(result.current[0].value).toBe('42 kWh');
  });

  it('coerces a non-string custom format result to a string', () => {
    const setter = vi.fn();
    // A mis-typed formatter that returns a number must not leak a non-string
    // into the descriptor (FilterChipDescriptor.value is typed `string`).
    const format = ((v: number) => v * 2) as unknown as (v: number) => string;
    const config: ChipConfigRecord = {
      n: chip<number>({ label: 'N', setter, format }),
    };
    const { result } = renderHook(() => useActiveFilterChips(config, { n: 21 }));
    expect(result.current[0].value).toBe('42');
    expect(typeof result.current[0].value).toBe('string');
  });

  it('honours a custom isEmpty override (treats a sentinel value as "no filter")', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      status: chip<string>({
        label: 'Status',
        setter,
        isEmpty: (v) => v === 'all',
      }),
    };
    const shown = renderHook(() =>
      useActiveFilterChips(config, { status: 'active' }),
    );
    expect(shown.result.current).toHaveLength(1);
    expect(shown.result.current[0].value).toBe('active');

    const hidden = renderHook(() =>
      useActiveFilterChips(config, { status: 'all' }),
    );
    expect(hidden.result.current).toEqual([]);
  });

  it('preserves the config key order in the output', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      zebra: chip<string>({ label: 'Zebra', setter }),
      alpha: chip<string>({ label: 'Alpha', setter }),
      mango: chip<string>({ label: 'Mango', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { zebra: 'z', alpha: 'a', mango: 'm' }),
    );
    expect(result.current.map((c) => c.key)).toEqual(['zebra', 'alpha', 'mango']);
  });

  it('ignores state keys that have no matching config entry', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      known: chip<string>({ label: 'Known', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { known: 'yes', stray: 'ignored' }),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].key).toBe('known');
  });

  it('wires onRemove to call the config setter with undefined', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = {
      vehicle: chip<string>({ label: 'Vehicle', setter }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { vehicle: 'Model Y' }),
    );
    result.current[0].onRemove();
    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith(undefined);
  });

  it('routes each chip removal to its own setter without touching siblings', () => {
    const setterA = vi.fn();
    const setterB = vi.fn();
    const config: ChipConfigRecord = {
      a: chip<string>({ label: 'A', setter: setterA }),
      b: chip<string>({ label: 'B', setter: setterB }),
    };
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { a: '1', b: '2' }),
    );
    result.current[1].onRemove();
    expect(setterB).toHaveBeenCalledWith(undefined);
    expect(setterA).not.toHaveBeenCalled();
  });

  it('does not throw and returns [] when config or state is nullish', () => {
    const nullishConfig = undefined as unknown as ChipConfigRecord;
    const { result: r1 } = renderHook(() =>
      useActiveFilterChips(nullishConfig, {}),
    );
    expect(r1.current).toEqual([]);

    const setter = vi.fn();
    const config: ChipConfigRecord = { v: chip<string>({ label: 'V', setter }) };
    const nullishState = undefined as unknown as Record<string, unknown>;
    const { result: r2 } = renderHook(() =>
      useActiveFilterChips(config, nullishState),
    );
    expect(r2.current).toEqual([]);
  });

  it('skips nullish config entries built conditionally', () => {
    const setter = vi.fn();
    const config = {
      shown: chip<string>({ label: 'Shown', setter }),
      hidden: undefined,
    } as unknown as ChipConfigRecord;
    const { result } = renderHook(() =>
      useActiveFilterChips(config, { shown: 'x', hidden: 'y' }),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].key).toBe('shown');
  });

  it('memoises while inputs are referentially stable and recomputes when they change', () => {
    const setter = vi.fn();
    const config: ChipConfigRecord = { v: chip<string>({ label: 'V', setter }) };
    const state1: Record<string, unknown> = { v: 'a' };

    const { result, rerender } = renderHook(
      ({ c, s }) => useActiveFilterChips(c, s),
      { initialProps: { c: config, s: state1 } },
    );
    const first = result.current;

    // Same references → the memoised array is returned unchanged.
    rerender({ c: config, s: state1 });
    expect(result.current).toBe(first);

    // A new state reference invalidates the memo and reflects the new value.
    const state2: Record<string, unknown> = { v: 'b' };
    rerender({ c: config, s: state2 });
    expect(result.current).not.toBe(first);
    expect(result.current[0].value).toBe('b');
  });
});
