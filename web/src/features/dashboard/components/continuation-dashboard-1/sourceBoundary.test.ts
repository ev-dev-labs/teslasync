import { describe, expect, it } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { sourceBoundaryState } from './sourceBoundary';

describe('dashboard source boundaries', () => {
  it('separates initial loading from an authoritative empty response', () => {
    expect(sourceBoundaryState(deriveDataState({ data: undefined }), false)).toBe('loading');
    expect(sourceBoundaryState(deriveDataState({ data: [] }), false)).toBe('empty');
    expect(sourceBoundaryState(deriveDataState({ data: null }), false)).toBe('empty');
  });

  it('keeps measured zero as ready content', () => {
    expect(sourceBoundaryState(deriveDataState({ data: 0 }), true)).toBe('ready');
  });

  it('uses fatal failure only when no source payload is retained', () => {
    const error = new Error('failed');
    expect(sourceBoundaryState(deriveDataState({ error, isError: true }), false)).toBe('error');
    const rows = [{ value: 12 }];
    const retained = deriveDataState({ data: rows, error, isError: true });
    expect(sourceBoundaryState(retained, true)).toBe('retained');
    expect(retained.data).toBe(rows);
    expect(retained.fatalError).toBeNull();
  });

  it('keeps paused, aged and refreshing payloads without blocking neighboring sources', () => {
    expect(sourceBoundaryState(deriveDataState({ data: [1], fetchStatus: 'paused' }), true)).toBe('retained');
    expect(sourceBoundaryState(deriveDataState(
      { data: [1], dataUpdatedAt: 1 }, { maxAgeMs: 1, now: () => 100 },
    ), true)).toBe('retained');
    expect(sourceBoundaryState(deriveDataState({ data: [1], isFetching: true }), true)).toBe('ready');
    expect(sourceBoundaryState(deriveDataState({ data: [2] }), true)).toBe('ready');
  });
});
