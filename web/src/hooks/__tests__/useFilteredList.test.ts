import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFilteredList } from '../useFilteredList';

interface Item {
  name: string;
  description: string | null;
  tags: string[];
}

const items: Item[] = [
  { name: 'Battery Low', description: 'Battery is at 18%', tags: ['battery'] },
  { name: 'Charge Complete', description: 'Charging finished', tags: ['charging'] },
  { name: 'Sentry Alert', description: null, tags: ['security'] },
];

describe('useFilteredList', () => {
  it('returns the full list when query is empty', () => {
    const { result } = renderHook(() => useFilteredList(items, '', ['name']));
    expect(result.current).toHaveLength(3);
    expect(result.current).toBe(items);
  });

  it('returns the full list when query is whitespace only', () => {
    const { result } = renderHook(() => useFilteredList(items, '   ', ['name']));
    expect(result.current).toHaveLength(3);
  });

  it('returns an empty list when items is undefined', () => {
    const { result } = renderHook(() => useFilteredList<Item>(undefined, 'foo', ['name']));
    expect(result.current).toEqual([]);
  });

  it('returns an empty list when items is null', () => {
    const { result } = renderHook(() => useFilteredList<Item>(null, 'foo', ['name']));
    expect(result.current).toEqual([]);
  });

  it('matches case-insensitively on a single string field', () => {
    const { result } = renderHook(() => useFilteredList(items, 'BATTERY', ['name']));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].name).toBe('Battery Low');
  });

  it('matches across multiple string fields', () => {
    const { result } = renderHook(() => useFilteredList(items, 'finished', ['name', 'description']));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].name).toBe('Charge Complete');
  });

  it('treats null/undefined fields as empty strings (no false positives)', () => {
    const { result } = renderHook(() => useFilteredList(items, 'null', ['description']));
    expect(result.current).toHaveLength(0);
  });

  it('supports function field extractors for derived values', () => {
    const { result } = renderHook(() =>
      useFilteredList(items, 'security', ['name', (item: Item) => item.tags.join(' ')]),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].name).toBe('Sentry Alert');
  });

  it('returns substring matches, not just prefix matches', () => {
    const { result } = renderHook(() => useFilteredList(items, 'plete', ['name']));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].name).toBe('Charge Complete');
  });

  it('returns an empty list when no items match', () => {
    const { result } = renderHook(() => useFilteredList(items, 'zzznomatch', ['name', 'description']));
    expect(result.current).toEqual([]);
  });
});
