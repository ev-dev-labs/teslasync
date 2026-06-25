// Native parity port of web/src/components/forms/TreeSelect.tsx.
//
// Generic tri-state tree multi-select primitive. Two-level hierarchy
// (groups -> leaves) with tri-state group checkboxes (none / partial / all), a
// search filter that narrows the tree without flattening it, per-group
// `{selected}/{visible}` counts, controlled selection + expansion via props,
// optional renderLeafRight / renderGroupRight slots, per-leaf disabled state,
// and roving keyboard navigation. Selection is independent of the search
// filter: selected leaves stay selected when filtered out of view, and group /
// "Select visible" actions only ever affect currently-visible (filtered)
// leaves — matching the Grafana convention from the web source.
//
// The web a11y/selection contract is preserved as faithfully as the platform
// allows:
//   - role="tree" / aria-multiselectable -> a View carrying accessibilityRole
//     "list" whose group/leaf rows are focusable Pressables.
//   - role="treeitem" group rows keep aria-expanded -> accessibilityState
//     {expanded}; tri-state group selection moves onto the nested checkbox
//     Pressable (accessibilityState.checked: true | 'mixed' | false).
//   - role="treeitem" leaf rows -> Pressables with accessibilityRole
//     "checkbox" + accessibilityState {checked, disabled}; the disabled reason
//     rides along in accessibilityLabel + accessibilityHint (web title/aria).
//   - The sr-only summary keeps its aria-live="polite" semantics through the
//     native VisuallyHidden live region.
//   - Selection / expansion / counts / "Select visible" semantics are
//     identical: toggleLeaf, toggleGroup, toggleAllVisible, and clearAll all
//     use the functional onChange updater so rapid multi-toggles merge.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web roving-tabindex DOM focus management (tabIndex={0|-1} +
//     containerRef.querySelector + requestAnimationFrame el.focus()) is
//     browser-only. It is replaced by a state-driven focus model: each row is a
//     `focusable` Pressable whose onFocus updates the same focusIndex roving
//     state, and the focus ring follows focusIndex. focusRowAt therefore just
//     sets the index; the OS owns physical focus for the focusable rows.
//   - The web container `onKeyDown` switch is preserved verbatim in intent. The
//     pure-navigation keys (ArrowUp/ArrowDown/Home/End/ArrowLeft/ArrowRight)
//     are wired through the search TextInput.onKeyPress (the one key surface
//     core React Native types), the same precedent as the Combobox port. The
//     web Space/Enter "activate the focused row" cases map to the focused
//     Pressable's onPress (group row -> toggleExpanded, leaf row -> toggleLeaf,
//     group checkbox -> toggleGroup), which is exactly how Enter/Space activate
//     a focused Pressable on hardware-keyboard platforms.
//   - lucide-react ChevronDown / ChevronRight / Search / X (browser SVGs)
//     become small text glyphs; aria-hidden -> accessible={false}.
//   - The shared web @/components/ui Button / Checkbox / Input have no native
//     equivalents, so they are rebuilt inline from React Native primitives: the
//     Input becomes a bordered TextInput row, the Buttons become accessible
//     Pressables, and the tri-state Checkbox becomes a CheckboxIndicator View
//     with check (✓) / minus (−) glyphs.
//   - @/lib/cn + Tailwind utility classes become StyleSheet styles + theme
//     tokens; the `className` override is accepted-but-ignored for source
//     compatibility and mirrored by a native `style` prop, and the
//     `maxHeightClassName` (`max-h-[60vh]`) override is likewise kept-but-
//     ignored with a numeric `maxHeight` prop in its place.
//   - The web skeleton's `animate-pulse` has no StyleSheet analog, so the
//     loading body renders static placeholder bars plus the VisuallyHidden
//     "Loading…" label.
//
// No DOM, lucide-react, Recharts, Leaflet, or web UI component imports remain.

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {VisuallyHidden} from '../a11y/VisuallyHidden';

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
   * commits (tapping 3 boxes rapidly), otherwise each handler closes
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
  /** Web wrapper className retained for source compatibility; ignored on native. */
  className?: string;
  /** Web max-height className retained for source compatibility; ignored on native. */
  maxHeightClassName?: string;
  /** Native container style (RN equivalent of the web `className`). */
  style?: StyleProp<ViewStyle>;
  /** Native scroll-area max height (RN equivalent of `maxHeightClassName`). */
  maxHeight?: number;
}

const CHEVRON_DOWN_GLYPH = '\u25BE'; // ▾ — matches the lucide ChevronDown affordance.
const CHEVRON_RIGHT_GLYPH = '\u25B8'; // ▸ — matches the lucide ChevronRight affordance.
const SEARCH_GLYPH = '\u2315'; // ⌕ — matches the lucide Search affordance.
const CLEAR_GLYPH = '\u2715'; // ✕ — matches the lucide X affordance.
const CHECK_GLYPH = '\u2713'; // ✓ — matches the lucide Check affordance.
const INDETERMINATE_GLYPH = '\u2212'; // − — matches the lucide Minus affordance.

// Tailwind `max-h-[60vh]` has no fixed native analog; default the scroll area to
// a generous fixed height that callers can override via the `maxHeight` prop.
const DEFAULT_MAX_HEIGHT = 420;

/**
 * Filter `groups` by search needle (case-insensitive substring against
 * the leaf label). Groups whose label matches keep all their leaves;
 * otherwise only matching leaves are kept. Groups with zero matches are
 * dropped. Returns the original `groups` reference when no search is
 * active for cheap memo equality.
 */
function filterGroups<T>(groups: TreeGroup<T>[], needle: string): TreeGroup<T>[] {
  const q = needle.trim().toLowerCase();
  if (!q) {
    return groups;
  }
  const out: TreeGroup<T>[] = [];
  for (const g of groups) {
    const groupMatches = g.label.toLowerCase().includes(q);
    const filteredLeaves = groupMatches
      ? g.leaves
      : g.leaves.filter(l => l.label.toLowerCase().includes(q));
    if (filteredLeaves.length === 0) {
      continue;
    }
    out.push({...g, leaves: filteredLeaves});
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
    rows.push({kind: 'group', groupId: g.id});
    if (!isExpanded(g.id)) {
      continue;
    }
    for (const l of g.leaves) {
      rows.push({kind: 'leaf', groupId: g.id, leafId: l.id, disabled: getDisabled(l)});
    }
  }
  return rows;
}

type CheckedState = boolean | 'mixed';

interface CheckboxIndicatorProps {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

/**
 * Visual-only tri-state checkbox affordance — the native replacement for the
 * shared web `<Checkbox>` indicator. Interactivity is owned by the wrapping
 * Pressable / row so this stays a pure indicator (matches the web leaf
 * checkbox's `pointer-events-none` wrapper and the header checkbox indicator).
 */
function CheckboxIndicator({
  checked,
  indeterminate = false,
  disabled = false,
  size = 'md',
}: CheckboxIndicatorProps) {
  const active = checked || indeterminate;
  return (
    <View
      accessible={false}
      style={[
        styles.checkboxBase,
        size === 'sm' ? styles.checkboxSm : styles.checkboxMd,
        active && styles.checkboxActive,
        disabled && styles.checkboxDisabled,
      ]}>
      {active ? (
        <AppText accessible={false} style={styles.checkboxGlyph}>
          {indeterminate ? INDETERMINATE_GLYPH : CHECK_GLYPH}
        </AppText>
      ) : null}
    </View>
  );
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
  className: _className,
  maxHeightClassName: _maxHeightClassName,
  style,
  maxHeight = DEFAULT_MAX_HEIGHT,
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
      if (expandedGroupIds === undefined) {
        setInternalExpanded(next);
      }
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
      if (isSearching) {
        return;
      }
      const next = expandedIds.includes(id)
        ? expandedIds.filter(g => g !== id)
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
    for (const g of filtered) {
      for (const l of g.leaves) {
        ids.push(l.id);
      }
    }
    return ids;
  }, [filtered]);
  const visibleSelectedCount = useMemo(
    () => visibleLeafIds.reduce((n, id) => (selectedSet.has(id) ? n + 1 : n), 0),
    [visibleLeafIds, selectedSet],
  );

  // Toggle a single leaf. Uses the functional setter form so rapid
  // multi-taps (faster than a React commit) correctly merge — the
  // literal-array form would let each closure see the same stale
  // `selectedIds` and only the last tap would survive.
  const toggleLeaf = useCallback(
    (leafId: string) => {
      onChange(prev =>
        prev.includes(leafId) ? prev.filter(id => id !== leafId) : [...prev, leafId],
      );
    },
    [onChange],
  );

  // Toggle a group: if any visible-and-enabled leaf in the group is
  // unselected -> select all visible-and-enabled; otherwise clear all
  // visible (selection of leaves outside the filter is preserved).
  const toggleGroup = useCallback(
    (groupId: string) => {
      const g = filtered.find(x => x.id === groupId);
      if (!g) {
        return;
      }
      const visibleEnabled = g.leaves.filter(l => !isLeafDisabled(l));
      if (visibleEnabled.length === 0) {
        return;
      }
      const visibleEnabledIds = visibleEnabled.map(l => l.id);
      onChange(prev => {
        const prevSet = new Set(prev);
        const allSelected = visibleEnabledIds.every(id => prevSet.has(id));
        if (allSelected) {
          const removeIds = new Set(visibleEnabledIds);
          return prev.filter(id => !removeIds.has(id));
        }
        const merged = new Set(prev);
        for (const id of visibleEnabledIds) {
          merged.add(id);
        }
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
        if (!isLeafDisabled(l)) {
          visibleEnabledIds.push(l.id);
        }
      }
    }
    if (visibleEnabledIds.length === 0) {
      return;
    }
    onChange(prev => {
      const prevSet = new Set(prev);
      const allSelected = visibleEnabledIds.every(id => prevSet.has(id));
      if (allSelected) {
        const removeIds = new Set(visibleEnabledIds);
        return prev.filter(id => !removeIds.has(id));
      }
      const merged = new Set(prev);
      for (const id of visibleEnabledIds) {
        merged.add(id);
      }
      return Array.from(merged);
    });
  }, [filtered, isLeafDisabled, onChange]);

  const clearAll = useCallback(() => onChange([]), [onChange]);

  // ── Keyboard navigation (roving focus index) ──────────────────
  const rows = useMemo(
    () => buildRows(filtered, isExpanded, isLeafDisabled),
    [filtered, isExpanded, isLeafDisabled],
  );

  // Identify the currently-focused row by index. Default to first row.
  const [focusIndex, setFocusIndex] = useState(0);

  // Clamp focus index when rows change (e.g. search narrows the list).
  useEffect(() => {
    if (focusIndex >= rows.length) {
      setFocusIndex(Math.max(0, rows.length - 1));
    }
  }, [rows.length, focusIndex]);

  // Native replacement for the browser-only requestAnimationFrame +
  // containerRef.querySelector el.focus() roving-tabindex move: just set the
  // index. The `focusable` rows own physical focus; the ring follows focusIndex.
  const focusRowAt = useCallback((idx: number) => {
    setFocusIndex(idx);
  }, []);

  // Hardware-keyboard navigation for the platforms that surface key events
  // through TextInput.onKeyPress (RN-Windows / RN-macOS / RN-Web). The web
  // Space/Enter "activate the focused row" cases are delivered by the focused
  // row Pressable's onPress instead, so they are intentionally not intercepted
  // here (Space must keep typing into the search box).
  const handleSearchKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (rows.length === 0) {
        return;
      }
      const key = e.nativeEvent.key;
      const row = rows[focusIndex];
      switch (key) {
        case 'ArrowDown': {
          if (focusIndex + 1 < rows.length) {
            focusRowAt(focusIndex + 1);
          }
          return;
        }
        case 'ArrowUp': {
          if (focusIndex > 0) {
            focusRowAt(focusIndex - 1);
          }
          return;
        }
        case 'Home': {
          focusRowAt(0);
          return;
        }
        case 'End': {
          focusRowAt(rows.length - 1);
          return;
        }
        case 'ArrowRight': {
          if (row?.kind === 'group' && !isExpanded(row.groupId)) {
            toggleExpanded(row.groupId);
          }
          return;
        }
        case 'ArrowLeft': {
          if (row?.kind === 'group') {
            if (isExpanded(row.groupId) && !isSearching) {
              toggleExpanded(row.groupId);
            }
          } else if (row?.kind === 'leaf') {
            // Move focus to the parent group row.
            const parentIdx = rows.findIndex(
              r => r.kind === 'group' && r.groupId === row.groupId,
            );
            if (parentIdx >= 0) {
              focusRowAt(parentIdx);
            }
          }
          return;
        }
        default:
          return;
      }
    },
    [focusIndex, rows, isExpanded, isSearching, toggleExpanded, focusRowAt],
  );

  // ── Render ─────────────────────────────────────────────────────
  const allVisibleSelected =
    visibleLeafIds.length > 0 && visibleLeafIds.every(id => selectedSet.has(id));
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

  const emptyContent = emptyState ?? 'No items available.';
  const noResultsContent = noResultsState ?? `No matches for "${searchValue.trim()}".`;

  return (
    <View accessibilityLabel={ariaLabel} style={[styles.container, style]}>
      {/* Search */}
      <View style={styles.searchRow}>
        <AppText accessible={false} style={styles.searchGlyph} tone="muted">
          {SEARCH_GLYPH}
        </AppText>
        <TextInput
          accessibilityLabel="Filter tree"
          autoCapitalize="none"
          autoCorrect={false}
          nativeID={`${treeId}-search`}
          onChangeText={onSearchChange}
          onKeyPress={handleSearchKeyPress}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.textMuted}
          spellCheck={false}
          style={styles.searchInput}
          testID={`${treeId}-search`}
          value={searchValue}
        />
        {searchValue ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onSearchChange('')}
            style={styles.iconButton}>
            <AppText accessible={false} style={styles.iconGlyph} tone="muted">
              {CLEAR_GLYPH}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {/* Top header: select-all + counts */}
      <View style={styles.headerRow}>
        <Pressable
          accessibilityLabel={selectAllLabel}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: resolveChecked(allVisibleSelected, someVisibleSelected),
            disabled: visibleLeafIds.length === 0,
          }}
          disabled={visibleLeafIds.length === 0}
          hitSlop={4}
          onPress={toggleAllVisible}
          style={styles.selectAll}>
          <CheckboxIndicator
            checked={allVisibleSelected}
            disabled={visibleLeafIds.length === 0}
            indeterminate={someVisibleSelected}
          />
          <AppText style={styles.selectAllLabel} tone="secondary" variant="caption" weight="semibold">
            {selectAllLabel}
          </AppText>
        </Pressable>
        <View style={styles.counts}>
          <AppText style={styles.countsText} tone="muted" variant="caption">
            {selectedIds.length} selected
            {isSearching && totalLeafCount > 0 ? ` of ${totalLeafCount}` : ''}
          </AppText>
          {selectedIds.length > 0 ? (
            <Pressable
              accessibilityLabel="Clear all selected"
              accessibilityRole="button"
              hitSlop={4}
              onPress={clearAll}>
              <AppText style={styles.clearAllText} tone="secondary" variant="caption">
                Clear all selected
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Body */}
      <ScrollView
        accessibilityLabel={ariaLabel}
        accessibilityRole="list"
        bounces={false}
        keyboardShouldPersistTaps="handled"
        nativeID={`${treeId}-tree`}
        style={[styles.body, {maxHeight}]}>
        {isLoading ? (
          <View accessibilityRole="text" style={styles.skeletonWrap}>
            {Array.from({length: 4}).map((_, i) => (
              <View accessible={false} key={i} style={styles.skeletonBar} />
            ))}
            <VisuallyHidden>Loading…</VisuallyHidden>
          </View>
        ) : null}

        {showEmpty ? (
          <View style={styles.statePad}>
            {typeof emptyContent === 'string' ? (
              <AppText style={styles.stateText} tone="muted">
                {emptyContent}
              </AppText>
            ) : (
              emptyContent
            )}
          </View>
        ) : null}

        {showNoResults ? (
          <View style={styles.statePad}>
            {typeof noResultsContent === 'string' ? (
              <AppText style={styles.stateText} tone="muted">
                {noResultsContent}
              </AppText>
            ) : (
              noResultsContent
            )}
          </View>
        ) : null}

        {!isLoading && !showEmpty && !showNoResults ? (
          <View style={styles.treeBody}>
            {filtered.map(g => {
              const visibleEnabledLeaves = g.leaves.filter(l => !isLeafDisabled(l));
              const groupSelectedCount = g.leaves.reduce(
                (n, l) => (selectedSet.has(l.id) ? n + 1 : n),
                0,
              );
              const allGroupSelected =
                visibleEnabledLeaves.length > 0 &&
                visibleEnabledLeaves.every(l => selectedSet.has(l.id));
              const someGroupSelected = groupSelectedCount > 0 && !allGroupSelected;
              const expanded = isExpanded(g.id);
              const groupRowIndex = rows.findIndex(
                r => r.kind === 'group' && r.groupId === g.id,
              );
              const isGroupFocused = groupRowIndex === focusIndex;

              return (
                <View key={g.id}>
                  {/* Group header row */}
                  <Pressable
                    accessibilityLabel={`${g.label}, ${groupSelectedCount} of ${g.leaves.length} selected`}
                    accessibilityRole="button"
                    accessibilityState={{expanded}}
                    focusable
                    onFocus={() => setFocusIndex(groupRowIndex)}
                    onPress={() => {
                      setFocusIndex(groupRowIndex);
                      toggleExpanded(g.id);
                    }}
                    style={({pressed}) => [
                      styles.groupRow,
                      isGroupFocused && styles.rowFocused,
                      pressed && styles.rowPressed,
                    ]}>
                    <AppText accessible={false} style={styles.chevronGlyph} tone="muted">
                      {expanded ? CHEVRON_DOWN_GLYPH : CHEVRON_RIGHT_GLYPH}
                    </AppText>
                    <Pressable
                      accessibilityLabel={`Toggle ${g.label}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: resolveChecked(allGroupSelected, someGroupSelected),
                        disabled: visibleEnabledLeaves.length === 0,
                      }}
                      disabled={visibleEnabledLeaves.length === 0}
                      hitSlop={6}
                      onPress={() => toggleGroup(g.id)}>
                      <CheckboxIndicator
                        checked={allGroupSelected}
                        disabled={visibleEnabledLeaves.length === 0}
                        indeterminate={someGroupSelected}
                      />
                    </Pressable>
                    <AppText numberOfLines={1} style={styles.groupLabel}>
                      {g.label}
                    </AppText>
                    <AppText style={styles.groupCount} tone="muted" variant="caption">
                      {groupSelectedCount}/{g.leaves.length}
                    </AppText>
                    {renderGroupRight ? (
                      <View style={styles.rightSlot}>{renderGroupRight(g)}</View>
                    ) : null}
                  </Pressable>

                  {/* Leaves */}
                  {expanded ? (
                    <View accessibilityLabel={`${g.label} leaves`}>
                      {g.leaves.map(leaf => {
                        const leafSelected = selectedSet.has(leaf.id);
                        const leafDisabled = isLeafDisabled(leaf);
                        const leafRowIndex = rows.findIndex(
                          r => r.kind === 'leaf' && r.leafId === leaf.id,
                        );
                        const isLeafFocused = leafRowIndex === focusIndex;
                        const reason = leafDisabled
                          ? getLeafDisabledReason?.(leaf)
                          : undefined;

                        return (
                          <Pressable
                            accessibilityHint={reason}
                            accessibilityLabel={reason ? `${leaf.label} (${reason})` : leaf.label}
                            accessibilityRole="checkbox"
                            accessibilityState={{checked: leafSelected, disabled: leafDisabled}}
                            disabled={leafDisabled}
                            focusable={!leafDisabled}
                            key={leaf.id}
                            onFocus={() => setFocusIndex(leafRowIndex)}
                            onPress={() => {
                              setFocusIndex(leafRowIndex);
                              if (!leafDisabled) {
                                toggleLeaf(leaf.id);
                              }
                            }}
                            style={({pressed}) => [
                              styles.leafRow,
                              isLeafFocused && styles.rowFocused,
                              leafDisabled && styles.leafRowDisabled,
                              pressed && !leafDisabled && styles.rowPressed,
                            ]}>
                            <CheckboxIndicator
                              checked={leafSelected}
                              disabled={leafDisabled}
                              size="sm"
                            />
                            <AppText numberOfLines={1} style={styles.leafLabel}>
                              {leaf.label}
                            </AppText>
                            {renderLeafRight ? (
                              <View style={styles.leafRightSlot}>{renderLeafRight(leaf)}</View>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      {/* sr-only summary for screen readers */}
      <VisuallyHidden as="div" id={`${treeId}-summary`} liveRegion priority="polite">
        {selectedIds.length} selected of {totalLeafCount} total
        {isSearching ? `, ${visibleLeafIds.length} visible` : ''}
      </VisuallyHidden>
    </View>
  );
}

/** Map the web tri-state aria-checked (`'true' | 'mixed' | 'false'`) to RN's accessibilityState.checked. */
function resolveChecked(allSelected: boolean, someSelected: boolean): CheckedState {
  if (allSelected) {
    return true;
  }
  if (someSelected) {
    return 'mixed';
  }
  return false;
}

TreeSelect.displayName = 'TreeSelect';

const styles = StyleSheet.create({
  body: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
  },
  checkboxActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  checkboxBase: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: 'center',
  },
  checkboxDisabled: {
    opacity: 0.5,
  },
  checkboxGlyph: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  checkboxMd: {
    height: 16,
    width: 16,
  },
  checkboxSm: {
    height: 14,
    width: 14,
  },
  chevronGlyph: {
    fontSize: 12,
    width: 14,
  },
  clearAllText: {
    textDecorationLine: 'underline',
  },
  container: {
    gap: 8,
  },
  counts: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  countsText: {
    fontSize: 12,
  },
  groupCount: {
    fontVariant: ['tabular-nums'],
  },
  groupLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  groupRow: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 4,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  iconGlyph: {
    fontSize: 13,
  },
  leafLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  leafRightSlot: {
    flexShrink: 0,
    marginLeft: 4,
  },
  leafRow: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 36,
    paddingRight: 8,
    paddingVertical: 4,
  },
  leafRowDisabled: {
    opacity: 0.5,
  },
  rightSlot: {
    marginLeft: 4,
  },
  rowFocused: {
    borderColor: colors.accent,
  },
  rowPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  searchGlyph: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  selectAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  selectAllLabel: {
    fontSize: 12,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    height: 24,
  },
  skeletonWrap: {
    gap: 8,
    padding: 12,
  },
  statePad: {
    padding: 24,
  },
  stateText: {
    fontSize: 14,
    textAlign: 'center',
  },
  treeBody: {
    paddingVertical: 4,
  },
});

export default TreeSelect;
