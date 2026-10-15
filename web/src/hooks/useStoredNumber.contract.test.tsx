import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoredNumber } from './useStoredNumber';

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useStoredNumber key and compatibility contract', () => {
  it('reads each key before exposing a render and preserves exact saved numbers on return', () => {
    localStorage.setItem('synthetic-a', '123.456789012345');
    localStorage.setItem('synthetic-b', '987.654321');
    const renders: Array<[string, number]> = [];
    const hook = renderHook(({ key }) => {
      const result = useStoredNumber(key, 160);
      renders.push([key, result[0]]);
      return result;
    }, { initialProps: { key: 'synthetic-a' } });
    hook.rerender({ key: 'synthetic-b' });
    expect(hook.result.current[0]).toBe(987.654321);
    expect(renders.filter(([key]) => key === 'synthetic-b').every(([, value]) => value === 987.654321)).toBe(true);
    hook.rerender({ key: 'synthetic-empty' });
    expect(hook.result.current[0]).toBe(160);
    hook.rerender({ key: 'synthetic-a' });
    expect(hook.result.current[0]).toBe(123.456789012345);
  });

  it('retains default fallback and finite-only setter semantics while exposing the raw saved value', () => {
    localStorage.setItem('synthetic-target', 'invalid');
    const hook = renderHook(() => useStoredNumber('synthetic-target', 160));
    expect(hook.result.current[0]).toBe(160);
    expect(hook.result.current[2]).toBe('invalid');
    act(() => hook.result.current[1](NaN));
    act(() => hook.result.current[1](Infinity));
    expect(localStorage.getItem('synthetic-target')).toBe('invalid');
    act(() => hook.result.current[1](-12.3456789));
    expect(hook.result.current[0]).toBe(-12.3456789);
    expect(localStorage.getItem('synthetic-target')).toBe('-12.3456789');
  });

  it('isolates stale setters and old-key events and preserves deletion/current fallback behavior', () => {
    const hook = renderHook(({ key, fallback }) => useStoredNumber(key, fallback), {
      initialProps: { key: 'synthetic-a', fallback: 160 },
    });
    const oldSetter = hook.result.current[1];
    hook.rerender({ key: 'synthetic-b', fallback: 180 });
    act(() => oldSetter(42));
    expect(localStorage.getItem('synthetic-a')).toBe('42');
    expect(hook.result.current[0]).toBe(180);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'synthetic-a', newValue: '99' })));
    expect(hook.result.current[0]).toBe(180);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'synthetic-b', newValue: '181.234' })));
    expect(hook.result.current[0]).toBe(181.234);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'synthetic-b', newValue: null })));
    expect(hook.result.current).toEqual([180, expect.any(Function), null]);
  });

  it('keeps session values on storage write failure and cleans up the storage listener', () => {
    const hook = renderHook(() => useStoredNumber('synthetic-target', 160));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => hook.result.current[1](123.456));
    expect(hook.result.current[0]).toBe(123.456);
    const remove = vi.spyOn(window, 'removeEventListener');
    hook.unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('retains a fixed-key consumer value on fallback changes until a matching storage event', () => {
    const hook = renderHook(({ fallback }) => useStoredNumber('synthetic-target', fallback), {
      initialProps: { fallback: 160 },
    });
    act(() => hook.result.current[1](171.23));
    hook.rerender({ fallback: 180 });
    expect(hook.result.current[0]).toBe(171.23);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'synthetic-target', newValue: 'Infinity' })));
    expect(hook.result.current[0]).toBe(180);
    expect(hook.result.current[2]).toBe('Infinity');
  });
});
