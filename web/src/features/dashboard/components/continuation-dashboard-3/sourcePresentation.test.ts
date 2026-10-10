import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { sourcePresentation } from './sourcePresentation';

describe('sourcePresentation', () => {
  it('uses fatal failure, not raw refresh errors, to replace a source', () => {
    const error = new Error('refresh failed');
    const retained = deriveDataState({ data: [{ id: 1 }], error, isError: true });
    expect(sourcePresentation(retained, true)).toBe('retained');
    expect(retained.data).toEqual([{ id: 1 }]);
    expect(sourcePresentation(deriveDataState({ error, isError: true }), false)).toBe('error');
  });

  it('distinguishes a pending source, an authoritative empty list and measured zero', () => {
    expect(sourcePresentation(deriveDataState({ isLoading: true }), false)).toBe('loading');
    expect(sourcePresentation(deriveDataState({ data: [] }), false)).toBe('empty');
    expect(sourcePresentation(deriveDataState({ data: 0 }), true)).toBe('ready');
  });

  it('keeps each independent source and its retry unchanged', () => {
    const refetch = vi.fn();
    const failed = deriveDataState({ error: new Error('rates failed'), refetch });
    const healthy = deriveDataState({ data: { target_soc: 0 } });
    expect(sourcePresentation(failed, false)).toBe('error');
    expect(sourcePresentation(healthy, true)).toBe('ready');
    failed.retry?.();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps stale content and treats partial-but-usable content as ready', () => {
    const stale = deriveDataState({ data: { value: 1 }, fetchStatus: 'paused' });
    const partial = deriveDataState({ data: { value: 1 } }, { partial: true });
    expect(sourcePresentation(stale, true)).toBe('retained');
    expect(sourcePresentation(partial, true)).toBe('ready');
  });

  it('retains the notice for a previously loaded empty source after refresh failure', () => {
    const empty = deriveDataState({ data: [], error: new Error('refresh failed') });
    expect(sourcePresentation(empty, false)).toBe('retained');
    expect(empty.data).toEqual([]);
  });
});
