/**
 * Generic selection-state primitive shared across list pages with bulk actions.
 * Keeps alert rules, automations, geofences, exports, and similar views from
 * re-implementing toggle / select-all / master-checkbox bookkeeping.
 *
 * Behaviour:
 *  - `selectedIds` is a Set<T> for O(1) membership checks.
 *  - `selectAll(visible)` is additive (preserves prior selections from
 *    other filter slices). `toggleAll(visible)` is symmetric: if every
 *    visible id is selected it deselects them, otherwise it selects them
 *    — matches the gmail-style master-checkbox UX.
 *  - `masterState(visible)` returns 'none' | 'some' | 'all', driving the
 *    indeterminate flag on the header checkbox.
 *  - Returned API is referentially stable (memoized) so consumers can
 *    pass individual functions into row props without re-renders.
 *
 * The hook is intentionally generic over the id type so callers using
 * string ids (e.g. export job UUIDs) get the same contract as int64 ids.
 */

import { useCallback, useMemo, useState } from 'react';

export interface BulkSelection<T> {
  /** Currently-selected ids. Read-only — mutate via the helpers below. */
  selectedIds: Set<T>;
  /** Convenience accessor for `selectedIds.size`. */
  count: number;
  /** Membership check; equivalent to `selectedIds.has(id)`. */
  isSelected: (id: T) => boolean;
  /** Flip a single id between selected / not. */
  toggle: (id: T) => void;
  /** Set the selection state of a single id explicitly. */
  setSelected: (id: T, selected: boolean) => void;
  /** Add every id in `ids` to the selection (additive — does not deselect). */
  selectAll: (ids: T[]) => void;
  /** Drop every selection. */
  clear: () => void;
  /**
   * Returns the master-checkbox state for the supplied visible ids.
   *  - 'none' — no visible id is selected
   *  - 'some' — at least one (but not all) visible ids are selected
   *  - 'all'  — every visible id is selected
   */
  masterState: (visibleIds: T[]) => 'none' | 'some' | 'all';
  /**
   * Master-checkbox toggle: if every visible id is currently selected,
   * deselect them all; otherwise select all visible ids. Other ids
   * (outside the visible slice) are untouched.
   */
  toggleAll: (visibleIds: T[]) => void;
}

export function useBulkSelection<T = number>(): BulkSelection<T> {
  const [selectedIds, setIds] = useState<Set<T>>(() => new Set<T>());

  const isSelected = useCallback(
    (id: T) => selectedIds.has(id),
    [selectedIds],
  );

  const toggle = useCallback((id: T) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setSelected = useCallback((id: T, sel: boolean) => {
    setIds((prev) => {
      // Skip the state update when the desired value already matches the
      // current one — keeps the Set reference stable so memoized children
      // don't re-render unnecessarily.
      const has = prev.has(id);
      if (has === sel) return prev;
      const next = new Set(prev);
      if (sel) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    if (ids.length === 0) return;
    setIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const clear = useCallback(() => {
    setIds((prev) => (prev.size === 0 ? prev : new Set<T>()));
  }, []);

  const masterState = useCallback(
    (visible: T[]): 'none' | 'some' | 'all' => {
      if (visible.length === 0) return 'none';
      let hits = 0;
      for (const id of visible) {
        if (selectedIds.has(id)) hits++;
      }
      if (hits === 0) return 'none';
      if (hits === visible.length) return 'all';
      return 'some';
    },
    [selectedIds],
  );

  const toggleAll = useCallback((visible: T[]) => {
    if (visible.length === 0) return;
    setIds((prev) => {
      const allSelected = visible.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visible) next.delete(id);
      } else {
        for (const id of visible) next.add(id);
      }
      return next;
    });
  }, []);

  return useMemo<BulkSelection<T>>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    }),
    [
      selectedIds,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    ],
  );
}
