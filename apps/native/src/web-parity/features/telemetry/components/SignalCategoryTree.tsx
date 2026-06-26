// Native parity port of web/src/features/telemetry/components/SignalCategoryTree.tsx.
//
// SignalCategoryTree is a categorized signal picker: it pulls the vehicle's
// available-signal catalog (useAvailableSignals -> /signals/{vehicleID}/available),
// groups the descriptors by `category`, applies friendly category labels, sorts
// leaves alphabetically and groups by a fixed display order, then feeds each leaf
// a lazy sparkline preview that only fetches once its category is expanded (or a
// search is active, which auto-expands every matching group).
//
// The web source pulls two app modules that have no native parity surface yet
// (rule 4/7), so native-safe implementations are built in-file:
//   - `TreeSelect` (+ the `TreeGroup` type) from @/components/forms is a 611-line
//     DOM-only generic primitive (shared <Input>/<Button>/<Checkbox>, lucide
//     icons, a WAI-ARIA `role="tree"` with roving-tabindex keyboard navigation,
//     and an aria-live sr-only summary). It is not yet ported to native, so the
//     exact subset SignalCategoryTree exercises is reproduced as a private
//     `TreeSelectView` built from React Native primitives: the controlled search
//     filter (filterGroups), controlled per-group expansion, the tri-state
//     group + "select all visible" checkboxes, the `{selected}/{visible}` counts,
//     per-leaf selection via the functional-updater onChange, the loading /
//     empty / no-results states, and the `renderLeafRight` slot. The local
//     `TreeGroup`/`TreeLeaf` types mirror the web shapes byte-for-byte. The
//     roving-tabindex keyboard navigation, the `role="tree"`/`treeitem`
//     semantics, and the aria-live summary are DOM-only and collapse to native
//     accessibilityRole/accessibilityState (documented in the sidecar as the
//     explicit unavailable state).
//   - `SignalSparklinePreview` (the ./SignalSparklinePreview sibling) is also not
//     yet ported, so its identical logic is inlined: it owns its own
//     `useSignalHistory` query (last-hour, 30-sample) gated by `enabled`, coerces
//     numeric/bool envelopes to a number[], renders the shared native `Sparkline`
//     for numeric kinds, a `(kind)` chip for non-numeric kinds, a pulse while
//     loading, and an em-dash when there are <2 samples.
//
// Icon/DOM mappings: lucide ChevronDown/ChevronRight -> decorative text chevrons
// (▾/▸); lucide Search -> a decorative View-drawn magnifier (ring + handle);
// lucide X -> a decorative '×' clear glyph; the shared <Checkbox> -> a View-drawn
// box (accent fill + ✓ when checked, an accent dash when indeterminate). The `cn`
// Tailwind merger / CSS theme vars map to StyleSheet literals (--surface-1/40,
// --surface-2 #151621, --glass-border, --text-primary/secondary/muted, the cyan
// accent). `className` and `maxHeightClassName` are kept on props for source
// compatibility but ignored on native; a numeric `maxHeight` (defaulting to ~60vh
// via useWindowDimensions, mirroring max-h-[60vh]) and a `style` override are
// added for native consumers. The source carries no i18n (plain English
// literals), so every user-facing string is preserved verbatim.

import React, {useCallback, useMemo} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {Sparkline} from '../../../components/charts';
import {
  useAvailableSignals,
  useSignalHistory,
} from '../../../api/hooks/useSignals';
import type {SignalDescriptor, SignalEnvelope, SignalKind} from '../../../api/types';

/** Closed set of routing categories shipped by `internal/tesla/protomodel`. */
const CATEGORY_LABELS: Record<string, string> = {
  charging: 'Charging',
  driving: 'Driving',
  climate: 'Climate',
  location: 'Location',
  powertrain: 'Powertrain',
  vehicle_state: 'Vehicle State',
  safety_security: 'Safety & Security',
  media: 'Media',
  config: 'Config',
  prefs: 'Preferences',
  setting_unit: 'Setting Units',
  metadata: 'Metadata',
};

/** Stable display order. Unknown categories sort last alphabetically. */
const CATEGORY_ORDER = [
  'charging',
  'driving',
  'powertrain',
  'climate',
  'location',
  'vehicle_state',
  'safety_security',
  'media',
  'config',
  'prefs',
  'setting_unit',
  'metadata',
];

function categoryRank(id: string): number {
  const idx = CATEGORY_ORDER.indexOf(id);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function friendlyCategoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id;
}

// ── Generic tree shapes (mirrors web @/components/forms TreeSelect) ──────────
interface TreeLeaf<T> {
  id: string;
  label: string;
  data: T;
}

interface TreeGroup<T> {
  id: string;
  label: string;
  leaves: TreeLeaf<T>[];
}

export interface SignalCategoryTreeProps {
  vehicleId: number;
  selectedSignals: string[];
  onChange: (next: string[] | ((prev: string[]) => string[])) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  expandedGroupIds: string[];
  onExpandedChange: (next: string[]) => void;
  /** Disable sparklines (e.g. when many signals are selected and sparkline fetches would be wasteful). */
  showSparklines?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Web Tailwind max-height override retained for source compatibility; ignored on native. */
  maxHeightClassName?: string;
  /** Native-only: numeric max scroll height (defaults to ~60vh, mirroring max-h-[60vh]). */
  maxHeight?: number;
  /** Native-only style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
}

export function SignalCategoryTree({
  vehicleId,
  selectedSignals,
  onChange,
  searchValue,
  onSearchChange,
  expandedGroupIds,
  onExpandedChange,
  showSparklines = true,
  className: _className,
  maxHeightClassName: _maxHeightClassName,
  maxHeight,
  style,
}: SignalCategoryTreeProps) {
  const {height: windowHeight} = useWindowDimensions();
  const query = useAvailableSignals(vehicleId);

  const groups = useMemo<TreeGroup<SignalDescriptor>[]>(() => {
    const signals = query.data?.signals ?? [];
    if (signals.length === 0) return [];
    const byCat = new Map<string, SignalDescriptor[]>();
    for (const s of signals) {
      const list = byCat.get(s.category) ?? [];
      list.push(s);
      byCat.set(s.category, list);
    }
    const out: TreeGroup<SignalDescriptor>[] = [];
    for (const [cat, list] of byCat) {
      // Sort leaves alphabetically within each category for predictable
      // display (matches the backend's own SignalsByName ordering).
      list.sort((a, b) => a.name.localeCompare(b.name));
      out.push({
        id: cat,
        label: friendlyCategoryLabel(cat),
        leaves: list.map(s => ({id: s.name, label: s.name, data: s})),
      });
    }
    out.sort((a, b) => {
      const ra = categoryRank(a.id);
      const rb = categoryRank(b.id);
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });
    return out;
  }, [query.data]);

  // Per-group expansion drives the sparkline lazy-fetch.
  const expandedSet = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);
  const isSearching = searchValue.trim().length > 0;

  // mirrors the web `max-h-[60vh]` default — bounds the scroll area to 60% of
  // the viewport height (native consumers may override with `maxHeight`).
  const resolvedMaxHeight = maxHeight ?? Math.round(windowHeight * 0.6);

  return (
    <TreeSelectView<SignalDescriptor>
      groups={groups}
      selectedIds={selectedSignals}
      onChange={onChange}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      expandedGroupIds={expandedGroupIds}
      onExpandedChange={onExpandedChange}
      isLoading={query.isLoading}
      ariaLabel="Signal catalog"
      searchPlaceholder="Search signals…"
      emptyState={
        query.isError
          ? `Failed to load catalog: ${
              (query.error as Error)?.message ?? 'unknown error'
            }`
          : 'No signals available for this vehicle.'
      }
      maxHeight={resolvedMaxHeight}
      style={style}
      renderLeafRight={
        showSparklines
          ? leaf => {
              const groupId = leaf.data.category;
              // Sparkline fetches only when the group is expanded
              // (or the user is searching, which auto-expands all
              // matching groups in TreeSelectView).
              const enabled = isSearching || expandedSet.has(groupId);
              return (
                <SignalSparklinePreview
                  vehicleId={vehicleId}
                  signal={leaf.id}
                  valueKind={leaf.data.value_kind}
                  enabled={enabled}
                />
              );
            }
          : undefined
      }
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SignalSparklinePreview — last-hour mini-trend for one signal (inlined native
// parity of ./SignalSparklinePreview; owns its own gated useSignalHistory query).
// ───────────────────────────────────────────────────────────────────────────

const SPARKLINE_LIMIT = 30;
const SPARKLINE_HOURS = 1;

function envelopesToNumbers(data: SignalEnvelope[]): number[] {
  const out: number[] = [];
  for (const e of data) {
    const v = e.value;
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
  }
  return out;
}

const NON_NUMERIC: ReadonlySet<SignalKind> = new Set<SignalKind>([
  'string',
  'unknown',
  'time',
]);

interface SignalSparklinePreviewProps {
  vehicleId: number;
  signal: string;
  valueKind: SignalKind;
  /** Gates the underlying fetch. Parent flips on per-leaf as a group expands. */
  enabled: boolean;
  /** Sparkline color (defaults to teal accent). */
  color?: string;
  /** Sparkline width (px). */
  width?: number;
  /** Sparkline height (px). */
  height?: number;
}

function SignalSparklinePreview({
  vehicleId,
  signal,
  valueKind,
  enabled,
  color = '#22d3ee',
  width = 80,
  height = 18,
}: SignalSparklinePreviewProps) {
  const isNumeric = !NON_NUMERIC.has(valueKind);
  const query = useSignalHistory(vehicleId, signal, {
    hours: SPARKLINE_HOURS,
    limit: SPARKLINE_LIMIT,
  });
  // The hook itself is unconditional (rules-of-hooks); we gate the render until
  // enabled+numeric and lean on tanstack-query's caching. The hook's built-in
  // `enabled` keys off vehicleId+signal, so we add our own short-circuit here.
  const numericSeries = useMemo(
    () => (query.data?.data ? envelopesToNumbers(query.data.data) : []),
    [query.data],
  );

  if (!enabled) return null;

  if (!isNumeric) {
    return (
      <View
        accessibilityLabel={`Non-numeric signal (${valueKind})`}
        style={styles.kindChip}>
        <AppText style={styles.kindChipText}>{valueKind}</AppText>
      </View>
    );
  }

  if (query.isLoading) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.sparkLoading, {width, height}]}
      />
    );
  }

  if (numericSeries.length < 2) {
    return (
      <AppText
        accessibilityLabel="No samples in last hour"
        style={styles.sparkDash}>
        —
      </AppText>
    );
  }

  return (
    <Sparkline data={numericSeries} color={color} width={width} height={height} />
  );
}

// ───────────────────────────────────────────────────────────────────────────
// TreeSelectView — native parity of the @/components/forms TreeSelect subset
// SignalCategoryTree uses (controlled selection / search / expansion).
// ───────────────────────────────────────────────────────────────────────────

interface TreeSelectViewProps<T> {
  groups: TreeGroup<T>[];
  selectedIds: string[];
  onChange: (next: string[] | ((prev: string[]) => string[])) => void;
  searchValue: string;
  onSearchChange: (next: string) => void;
  expandedGroupIds: string[];
  onExpandedChange: (next: string[]) => void;
  renderLeafRight?: (leaf: TreeLeaf<T>) => React.ReactNode;
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  noResultsState?: React.ReactNode;
  searchPlaceholder?: string;
  ariaLabel?: string;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Filter `groups` by search needle (case-insensitive substring against the leaf
 * label). Groups whose label matches keep all their leaves; otherwise only
 * matching leaves are kept. Groups with zero matches are dropped.
 */
function filterGroups<T>(groups: TreeGroup<T>[], needle: string): TreeGroup<T>[] {
  const q = needle.trim().toLowerCase();
  if (!q) return groups;
  const out: TreeGroup<T>[] = [];
  for (const g of groups) {
    const groupMatches = g.label.toLowerCase().includes(q);
    const filteredLeaves = groupMatches
      ? g.leaves
      : g.leaves.filter(l => l.label.toLowerCase().includes(q));
    if (filteredLeaves.length === 0) continue;
    out.push({...g, leaves: filteredLeaves});
  }
  return out;
}

function TreeSelectView<T>({
  groups,
  selectedIds,
  onChange,
  searchValue,
  onSearchChange,
  expandedGroupIds,
  onExpandedChange,
  renderLeafRight,
  isLoading = false,
  emptyState,
  noResultsState,
  searchPlaceholder = 'Search…',
  ariaLabel = 'Tree multi-select',
  maxHeight,
  style,
}: TreeSelectViewProps<T>) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(
    () => filterGroups(groups, searchValue),
    [groups, searchValue],
  );
  // During search everything expands so matches are visible.
  const isSearching = searchValue.trim().length > 0;
  const isExpanded = useCallback(
    (id: string) => isSearching || expandedGroupIds.includes(id),
    [expandedGroupIds, isSearching],
  );

  const toggleExpanded = useCallback(
    (id: string) => {
      // While searching the open/closed state is computed (everything open),
      // so flipping it would have no visible effect. Skip.
      if (isSearching) return;
      const next = expandedGroupIds.includes(id)
        ? expandedGroupIds.filter(g => g !== id)
        : [...expandedGroupIds, id];
      onExpandedChange(next);
    },
    [expandedGroupIds, isSearching, onExpandedChange],
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

  // Functional-updater form so rapid multi-taps correctly merge.
  const toggleLeaf = useCallback(
    (leafId: string) => {
      onChange(prev =>
        prev.includes(leafId)
          ? prev.filter(id => id !== leafId)
          : [...prev, leafId],
      );
    },
    [onChange],
  );

  // Toggle a group: select all visible leaves when any is unselected, otherwise
  // clear all visible (selection outside the filter is preserved).
  const toggleGroup = useCallback(
    (groupId: string) => {
      const g = filtered.find(x => x.id === groupId);
      if (!g) return;
      const visibleEnabledIds = g.leaves.map(l => l.id);
      if (visibleEnabledIds.length === 0) return;
      onChange(prev => {
        const prevSet = new Set(prev);
        const allSelected = visibleEnabledIds.every(id => prevSet.has(id));
        if (allSelected) {
          const removeIds = new Set(visibleEnabledIds);
          return prev.filter(id => !removeIds.has(id));
        }
        const merged = new Set(prev);
        for (const id of visibleEnabledIds) merged.add(id);
        return Array.from(merged);
      });
    },
    [filtered, onChange],
  );

  // Top-level "Select visible" toggle across all filtered groups.
  const toggleAllVisible = useCallback(() => {
    const visibleEnabledIds: string[] = [];
    for (const g of filtered) for (const l of g.leaves) visibleEnabledIds.push(l.id);
    if (visibleEnabledIds.length === 0) return;
    onChange(prev => {
      const prevSet = new Set(prev);
      const allSelected = visibleEnabledIds.every(id => prevSet.has(id));
      if (allSelected) {
        const removeIds = new Set(visibleEnabledIds);
        return prev.filter(id => !removeIds.has(id));
      }
      const merged = new Set(prev);
      for (const id of visibleEnabledIds) merged.add(id);
      return Array.from(merged);
    });
  }, [filtered, onChange]);

  const clearAll = useCallback(() => onChange([]), [onChange]);

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

  return (
    <View accessibilityLabel={ariaLabel} style={[styles.root, style]}>
      {/* Search */}
      <View style={styles.searchShell}>
        <View pointerEvents="none" style={styles.magnifier}>
          <View style={styles.magnifierRing} />
          <View style={styles.magnifierHandle} />
        </View>
        <TextInput
          accessibilityLabel="Filter tree"
          onChangeText={onSearchChange}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          value={searchValue}
        />
        {searchValue ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => onSearchChange('')}
            style={styles.clearBtn}>
            <AppText style={styles.clearGlyph}>×</AppText>
          </Pressable>
        ) : null}
      </View>

      {/* Top header: select-all + counts */}
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={selectAllLabel}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: allVisibleSelected,
            disabled: visibleLeafIds.length === 0,
          }}
          disabled={visibleLeafIds.length === 0}
          onPress={toggleAllVisible}
          style={styles.selectAll}>
          <CheckBox
            checked={allVisibleSelected}
            disabled={visibleLeafIds.length === 0}
            indeterminate={someVisibleSelected}
          />
          <AppText style={styles.selectAllLabel}>{selectAllLabel}</AppText>
        </Pressable>
        <View style={styles.headerRight}>
          <AppText style={styles.countText}>
            {selectedIds.length} selected
            {isSearching && totalLeafCount > 0 ? ` of ${totalLeafCount}` : ''}
          </AppText>
          {selectedIds.length > 0 ? (
            <Pressable
              accessibilityLabel="Clear all selected"
              accessibilityRole="button"
              onPress={clearAll}>
              <AppText style={styles.clearAllText}>Clear all selected</AppText>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Body */}
      <ScrollView
        accessibilityLabel={ariaLabel}
        nestedScrollEnabled
        style={[styles.body, maxHeight ? {maxHeight} : null]}>
        {isLoading ? (
          <View accessibilityLabel="Loading…" style={styles.loadingWrap}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={styles.skeletonRow} />
            ))}
          </View>
        ) : showEmpty ? (
          <Placeholder
            fallback="No items available."
            node={emptyState}
          />
        ) : showNoResults ? (
          <Placeholder
            fallback={`No matches for "${searchValue.trim()}".`}
            node={noResultsState}
          />
        ) : (
          <View style={styles.treeBody}>
            {filtered.map(g => {
              const groupSelectedCount = g.leaves.reduce(
                (n, l) => (selectedSet.has(l.id) ? n + 1 : n),
                0,
              );
              const allGroupSelected =
                g.leaves.length > 0 && g.leaves.every(l => selectedSet.has(l.id));
              const someGroupSelected =
                groupSelectedCount > 0 && !allGroupSelected;
              const expanded = isExpanded(g.id);

              return (
                <View key={g.id}>
                  {/* Group header row — tap toggles expand; checkbox toggles select */}
                  <Pressable
                    accessibilityLabel={`${g.label}, ${groupSelectedCount} of ${g.leaves.length} selected`}
                    accessibilityRole="button"
                    accessibilityState={{expanded}}
                    onPress={() => toggleExpanded(g.id)}
                    style={({pressed}) => [
                      styles.groupRow,
                      pressed && styles.rowPressed,
                    ]}>
                    <AppText style={styles.chevron}>
                      {expanded ? '▾' : '▸'}
                    </AppText>
                    <Pressable
                      accessibilityLabel={`Toggle ${g.label}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: allGroupSelected,
                        disabled: g.leaves.length === 0,
                      }}
                      disabled={g.leaves.length === 0}
                      hitSlop={6}
                      onPress={() => toggleGroup(g.id)}>
                      <CheckBox
                        checked={allGroupSelected}
                        disabled={g.leaves.length === 0}
                        indeterminate={someGroupSelected}
                      />
                    </Pressable>
                    <AppText numberOfLines={1} style={styles.groupLabel}>
                      {g.label}
                    </AppText>
                    <AppText style={styles.groupCount}>
                      {groupSelectedCount}/{g.leaves.length}
                    </AppText>
                  </Pressable>

                  {/* Leaves */}
                  {expanded ? (
                    <View>
                      {g.leaves.map(leaf => {
                        const leafSelected = selectedSet.has(leaf.id);
                        return (
                          <Pressable
                            accessibilityLabel={leaf.label}
                            accessibilityRole="checkbox"
                            accessibilityState={{checked: leafSelected}}
                            key={leaf.id}
                            onPress={() => toggleLeaf(leaf.id)}
                            style={({pressed}) => [
                              styles.leafRow,
                              pressed && styles.rowPressed,
                            ]}>
                            <CheckBox checked={leafSelected} />
                            <AppText numberOfLines={1} style={styles.leafLabel}>
                              {leaf.label}
                            </AppText>
                            {renderLeafRight ? (
                              <View style={styles.leafRight}>
                                {renderLeafRight(leaf)}
                              </View>
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
        )}
      </ScrollView>
    </View>
  );
}

/** Centered empty / no-results message (string fallback or a custom node). */
function Placeholder({
  node,
  fallback,
}: {
  node?: React.ReactNode;
  fallback: string;
}) {
  return (
    <View style={styles.placeholder}>
      {node == null || typeof node === 'string' ? (
        <AppText style={styles.placeholderText}>
          {(node as string) ?? fallback}
        </AppText>
      ) : (
        node
      )}
    </View>
  );
}

/** View-drawn tri-state checkbox (replaces the shared web <Checkbox>). */
function CheckBox({
  checked,
  indeterminate = false,
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
}) {
  const filled = checked || indeterminate;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.checkbox,
        filled && styles.checkboxFilled,
        disabled && styles.checkboxDisabled,
      ]}>
      {checked ? (
        <AppText style={styles.checkGlyph}>✓</AppText>
      ) : indeterminate ? (
        <View style={styles.checkDash} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'column',
    gap: 8, // gap-2
  },
  // Search shell (mirrors the shared <Input>: rounded-md, border, --surface-1).
  searchShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(14, 23, 39, 0.4)', // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 38,
    paddingHorizontal: 10,
  },
  magnifier: {
    height: 14,
    width: 14,
  },
  magnifierRing: {
    borderColor: colors.textMuted,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 10,
    width: 10,
  },
  magnifierHandle: {
    backgroundColor: colors.textMuted,
    borderRadius: 1,
    bottom: 0,
    height: 1.5,
    position: 'absolute',
    right: 0,
    transform: [{rotate: '45deg'}],
    width: 5,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14, // text-sm
    paddingVertical: 0,
  },
  clearBtn: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  clearGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 20,
  },
  // Header row.
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 4, // px-1
  },
  selectAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  selectAllLabel: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    fontWeight: '500',
    lineHeight: 16,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12, // gap-3
  },
  countText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  clearAllText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    textDecorationLine: 'underline',
  },
  // Body scroll area (rounded-md, border, --surface-1).
  body: {
    backgroundColor: 'rgba(14, 23, 39, 0.4)',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
  },
  loadingWrap: {
    gap: 8,
    padding: 12,
  },
  skeletonRow: {
    backgroundColor: '#151621', // --surface-2
    borderRadius: 4,
    height: 24, // h-6
  },
  placeholder: {
    alignItems: 'center',
    padding: 24, // p-6
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
    lineHeight: 20,
    textAlign: 'center',
  },
  treeBody: {
    paddingVertical: 4, // py-1
  },
  groupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8, // px-2
    paddingVertical: 6, // py-1.5
  },
  rowPressed: {
    backgroundColor: '#151621', // hover:bg-[var(--surface-2)]
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    width: 14,
  },
  groupLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  groupCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  leafRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 36, // pl-9
    paddingRight: 8, // pr-2
    paddingVertical: 4, // py-1
  },
  leafLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  leafRight: {
    flexShrink: 0,
    marginLeft: 4, // ml-1
  },
  // Tri-state checkbox glyph.
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 3,
    borderWidth: 1.5,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  checkboxFilled: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  checkboxDisabled: {
    opacity: 0.4,
  },
  checkGlyph: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  checkDash: {
    backgroundColor: colors.accent,
    borderRadius: 1,
    height: 2,
    width: 8,
  },
  // Sparkline preview slots.
  kindChip: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kindChipText: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.5,
    lineHeight: 12,
    textTransform: 'uppercase',
  },
  sparkLoading: {
    backgroundColor: '#151621', // --surface-2
    borderRadius: 4,
  },
  sparkDash: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
  },
});
