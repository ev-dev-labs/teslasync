import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBulkSelection } from '../useBulkSelection';

describe('useBulkSelection', () => {
  it('starts with an empty selection', () => {
    const { result } = renderHook(() => useBulkSelection<number>());
    expect(result.current.count).toBe(0);
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.isSelected(1)).toBe(false);
  });

  it('toggle adds and removes ids', () => {
    const { result } = renderHook(() => useBulkSelection<number>());

    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.count).toBe(1);

    act(() => result.current.toggle(2));
    expect(result.current.count).toBe(2);

    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.count).toBe(1);
  });

  it('setSelected sets explicit state and is idempotent', () => {
    const { result } = renderHook(() => useBulkSelection<number>());

    act(() => result.current.setSelected(5, true));
    expect(result.current.isSelected(5)).toBe(true);

    const before = result.current.selectedIds;
    // Re-asserting the same value should not mutate the Set reference.
    act(() => result.current.setSelected(5, true));
    expect(result.current.selectedIds).toBe(before);

    act(() => result.current.setSelected(5, false));
    expect(result.current.isSelected(5)).toBe(false);
  });

  it('selectAll is additive and clear empties the set', () => {
    const { result } = renderHook(() => useBulkSelection<number>());

    act(() => result.current.selectAll([1, 2, 3]));
    expect(result.current.count).toBe(3);

    act(() => result.current.selectAll([3, 4]));
    expect(result.current.count).toBe(4);
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isSelected(4)).toBe(true);

    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('selectAll([]) is a no-op', () => {
    const { result } = renderHook(() => useBulkSelection<number>());
    const before = result.current.selectedIds;
    act(() => result.current.selectAll([]));
    expect(result.current.selectedIds).toBe(before);
  });

  it('masterState transitions: none → some → all → none via toggleAll', () => {
    const { result } = renderHook(() => useBulkSelection<number>());
    const visible = [1, 2, 3];

    expect(result.current.masterState(visible)).toBe('none');

    act(() => result.current.toggle(2));
    expect(result.current.masterState(visible)).toBe('some');

    // toggleAll completes the selection of all visible ids
    act(() => result.current.toggleAll(visible));
    expect(result.current.masterState(visible)).toBe('all');

    // toggleAll again deselects them all
    act(() => result.current.toggleAll(visible));
    expect(result.current.masterState(visible)).toBe('none');
  });

  it('masterState returns "none" for an empty visible slice', () => {
    const { result } = renderHook(() => useBulkSelection<number>());
    act(() => result.current.toggle(99));
    expect(result.current.masterState([])).toBe('none');
  });

  it('toggleAll only affects the supplied visible ids', () => {
    const { result } = renderHook(() => useBulkSelection<number>());
    act(() => result.current.selectAll([1, 99]));
    act(() => result.current.toggleAll([1, 2, 3]));

    // 99 was outside the visible slice; preserved.
    expect(result.current.isSelected(99)).toBe(true);
    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.isSelected(3)).toBe(true);
    // 1 was already selected and was visible; the master-toggle decided
    // the slice was partially selected and so completed it.
    expect(result.current.isSelected(1)).toBe(true);
  });

  it('works with string ids (e.g. UUIDs)', () => {
    const { result } = renderHook(() => useBulkSelection<string>());
    act(() => result.current.toggle('uuid-a'));
    act(() => result.current.toggle('uuid-b'));
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected('uuid-a')).toBe(true);
    expect(result.current.masterState(['uuid-a', 'uuid-b'])).toBe('all');
  });
});
