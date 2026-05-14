/**
 * TreeSelect — generic tri-state tree multi-select primitive.
 *
 * Two-level hierarchy (groups → leaves) with:
 *   - tri-state group checkboxes (none / partial / all)
 *   - search filter (filters the tree, does NOT flatten it)
 *   - per-group counts (`{selected}/{visible}`)
 *   - controlled selection + expansion via props
 *   - optional `renderLeafRight` / `renderGroupRight` slots for badges,
 *     sparklines, etc.
 *   - per-leaf disabled state
 *   - WAI-ARIA tree pattern with roving-tabindex keyboard navigation
 *
 * Selection is independent of the search filter: selected leaves remain
 * selected when filtered out of view, and group / "Select visible"
 * actions only ever affect currently-visible (filtered) leaves. This
 * matches the Grafana convention and avoids the "I cleared search and
 * lost my picks" footgun.
 *
 * The DOM is a flat sequence of `role="treeitem"` rows so a future
 * virtualization wrapper (react-window, react-virtuoso) can drop in
 * without reworking the API.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { Button, Checkbox, Input } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface TreeLeaf<T> {
  id: string;
  label: string;
  data: T;
}

export interface TreeGroup<T> {
  id: string;
  label: string;
  leaves: TreeLeaf<T>[];
}

export interface TreeSelectProps<T> {
  /** Top-level groups. Each group's `leaves` is the full set (search filters in-component). */
  groups: TreeGroup<T>[];
  /** Currently-selected leaf ids. Controlled. */
  selectedIds: string[];
  /**
   * Fired with the next selected-id list. Accepts either the next array
   * or a functional updater `(prev) => next` — the updater form is
   * essential when many checkbox toggles can dispatch faster than React
   * commits (clicking 3 boxes rapidly), otherwise each handler closes
   * over a stale `selectedIds` and only the last toggle wins.
   */
  onChange: (next: string[] | ((prev: string[]) => string[])) => void;
  /** Search box value. Controlled (parent owns it so it can be URL-synced). */
  searchValue: string;
  /** Fired when the search box value changes. */
  onSearchChange: (next: string) => void;
  /** Optional controlled expanded-group ids. Defaults to internal state. */
  expandedGroupIds?: string[];
  /** Fired when a group is expanded/collapsed (only when `expandedGroupIds` is provided). */
  onExpandedChange?: (next: string[]) => void;
  /** Right-slot per leaf (e.g. sparkline, badge). */
  renderLeafRight?: (leaf: TreeLeaf<T>) => ReactNode;
  /** Right-slot per group header (e.g. category description). */
  renderGroupRight?: (group: TreeGroup<T>) => ReactNode;
  /** Disabled-leaf predicate — disabled leaves are visible but uncheckable. */
  getLeafDisabled?: (leaf: TreeLeaf<T>) => boolean;
  /** Tooltip / sr-only reason for disabled leaves. */
  getLeafDisabledReason?: (leaf: TreeLeaf<T>) => string | undefined;
  /** Loading state — replaces the body with a skeleton placeholder. */
  isLoading?: boolean;
  /** Rendered when `groups` is empty (no catalog). */
  emptyState?: ReactNode;
  /** Rendered when search filter eliminates all leaves. */
  noResultsState?: ReactNode;
  /** Search box placeholder. */
  searchPlaceholder?: string;
  /** Accessible label for the tree (sr-only). */
  ariaLabel?: string;
  /** Outer container className. */
  className?: string;
  /** Max height of the scroll area. Defaults to `max-h-[60vh]`. */
  maxHeightClassName?: string;
}

/**
 * Filter `groups` by search needle (case-insensitive substring against
 * the leaf label). Groups whose label matches keep all their leaves;
 * otherwise only matching leaves are kept. Groups with zero matches are
 * dropped. Returns the original `groups` reference when no search is
 * active for cheap memo equality.
 */
function filterGroups<T>(groups: TreeGroup<T>[], needle: string): TreeGroup<T>[] {
  const q = needle.trim().toLowerCase();
  if (!q) return groups;
  const out: TreeGroup<T>[] = [];
  for (const g of groups) {
    const groupMatches = g.label.toLowerCase().includes(q);
    const filteredLeaves = groupMatches
      ? g.leaves
      : g.leaves.filter((l) => l.label.toLowerCase().includes(q));
    if (filteredLeaves.length === 0) continue;
    out.push({ ...g, leaves: filteredLeaves });
  }
  return out;
}

type RowKind = 'group' | 'leaf';
interface RowDescriptor {
  kind: RowKind;
  groupId: string;
  leafId?: string;
  disabled?: boolean;
}

/**
 * Compose the flat sequence of focusable rows for keyboard navigation.
 * Group rows always appear; leaf rows only when their group is expanded.
 */
function buildRows<T>(
  filtered: TreeGroup<T>[],
  isExpanded: (id: string) => boolean,
  getDisabled: (leaf: TreeLeaf<T>) => boolean,
): RowDescriptor[] {
  const rows: RowDescriptor[] = [];
  for (const g of filtered) {
    rows.push({ kind: 'group', groupId: g.id });
    if (!isExpanded(g.id)) continue;
    for (const l of g.leaves) {
      rows.push({ kind: 'leaf', groupId: g.id, leafId: l.id, disabled: getDisabled(l) });
    }
  }
  return rows;
}

export function TreeSelect<T>({
  groups,
  selectedIds,
  onChange,
  searchValue,
  onSearchChange,
  expandedGroupIds,
  onExpandedChange,
  renderLeafRight,
  renderGroupRight,
  getLeafDisabled,
  getLeafDisabledReason,
  isLoading = false,
  emptyState,
  noResultsState,
  searchPlaceholder = 'Search…',
  ariaLabel = 'Tree multi-select',
  className,
  maxHeightClassName = 'max-h-[60vh]',
}: TreeSelectProps<T>) {
  const treeId = useId();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const isLeafDisabled = useCallback(
    (leaf: TreeLeaf<T>) => (getLeafDisabled ? getLeafDisabled(leaf) : false),
    [getLeafDisabled],
  );

  // Internal expansion state used when uncontrolled. Default: all groups
  // collapsed except when search is active (then everything expands so
  // matches are visible).
  const [internalExpanded, setInternalExpanded] = useState<string[]>([]);
  const expandedIds = expandedGroupIds ?? internalExpanded;
  const setExpandedIds = useCallback(
    (next: string[]) => {
      if (expandedGroupIds === undefined) setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [expandedGroupIds, onExpandedChange],
  );

  const filtered = useMemo(() => filterGroups(groups, searchValue), [groups, searchValue]);
  const isSearching = searchValue.trim().length > 0;

  const isExpanded = useCallback(
    (id: string) => isSearching || expandedIds.includes(id),
    [expandedIds, isSearching],
  );

  const toggleExpanded = useCallback(
    (id: string) => {
      // While searching the open/closed state is computed (everything
      // open), so flipping it would have no visible effect. Skip.
      if (isSearching) return;
      const next = expandedIds.includes(id)
        ? expandedIds.filter((g) => g !== id)
        : [...expandedIds, id];
      setExpandedIds(next);
    },
    [expandedIds, isSearching, setExpandedIds],
  );

  // Counts.
  const totalLeafCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.leaves.length, 0),
    [groups],
  );
  const visibleLeafIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of filtered) for (const l of g.leaves) ids.push(l.id);
    return ids;
  }, [filtered]);
  const visibleSelectedCount = useMemo(
    () => visibleLeafIds.reduce((n, id) => (selectedSet.has(id) ? n + 1 : n), 0),
    [visibleLeafIds, selectedSet],
  );

  // Toggle a single leaf. Uses the functional setter form so rapid
  // multi-clicks (faster than a React commit) correctly merge — the
  // literal-array form would let each closure see the same stale
  // `selectedIds` and only the last click would survive.
  const toggleLeaf = useCallback(
    (leafId: string) => {
      onChange((prev) =>
        prev.includes(leafId) ? prev.filter((id) => id !== leafId) : [...prev, leafId],
      );
    },
    [onChange],
  );

  // Toggle a group: if any visible-and-enabled leaf in the group is
  // unselected → select all visible-and-enabled; otherwise clear all
  // visible (selection of leaves outside the filter is preserved).
  const toggleGroup = useCallback(
    (groupId: string) => {
      const g = filtered.find((x) => x.id === groupId);
      if (!g) return;
      const visibleEnabled = g.leaves.filter((l) => !isLeafDisabled(l));
      if (visibleEnabled.length === 0) return;
      const visibleEnabledIds = visibleEnabled.map((l) => l.id);
      onChange((prev) => {
        const prevSet = new Set(prev);
        const allSelected = visibleEnabledIds.every((id) => prevSet.has(id));
        if (allSelected) {
          const removeIds = new Set(visibleEnabledIds);
          return prev.filter((id) => !removeIds.has(id));
        }
        const merged = new Set(prev);
        for (const id of visibleEnabledIds) merged.add(id);
        return Array.from(merged);
      });
    },
    [filtered, isLeafDisabled, onChange],
  );

  // Top-level: toggle every visible-and-enabled leaf across all filtered
  // groups. When search is active this is "Select visible" semantics.
  const toggleAllVisible = useCallback(() => {
    const visibleEnabledIds: string[] = [];
    for (const g of filtered) {
      for (const l of g.leaves) {
        if (!isLeafDisabled(l)) visibleEnabledIds.push(l.id);
      }
    }
    if (visibleEnabledIds.length === 0) return;
    onChange((prev) => {
      const prevSet = new Set(prev);
      const allSelected = visibleEnabledIds.every((id) => prevSet.has(id));
      if (allSelected) {
        const removeIds = new Set(visibleEnabledIds);
        return prev.filter((id) => !removeIds.has(id));
      }
      const merged = new Set(prev);
      for (const id of visibleEnabledIds) merged.add(id);
      return Array.from(merged);
    });
  }, [filtered, isLeafDisabled, onChange]);

  const clearAll = useCallback(() => onChange([]), [onChange]);

  // ── Keyboard navigation (roving tabindex) ─────────────────────
  const rows = useMemo(
    () => buildRows(filtered, isExpanded, isLeafDisabled),
    [filtered, isExpanded, isLeafDisabled],
  );

  // Identify the currently-focused row by index. Default to first row.
  const [focusIndex, setFocusIndex] = useState(0);

  // Clamp focus index when rows change (e.g. search narrows the list).
  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(Math.max(0, rows.length - 1));
  }, [rows.length, focusIndex]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusRowAt = useCallback((idx: number) => {
    setFocusIndex(idx);
    // Defer focus until React renders the new tabindex.
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-tree-row-index="${idx}"]`,
      );
      el?.focus();
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (rows.length === 0) return;
      const row = rows[focusIndex];
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (focusIndex + 1 < rows.length) focusRowAt(focusIndex + 1);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (focusIndex > 0) focusRowAt(focusIndex - 1);
          break;
        }
        case 'Home': {
          e.preventDefault();
          focusRowAt(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          focusRowAt(rows.length - 1);
          break;
        }
        case 'ArrowRight': {
          if (row.kind === 'group') {
            e.preventDefault();
            if (!isExpanded(row.groupId)) toggleExpanded(row.groupId);
          }
          break;
        }
        case 'ArrowLeft': {
          if (row.kind === 'group') {
            e.preventDefault();
            if (isExpanded(row.groupId) && !isSearching) toggleExpanded(row.groupId);
          } else if (row.kind === 'leaf') {
            // Move focus to the parent group row.
            e.preventDefault();
            const parentIdx = rows.findIndex(
              (r) => r.kind === 'group' && r.groupId === row.groupId,
            );
            if (parentIdx >= 0) focusRowAt(parentIdx);
          }
          break;
        }
        case ' ':
        case 'Spacebar': {
          e.preventDefault();
          if (row.kind === 'group') toggleGroup(row.groupId);
          else if (row.kind === 'leaf' && row.leafId && !row.disabled) toggleLeaf(row.leafId);
          break;
        }
        case 'Enter': {
          if (row.kind === 'group') {
            e.preventDefault();
            toggleExpanded(row.groupId);
          }
          break;
        }
        default:
          break;
      }
    },
    [focusIndex, rows, isExpanded, isSearching, toggleExpanded, toggleGroup, toggleLeaf],
  );

  // ── Render ─────────────────────────────────────────────────────
  const allVisibleSelected =
    visibleLeafIds.length > 0 && visibleLeafIds.every((id) => selectedSet.has(id));
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const selectAllLabel = isSearching
    ? allVisibleSelected
      ? `Clear ${visibleLeafIds.length} visible`
      : `Select ${visibleLeafIds.length} visible`
    : allVisibleSelected
      ? 'Clear all'
      : 'Select all';

  const showEmpty = !isLoading && groups.length === 0;
  const showNoResults = !isLoading && !showEmpty && filtered.length === 0;

  return (
    <div className={cn('flex flex-col gap-2', className)} aria-label={ariaLabel}>
      {/* Search */}
      <div className="relative">
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          icon={<Search className="h-4 w-4" />}
          aria-label="Filter tree"
          suffix={
            searchValue ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Clear search"
                onClick={() => onSearchChange('')}
                className="h-6 w-6 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Top header: select-all + counts */}
      <div className="flex items-center justify-between gap-2 px-1">
        <Checkbox
          checked={allVisibleSelected}
          indeterminate={someVisibleSelected}
          onChange={toggleAllVisible}
          label={
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              {selectAllLabel}
            </span>
          }
          disabled={visibleLeafIds.length === 0}
        />
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>
            {selectedIds.length} selected
            {isSearching && totalLeafCount > 0 ? ` of ${totalLeafCount}` : ''}
          </span>
          {selectedIds.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-auto px-1 py-0 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
            >
              Clear all selected
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        ref={containerRef}
        role="tree"
        aria-multiselectable="true"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={cn(
          'overflow-y-auto rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)]',
          maxHeightClassName,
        )}
      >
        {isLoading && (
          <div className="space-y-2 p-3" role="status" aria-live="polite">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded bg-[var(--surface-2)]"
                aria-hidden="true"
              />
            ))}
            <span className="sr-only">Loading…</span>
          </div>
        )}

        {showEmpty && (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            {emptyState ?? 'No items available.'}
          </div>
        )}

        {showNoResults && (
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            {noResultsState ?? `No matches for "${searchValue.trim()}".`}
          </div>
        )}

        {!isLoading && !showEmpty && !showNoResults && (
          <div className="py-1">
            {filtered.map((g) => {
              const visibleEnabledLeaves = g.leaves.filter((l) => !isLeafDisabled(l));
              const groupSelectedCount = g.leaves.reduce(
                (n, l) => (selectedSet.has(l.id) ? n + 1 : n),
                0,
              );
              const allGroupSelected =
                visibleEnabledLeaves.length > 0 &&
                visibleEnabledLeaves.every((l) => selectedSet.has(l.id));
              const someGroupSelected = groupSelectedCount > 0 && !allGroupSelected;
              const expanded = isExpanded(g.id);
              const groupRowIndex = rows.findIndex(
                (r) => r.kind === 'group' && r.groupId === g.id,
              );
              const isGroupFocused = groupRowIndex === focusIndex;

              return (
                <div key={g.id} role="none">
                  {/* Group header row */}
                  <div
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={expanded}
                    aria-checked={
                      allGroupSelected ? 'true' : someGroupSelected ? 'mixed' : 'false'
                    }
                    aria-label={`${g.label}, ${groupSelectedCount} of ${g.leaves.length} selected`}
                    tabIndex={isGroupFocused ? 0 : -1}
                    data-tree-row-index={groupRowIndex}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 cursor-pointer outline-none',
                      'hover:bg-[var(--surface-2)]',
                      'focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset',
                    )}
                    onClick={(e) => {
                      // Header click toggles expand; checkbox click is intercepted.
                      const target = e.target as HTMLElement;
                      if (target.closest('[data-tree-checkbox]')) return;
                      setFocusIndex(groupRowIndex);
                      toggleExpanded(g.id);
                    }}
                    onFocus={() => setFocusIndex(groupRowIndex)}
                  >
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </span>
                    <span data-tree-checkbox onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={allGroupSelected}
                        indeterminate={someGroupSelected}
                        onChange={() => toggleGroup(g.id)}
                        disabled={visibleEnabledLeaves.length === 0}
                        aria-label={`Toggle ${g.label}`}
                      />
                    </span>
                    <span className="flex-1 truncate text-sm text-[var(--text-primary)]">
                      {g.label}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--text-muted)]">
                      {groupSelectedCount}/{g.leaves.length}
                    </span>
                    {renderGroupRight && (
                      <span className="ml-1" onClick={(e) => e.stopPropagation()}>
                        {renderGroupRight(g)}
                      </span>
                    )}
                  </div>

                  {/* Leaves */}
                  {expanded && (
                    <div role="group" aria-label={`${g.label} leaves`}>
                      {g.leaves.map((leaf) => {
                        const leafSelected = selectedSet.has(leaf.id);
                        const leafDisabled = isLeafDisabled(leaf);
                        const leafRowIndex = rows.findIndex(
                          (r) => r.kind === 'leaf' && r.leafId === leaf.id,
                        );
                        const isLeafFocused = leafRowIndex === focusIndex;
                        const reason = leafDisabled
                          ? getLeafDisabledReason?.(leaf)
                          : undefined;

                        return (
                          <div
                            key={leaf.id}
                            role="treeitem"
                            aria-level={2}
                            aria-checked={leafSelected ? 'true' : 'false'}
                            aria-disabled={leafDisabled || undefined}
                            aria-label={
                              reason ? `${leaf.label} (${reason})` : leaf.label
                            }
                            tabIndex={isLeafFocused ? 0 : -1}
                            data-tree-row-index={leafRowIndex}
                            title={reason}
                            className={cn(
                              'flex items-center gap-2 pl-9 pr-2 py-1 outline-none',
                              !leafDisabled && 'cursor-pointer hover:bg-[var(--surface-2)]',
                              leafDisabled && 'opacity-50 cursor-not-allowed',
                              'focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset',
                            )}
                            onClick={() => {
                              setFocusIndex(leafRowIndex);
                              if (!leafDisabled) toggleLeaf(leaf.id);
                            }}
                            onFocus={() => setFocusIndex(leafRowIndex)}
                          >
                            <span
                              className="pointer-events-none"
                              aria-hidden="true"
                            >
                              <Checkbox
                                size="sm"
                                checked={leafSelected}
                                onChange={() => {}}
                                disabled={leafDisabled}
                                tabIndex={-1}
                              />
                            </span>
                            <span className="flex-1 truncate text-sm text-[var(--text-primary)]">
                              {leaf.label}
                            </span>
                            {renderLeafRight && (
                              <span className="ml-1 shrink-0">
                                {renderLeafRight(leaf)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* sr-only summary for screen readers */}
      <div className="sr-only" aria-live="polite" id={`${treeId}-summary`}>
        {selectedIds.length} selected of {totalLeafCount} total
        {isSearching ? `, ${visibleLeafIds.length} visible` : ''}
      </div>
    </div>
  );
}
