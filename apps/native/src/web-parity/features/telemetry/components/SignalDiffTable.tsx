// Native parity port of
// web/src/features/telemetry/components/SignalDiffTable.tsx.
//
// The web SignalDiffTable wraps the shared `<DataTable virtualized>` with the
// power-user columns asked for during incidents: a Pin column, a coloured Δ
// (numeric difference + percent change), and an L1/L2/LOG/STALE source-layer
// badge per window. It is selection-enabled (multi) so the page can drive bulk
// actions, and it pre-sorts pinned signals to the top.
//
// React Native has none of the web building blocks this file leans on — no DOM
// `<div>`/`<span>`, no Tailwind/`@/lib/cn`, no react-i18next, no lucide SVGs,
// and (yet) no converted native `DataTable` / `PinButton` / `SourceLayerBadge`
// shared components. The contract is reproduced with RN primitives + the
// already-ported shared native pieces, following the established idioms:
//   - The web shared `<DataTable>` (web L3) -> an inline generic <DataTable<T>>:
//     a horizontally-scrollable fixed-width grid (so all eight diagnostic
//     columns stay readable on a phone) with a sticky header outside the scroll
//     area, a FlatList body honouring `virtualized` + `rowHeight` (getItemLayout)
//     + `maxHeight`, press-to-sort on `sortable` columns, and a multi-select
//     checkbox column driven by `selectedKeys` + `onSelectionChange`. The same
//     idiom as the BackendStatusSection inline DataTable, extended with the
//     selection + virtualization props this caller uses. `tableId`/`stickyHeader`/
//     `compact` are accepted and fold into native layout.
//   - The web `PinButton` (web L3, item_type='widget') -> an inline <PinButton>
//     that calls the UNCHANGED native usePinned/useTogglePin hooks, so the
//     /pinned API path, the `signal:{name}` item_id, and the
//     `signal-diff:vehicle:{N}` context are preserved verbatim. lucide Pin/PinOff
//     have no native analog and no universally-available monochrome pin glyph
//     exists, so the toggle is drawn as a filled/outline star (U+2605/U+2606)
//     carrying the SAME amber-pinned / muted-unpinned colour treatment as web —
//     shape + colour both signal the pinned state.
//   - The web `SourceLayerBadge` + `SignalSource` (web L4) -> an inline
//     <SourceLayerBadge>: a tinted L1/L2/LOG/STALE/— pill (the Tailwind tints
//     resolved to literal rgba). The web hover `<Tooltip>` description (+ age)
//     becomes the pill's accessibilityLabel (the FreshnessIndicator
//     title->a11y-label idiom), preserving every sourceLayer.* i18n key.
//   - `<HelpTooltip>` (web L3) -> the already-converted shared native HelpTooltip
//     (same i18nKey/defaultValue/ariaLabel/size props), used verbatim for the
//     legend "?" affordances.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next `useTranslation` (web L2) has no native wiring, so a local
//     `useT()` shim returns the English defaultValue — supporting BOTH web call
//     styles, t('k','Default') and t('k',{defaultValue:'…'}) — and every web key
//     (signalDiff.*, help.signal.*, pin.*, sourceLayer.*) is preserved.
//   - `fmtNumber` (web @/lib/numberFormat, L5) is inlined native-safe: safeNumber
//     (0 for nullish/non-finite) -> toFixed(decimals, default 2 = the web global
//     precision) -> en-US thousands grouping, locale-independent so it never
//     depends on Hermes Intl (the BackendStatusSection idiom).
//   - `cn` (web L6) is dropped — className merges resolve to RN style arrays. The
//     per-column Tailwind `className` (w-10/w-16/w-28 widths, text-right/
//     text-center alignment) is parsed best-effort into fixed cell widths +
//     alignment; the optional page-level `className` (web L36) is accepted-but-
//     ignored for source compatibility and mirrored by a native `style` prop.
//
// State names (sortedRows, columns, emptyMessage), the SignalDiffRow API shape,
// every i18n key/copy, the pinned-first sort, the Δ numeric/changed/none logic,
// and the column set + order are preserved. No DOM, Recharts, Leaflet,
// lucide-react, react-i18next, @/lib/cn, or old web ui components are imported.

import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {Checkbox} from '../../../components/ui/Checkbox';
import {HelpTooltip} from '../../../components/ui/HelpTooltip';
import {
  usePinned,
  useTogglePin,
  type PinnedItemType,
} from '../../../api/hooks/usePinned';
import type {
  SignalDiffRow,
  SignalSourceLayer,
} from '../../../api/hooks/useTelemetry';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired in native. This shim returns the supplied English
// default, supporting both web call styles: t('key', 'Default') and
// t('key', { defaultValue: '…' }). Every web i18n key + copy is preserved.
type TVars = {defaultValue?: string};
type TFunc = (key: string, fallback?: string | TVars) => string;

function useT(): TFunc {
  return useCallback((key: string, fallback?: string | TVars) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    if (fallback && typeof fallback === 'object') {
      return fallback.defaultValue ?? key;
    }
    return key;
  }, []);
}

/* ─── Tailwind palette + mono font resolved for native ────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

// font color literals (Tailwind -> hex): emerald-300 / rose-300 / amber-300.
const EMERALD_300 = '#6ee7b7';
const ROSE_300 = '#fda4af';
const AMBER_300 = '#fcd34d';

// border-[var(--border-subtle)] / bg-white/[0.02] hairline + faint fills.
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';
const PANEL_FILL = 'rgba(255, 255, 255, 0.02)';
const ROW_DIVIDER = 'rgba(255, 255, 255, 0.04)';

// lucide Pin/PinOff -> filled / outline star toggle (tintable, BMP-safe).
const STAR_FILLED = '\u2605'; // ★ — pinned
const STAR_OUTLINE = '\u2606'; // ☆ — not pinned

/* ─── Exported types (preserved verbatim from web) ────────────────────── */

export type SignalDiffPinKey = string; // formatted as `widget` item_id

export interface SignalDiffTableProps {
  rows: SignalDiffRow[];
  vehicleId: number;
  loading?: boolean;
  /** Already-applied filters in the page; used purely for the empty message. */
  filterActive?: boolean;
  selectedSignals: string[];
  onSelectionChange: (signals: string[]) => void;
  pinnedSignals: Set<string>;
  /** Callback for direct row pin click (when not delegated to the PinButton). */
  onRowClick?: (row: SignalDiffRow) => void;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the root container (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/* ─── Pure helpers (ported verbatim from web) ─────────────────────────── */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed) && v.trim() !== '') {
      return parsed;
    }
  }
  if (typeof v === 'boolean') {
    return v ? 1 : 0;
  }
  return null;
}

// Mirrors web fmtNumber(@/lib/numberFormat): safeNumber (0 for nullish/non-
// finite) -> toFixed(decimals) -> en-US thousands grouping. The web default
// precision is 2 (the global precision); pass 1 for the percent cell.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  return n < 0 ? `-${body}` : body;
}

function formatRaw(v: unknown): string {
  if (v == null) {
    return '—';
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? fmtNumber(v) : '—';
  }
  if (typeof v === 'boolean') {
    return v ? 'true' : 'false';
  }
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function deltaLabel(
  a: unknown,
  b: unknown,
): {kind: 'num' | 'change' | 'none'; delta?: number; pct?: number} {
  const numA = asNumber(a);
  const numB = asNumber(b);
  if (isFiniteNumber(numA) && isFiniteNumber(numB)) {
    const delta = numB - numA;
    const pct = numA !== 0 ? (delta / Math.abs(numA)) * 100 : null;
    return {kind: 'num', delta, pct: pct ?? undefined};
  }
  if (formatRaw(a) === formatRaw(b)) {
    return {kind: 'none'};
  }
  return {kind: 'change'};
}

/* ─── Inline SourceLayerBadge (web @/components/data-display) ──────────── */

type SignalSource = SignalSourceLayer | string;

// web Tailwind tints resolved to literal rgba/hex + the same labels + the same
// sourceLayer.* description keys (used as the pill's accessibilityLabel, since
// native has no hover Tooltip — the FreshnessIndicator title->a11y idiom).
const SOURCE_STYLE: Record<
  string,
  {bg: string; border: string; text: string; label: string; descKey: string; descFallback: string}
> = {
  l1: {
    bg: 'rgba(16, 185, 129, 0.15)',
    border: 'rgba(16, 185, 129, 0.3)',
    text: '#a7f3d0',
    label: 'L1',
    descKey: 'sourceLayer.l1.desc',
    descFallback: 'Read from the in-process SignalStore (hot path, freshest).',
  },
  l2: {
    bg: 'rgba(59, 130, 246, 0.15)',
    border: 'rgba(59, 130, 246, 0.3)',
    text: '#bfdbfe',
    label: 'L2',
    descKey: 'sourceLayer.l2.desc',
    descFallback: 'Read from Redis cross-pod cache (legacy entry; freshness unknown).',
  },
  log: {
    bg: colors.surfaceRaised,
    border: 'rgba(255, 255, 255, 0.2)',
    text: colors.textSecondary,
    label: 'LOG',
    descKey: 'sourceLayer.log.desc',
    descFallback: 'Replayed from signal_log (durable history).',
  },
  stale: {
    bg: 'rgba(245, 158, 11, 0.15)',
    border: 'rgba(245, 158, 11, 0.3)',
    text: '#fde68a',
    label: 'STALE',
    descKey: 'sourceLayer.stale.desc',
    descFallback: 'Redis-backed value older than the 2-minute freshness window.',
  },
  unknown: {
    bg: colors.surfaceRaised,
    border: HAIRLINE,
    text: colors.textSecondary,
    label: '—',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
};

function formatBadgeAge(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) {
    return null;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} min`;
  }
  if (ms < 86_400_000) {
    return `${(ms / 3_600_000).toFixed(1)} h`;
  }
  return `${(ms / 86_400_000).toFixed(1)} d`;
}

interface SourceLayerBadgeProps {
  source: SignalSource | null | undefined;
  ageMs?: number | null;
  showLabel?: boolean;
}

function SourceLayerBadge({source, ageMs, showLabel}: SourceLayerBadgeProps) {
  const t = useT();
  const key = (source ?? 'unknown').toLowerCase();
  const style = SOURCE_STYLE[key] ?? SOURCE_STYLE.unknown;
  const ageText = formatBadgeAge(ageMs);
  const tooltip = ageText
    ? `${t(style.descKey, style.descFallback)} (${t('sourceLayer.age', 'age')}: ${ageText})`
    : t(style.descKey, style.descFallback);

  return (
    <View
      accessibilityLabel={tooltip}
      accessibilityRole="text"
      accessible
      style={[
        styles.badge,
        {
          backgroundColor: style.bg,
          borderColor: style.border,
          minWidth: showLabel ? 40 : 24,
        },
      ]}
      testID="source-layer-badge">
      <AppText
        allowFontScaling={false}
        numberOfLines={1}
        style={[styles.badgeLabel, {color: style.text}]}>
        {style.label}
      </AppText>
    </View>
  );
}

/* ─── Inline PinButton (web @/components/ui) ───────────────────────────── */

interface PinButtonProps {
  itemType: PinnedItemType;
  itemId: string | number;
  context?: string;
  size?: 'sm' | 'md';
}

function PinButton({itemType, itemId, context, size = 'sm'}: PinButtonProps) {
  const t = useT();
  const {data: pinned = []} = usePinned(itemType, context);
  const toggle = useTogglePin(itemType);

  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);

  const tooltipLabel = isPinned
    ? t('pin.unpin', {defaultValue: 'Unpin'})
    : t('pin.pin', {defaultValue: 'Pin'});

  const handlePress = useCallback(() => {
    // Web stops row-click propagation here; native rows are not pressable, so
    // there is nothing to stop. Skip while a previous toggle is in flight.
    if (toggle.isPending) {
      return;
    }
    toggle.mutate({itemId: idStr, context, pin: !isPinned});
  }, [toggle, idStr, context, isPinned]);

  return (
    <Pressable
      accessibilityLabel={tooltipLabel}
      accessibilityRole="button"
      accessibilityState={{selected: isPinned, disabled: toggle.isPending, busy: toggle.isPending}}
      disabled={toggle.isPending}
      hitSlop={8}
      onPress={handlePress}
      style={({pressed}) => [
        styles.pinTrigger,
        toggle.isPending && styles.pinTriggerDisabled,
        pressed && styles.pinTriggerPressed,
      ]}
      testID="pin-button">
      <AppText
        allowFontScaling={false}
        style={[
          styles.pinGlyph,
          {
            color: isPinned ? AMBER_300 : colors.textMuted,
            fontSize: size === 'md' ? 16 : 14,
          },
        ]}>
        {isPinned ? STAR_FILLED : STAR_OUTLINE}
      </AppText>
    </Pressable>
  );
}

/* ─── Inline DataTable (web @/components/ui, virtualized + multi-select) ─ */

interface Column<T> {
  key: string;
  header: string;
  /** Web Tailwind class; parsed best-effort for width (w-N) + alignment. */
  className?: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  tableId: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  emptyMessage: string;
  compact?: boolean;
  selectable?: 'multi' | 'single';
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  virtualized?: boolean;
  rowHeight?: number;
  maxHeight?: number;
  stickyHeader?: boolean;
}

const SELECT_COL_WIDTH = 40;
const DEFAULT_COL_WIDTH = 160;
const SORT_ASC_GLYPH = '\u25B4'; // ▴
const SORT_DESC_GLYPH = '\u25BE'; // ▾

// Tailwind w-N -> N * 4dp; otherwise a sensible default so the column stays
// readable inside the horizontal scroll.
function parseWidth(className?: string): number {
  if (className) {
    const m = className.match(/\bw-(\d+)\b/);
    if (m) {
      return Number(m[1]) * 4;
    }
  }
  return DEFAULT_COL_WIDTH;
}

function parseAlign(className?: string): 'flex-start' | 'center' | 'flex-end' {
  if (className?.includes('text-right')) {
    return 'flex-end';
  }
  if (className?.includes('text-center')) {
    return 'center';
  }
  return 'flex-start';
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  compact,
  selectable,
  selectedKeys,
  onSelectionChange,
  rowHeight = 36,
  maxHeight = 600,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const onSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  // No active sort -> keep the caller's order (pinned-first), matching the web
  // DataTable's "unsorted shows incoming order" behaviour.
  const rows = useMemo(() => {
    if (!sortKey) {
      return data;
    }
    const sorted = [...data];
    sorted.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [data, sortKey, sortDir]);

  const selected = useMemo(() => selectedKeys ?? [], [selectedKeys]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isSelectable = selectable === 'multi' || selectable === 'single';

  const allKeys = useMemo(() => data.map(keyExtractor), [data, keyExtractor]);
  const allSelected =
    allKeys.length > 0 && allKeys.every(k => selectedSet.has(k));
  const someSelected = allKeys.some(k => selectedSet.has(k));

  const toggleRow = useCallback(
    (key: string) => {
      if (!onSelectionChange) {
        return;
      }
      if (selectedSet.has(key)) {
        onSelectionChange(selected.filter(k => k !== key));
      } else {
        onSelectionChange([...selected, key]);
      }
    },
    [onSelectionChange, selected, selectedSet],
  );

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) {
      return;
    }
    onSelectionChange(allSelected ? [] : allKeys);
  }, [onSelectionChange, allSelected, allKeys]);

  const totalWidth =
    (isSelectable ? SELECT_COL_WIDTH : 0) +
    columns.reduce((sum, col) => sum + parseWidth(col.className), 0);

  const renderRow = useCallback(
    (row: T) => {
      const rowKey = keyExtractor(row);
      return (
        <View style={[styles.row, {height: rowHeight}]}>
          {isSelectable ? (
            <View style={[styles.cell, styles.selectCell, {width: SELECT_COL_WIDTH}]}>
              <Checkbox
                checked={selectedSet.has(rowKey)}
                onChange={() => toggleRow(rowKey)}
                size="sm"
              />
            </View>
          ) : null}
          {columns.map(col => {
            const content = col.render(row);
            return (
              <View
                key={col.key}
                style={[
                  styles.cell,
                  compact && styles.cellCompact,
                  {width: parseWidth(col.className), alignItems: parseAlign(col.className)},
                ]}>
                {typeof content === 'string' || typeof content === 'number' ? (
                  <AppText numberOfLines={1} style={styles.cellText}>
                    {content}
                  </AppText>
                ) : (
                  content
                )}
              </View>
            );
          })}
        </View>
      );
    },
    [columns, compact, isSelectable, keyExtractor, rowHeight, selectedSet, toggleRow],
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{width: totalWidth}}>
        {/* Sticky header (lives outside the scrolling FlatList). */}
        <View style={styles.headerRow}>
          {isSelectable ? (
            <View style={[styles.cell, styles.selectCell, {width: SELECT_COL_WIDTH}]}>
              <Checkbox
                accessibilityLabel="Select all"
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={toggleAll}
                size="sm"
              />
            </View>
          ) : null}
          {columns.map(col => {
            const active = sortKey === col.key;
            const headerNode = (
              <View
                style={[
                  styles.headerCellInner,
                  {justifyContent: parseAlign(col.className)},
                ]}>
                {col.header ? (
                  <AppText tone="muted" variant="caption" weight="semibold">
                    {col.header}
                  </AppText>
                ) : null}
                {active ? (
                  <AppText tone="muted" variant="caption">
                    {sortDir === 'asc' ? SORT_ASC_GLYPH : SORT_DESC_GLYPH}
                  </AppText>
                ) : null}
              </View>
            );
            if (col.sortable) {
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  key={col.key}
                  onPress={() => onSort(col.key)}
                  style={[
                    styles.cell,
                    compact && styles.cellCompact,
                    {width: parseWidth(col.className)},
                  ]}
                  testID={`signal-diff-sort-${col.key}`}>
                  {headerNode}
                </Pressable>
              );
            }
            return (
              <View
                key={col.key}
                style={[
                  styles.cell,
                  compact && styles.cellCompact,
                  {width: parseWidth(col.className)},
                ]}>
                {headerNode}
              </View>
            );
          })}
        </View>

        {rows.length === 0 ? (
          <EmptyState message={emptyMessage} title="" />
        ) : (
          <FlatList
            data={rows}
            getItemLayout={(_, index) => ({
              length: rowHeight,
              offset: rowHeight * index,
              index,
            })}
            keyExtractor={keyExtractor}
            renderItem={({item}) => renderRow(item)}
            style={{maxHeight}}
          />
        )}
      </View>
    </ScrollView>
  );
}

/* ─── SignalDiffTable ─────────────────────────────────────────────────── */

export function SignalDiffTable({
  rows,
  vehicleId,
  loading,
  filterActive,
  selectedSignals,
  onSelectionChange,
  pinnedSignals,
  className: _className,
  style,
  testID,
}: SignalDiffTableProps) {
  const t = useT();

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aPin = pinnedSignals.has(a.name) ? 1 : 0;
      const bPin = pinnedSignals.has(b.name) ? 1 : 0;
      if (aPin !== bPin) {
        return bPin - aPin;
      }
      return a.name.localeCompare(b.name);
    });
  }, [rows, pinnedSignals]);

  const columns: Column<SignalDiffRow>[] = useMemo(
    () => [
      {
        key: 'pin',
        header: '',
        className: 'w-10',
        render: row => (
          <PinButton
            context={`signal-diff:vehicle:${vehicleId}`}
            itemId={`signal:${row.name}`}
            itemType="widget"
            size="sm"
          />
        ),
      },
      {
        key: 'name',
        header: t('signalDiff.signal', 'Signal'),
        sortable: true,
        render: row => (
          <AppText numberOfLines={1} style={styles.monoPrimary}>
            {row.name}
          </AppText>
        ),
      },
      {
        key: 'value_a',
        header: t('signalDiff.valueA', 'Window A'),
        className: 'text-right',
        render: row => (
          <AppText numberOfLines={1} style={styles.monoSecondary}>
            {formatRaw(row.value_a)}
          </AppText>
        ),
      },
      {
        key: 'value_b',
        header: t('signalDiff.valueB', 'Window B'),
        className: 'text-right',
        render: row => (
          <AppText numberOfLines={1} style={styles.monoPrimary}>
            {formatRaw(row.value_b)}
          </AppText>
        ),
      },
      {
        key: 'delta',
        header: t('signalDiff.delta', 'Δ'),
        className: 'text-right w-28',
        sortable: true,
        render: row => {
          const lbl = deltaLabel(row.value_a, row.value_b);
          if (lbl.kind === 'none') {
            return <AppText style={styles.deltaNone}>—</AppText>;
          }
          if (lbl.kind === 'change') {
            return (
              <AppText style={styles.deltaChanged}>
                {t('signalDiff.deltaChanged', 'changed')}
              </AppText>
            );
          }
          const positive = (lbl.delta ?? 0) > 0;
          const negative = (lbl.delta ?? 0) < 0;
          const color = positive
            ? EMERALD_300
            : negative
              ? ROSE_300
              : colors.textMuted;
          const sign = positive ? '+' : '';
          const pctText =
            lbl.pct != null
              ? ` (${lbl.pct >= 0 ? '+' : ''}${fmtNumber(lbl.pct, 1)}%)`
              : '';
          return (
            <AppText numberOfLines={1} style={[styles.deltaNum, {color}]}>
              {`${sign}${fmtNumber(lbl.delta ?? 0)}${pctText}`}
            </AppText>
          );
        },
      },
      {
        key: 'source_a',
        header: t('signalDiff.sourceA', 'Src A'),
        className: 'w-16 text-center',
        render: row => (
          <SourceLayerBadge ageMs={row.age_ms_a} source={row.source_a} />
        ),
      },
      {
        key: 'source_b',
        header: t('signalDiff.sourceB', 'Src B'),
        className: 'w-16 text-center',
        render: row => (
          <SourceLayerBadge ageMs={row.age_ms_b} source={row.source_b} />
        ),
      },
    ],
    [t, vehicleId],
  );

  const emptyMessage = filterActive
    ? t('signalDiff.tableNoMatches', 'No signals match the current filter')
    : t('signalDiff.tableEmpty', 'No differences between the two snapshots');

  if (loading) {
    return (
      <View style={[styles.loadingPanel, style]} testID={testID}>
        <AppText style={styles.loadingText} tone="muted">
          {t('signalDiff.tableLoading', 'Loading…')}
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.root, style]} testID={testID}>
      {/* Legend explaining the technical columns. The shared DataTable header
          is text-only, so the per-column "?" tooltips live here above it. */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <AppText allowFontScaling={false} style={styles.legendLabel}>
            {t('signalDiff.legend.delta', 'Δ')}
          </AppText>
          <HelpTooltip
            ariaLabel={t('signalDiff.legend.deltaAria', {
              defaultValue: 'More info about the Δ column',
            })}
            defaultValue="Numeric difference (and percent change) between Window A and Window B for this signal. 'changed' is shown for non-numeric values that differ."
            i18nKey="help.signal.deltaCol"
            size="xs"
          />
        </View>
        <View style={styles.legendItem}>
          <AppText allowFontScaling={false} style={styles.legendLabel}>
            {t('signalDiff.legend.source', 'Src A / Src B')}
          </AppText>
          <HelpTooltip
            ariaLabel={t('signalDiff.legend.sourceAria', {
              defaultValue: 'More info about the source-layer column',
            })}
            defaultValue="The layer that supplied this value: L1 (in-process), L2 (Redis), LOG (TimescaleDB history), or STALE (older than 2 minutes)."
            i18nKey="help.signal.sourceLayer"
            size="xs"
          />
        </View>
      </View>
      <DataTable
        columns={columns}
        compact
        data={sortedRows}
        emptyMessage={emptyMessage}
        keyExtractor={row => row.name}
        maxHeight={600}
        onSelectionChange={keys => onSelectionChange(keys.map(String))}
        rowHeight={36}
        selectable="multi"
        selectedKeys={selectedSignals}
        stickyHeader
        tableId="signal-diff-table"
        virtualized
      />
    </View>
  );
}

SignalDiffTable.displayName = 'SignalDiffTable';

const styles = StyleSheet.create({
  // w-full
  root: {
    width: '100%',
  },
  // rounded-md border border-[var(--border-subtle)] bg-white/[0.02] p-6
  loadingPanel: {
    width: '100%',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: HAIRLINE,
    backgroundColor: PANEL_FILL,
    padding: spacing.lg,
  },
  // text-center text-sm text-[var(--text-muted)]
  loadingText: {
    fontSize: 14,
    textAlign: 'center',
  },
  // mb-2 flex flex-wrap items-center gap-3 px-1
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  // inline-flex items-center gap-1
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // font-mono uppercase tracking-wide text-[11px] text-[var(--text-muted)]
  legendLabel: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // DataTable header row (sticky, outside the scrolling list).
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCellInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: ROW_DIVIDER,
  },
  cell: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  cellCompact: {
    paddingVertical: spacing.xs,
  },
  selectCell: {
    alignItems: 'center',
  },
  cellText: {
    color: colors.textSecondary,
  },
  // font-mono text-xs text-[var(--text-primary)]
  monoPrimary: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: colors.textPrimary,
  },
  // font-mono text-xs text-[var(--text-secondary)]
  monoSecondary: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: colors.textSecondary,
  },
  // font-mono text-xs (color applied dynamically)
  deltaNum: {
    fontFamily: MONO_FONT,
    fontSize: 11,
  },
  // text-xs text-[var(--text-muted)]
  deltaNone: {
    fontSize: 11,
    color: colors.textMuted,
  },
  // text-xs text-amber-300
  deltaChanged: {
    fontSize: 11,
    color: AMBER_300,
  },
  // SourceLayerBadge pill: rounded px-1.5 py-px font-mono uppercase text-[10px]
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeLabel: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // PinButton trigger (h-7 w-7 rounded-md, centered).
  pinTrigger: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  pinTriggerPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  pinTriggerDisabled: {
    opacity: 0.6,
  },
  pinGlyph: {
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default SignalDiffTable;
