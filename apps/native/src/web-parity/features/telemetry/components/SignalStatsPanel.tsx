// Native parity port of
// web/src/features/telemetry/components/SignalStatsPanel.tsx.
//
// The web module is a tiny presentation-only wrapper around the shared DataTable
// that renders a per-signal min/max/avg/count summary. When `selectedSignals` is
// supplied it emits one row per selected signal — including signals with no
// numeric samples in the queried range, which surface a `—` placeholder + a "No
// data in range" subtitle so the panel stops silently dropping selected signals.
// A "Hide empty (N)" Toggle lets the user collapse those placeholder rows once
// they've confirmed the data gap.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local English-fallback useTranslation()
//     whose t(key, default?, values?) accepts the bare-key form (t('Signal')),
//     the string-default form (t('signalStats.noDataInRange', 'No data in
//     range')) AND the string-default + interpolation-values form
//     (t('signalStats.hideEmpty', 'Hide empty ({{count}})', {count})) so every
//     key + interpolation token is preserved verbatim at the call site.
//   • The shared web @/components/ui {GlassPanel, DataTable, Toggle, Column} ->
//     the native apps/native GlassPanel plus an inlined DataTable (exactly the
//     tableId/columns/data/keyExtractor/compact/pagination props this caller
//     uses), an inlined Toggle (web role="switch" track+thumb, size 'sm'), and a
//     local Column<T> type ({key, header, render}).
//   • @/components/feedback Skeleton + @/components/motion FadeIn -> the
//     already-ported native parity Skeleton / FadeIn.
//   • @/lib/colors CHART_COLORS -> the inlined CB-safe Okabe-Ito palette (the web
//     default export) so the signal-name colour-by-index is identical.
//   • @/lib/numberFormat fmtNumber/fmtInt -> inlined verbatim (en-US locale,
//     2-decimal default; the parity bundle ships no Settings runtime so the
//     global precision/locale fold to their en-US defaults, matching siblings).
//   • @/lib/cn -> RN style arrays. The DOM-only `className` wrapper prop -> a
//     `style?: StyleProp<ViewStyle>` composition hook.
//   • The ../hooks/useLiveSignalStream SignalStat type -> inlined verbatim (the
//     hook itself is not part of this file's conversion).
// No DOM elements, react-i18next, Recharts, Leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {Skeleton} from '../../../components/feedback/Skeleton';
import {FadeIn} from '../../../components/motion/FadeIn';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number | undefined>;
type TranslationOptions = {defaultValue?: string} & TranslationValues;
type TFunc = (
  key: string,
  defaultOrOptions?: string | TranslationOptions,
  options?: TranslationOptions,
) => string;

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. It accepts the bare-key form, the string-default
// form, the string-default + interpolation-values form (the "Hide empty
// ({{count}})" label) and the {defaultValue, ...values} options form. A stable
// useCallback identity keeps the `columns` [t] dependency honest, matching the
// source.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, defaultOrOptions, options) => {
    if (typeof defaultOrOptions === 'string') {
      return interpolate(defaultOrOptions, options);
    }
    if (defaultOrOptions && typeof defaultOrOptions === 'object') {
      const {defaultValue, ...values} = defaultOrOptions;
      return interpolate(defaultValue ?? key, values);
    }
    return key;
  }, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber / fmtInt ────────────────────── */

// web safeNumber: returns 0 for nullish/NaN/Infinity.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(v, decimals?): locale integer/decimal formatting. The global
// precision default is 2 and the global locale default is 'en-US'; the parity
// bundle ships no useSettings runtime so both fold to those defaults.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt(v) = fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── inlined @/lib/colors CHART_COLORS (CB-safe Okabe-Ito default) ─────── */

// The bare web `CHART_COLORS` export resolves to the colour-blind-safe Okabe-Ito
// palette (CHART_COLORS_CB_SAFE), so the signal-name colour-by-index matches the
// web panel exactly.
const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

/* ─── inlined ../hooks/useLiveSignalStream SignalStat ──────────────────── */

export interface SignalStat {
  signal: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

/* ─── inlined @/components/ui Column (subset used here) ─────────────────── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export interface SignalStatsPanelProps {
  stats: SignalStat[];
  /**
   * If provided, the panel renders one row per selected signal
   * signals with no data show `—` placeholders and a "no data" hint.
   * When omitted (back-compat), only signals present in `stats` render.
   */
  selectedSignals?: string[];
  loading?: boolean;
  /** Override panel title. */
  title?: string;
  /** Native composition hook replacing the DOM-only `className` prop. */
  style?: StyleProp<ViewStyle>;
  /** Map signal -> color index. Defaults to position in `stats`. */
  signalIndex?: Record<string, number>;
}

function emptyStatRow(signal: string): SignalStat {
  return {signal, min: NaN, max: NaN, avg: NaN, count: 0};
}

function isEmptyStat(s: SignalStat): boolean {
  return s.count === 0;
}

/* ─── inlined @/components/ui Toggle (subset used here) ─────────────────── */

type ToggleSize = 'sm' | 'md';

interface ToggleDims {
  trackW: number;
  trackH: number;
  thumb: number;
  offset: number;
  onTranslate: number;
}

// web trackSize/thumbSize/thumbTranslate for the two sizes: sm = h-5 w-9 track
// (20x36) with an h-3.5 thumb (14) translated by translate-x-4 (16) from the
// base translate-x-[3px] inset; md = h-6 w-11 (24x44) with an h-5 thumb (20)
// translated by translate-x-5 (20).
const TOGGLE_DIMS: Record<ToggleSize, ToggleDims> = {
  sm: {trackW: 36, trackH: 20, thumb: 14, offset: 3, onTranslate: 16},
  md: {trackW: 44, trackH: 24, thumb: 20, offset: 3, onTranslate: 20},
};

// web off-state track: bg-gray-600 (dark). Native equivalent muted slate.
const TOGGLE_TRACK_OFF = 'rgba(148, 163, 184, 0.45)';

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: ToggleSize;
}

// web Toggle: a role="switch" button (track) with a white sliding thumb plus an
// optional label to the right; the active track tints cyan. RN has no
// transition, so the thumb is positioned absolutely at its off/on offset.
function Toggle({label, checked, onChange, size = 'md'}: ToggleProps) {
  const dims = TOGGLE_DIMS[size];
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => onChange(!checked)}
      style={styles.toggleRoot}>
      <View
        style={[
          styles.toggleTrack,
          {
            width: dims.trackW,
            height: dims.trackH,
            borderRadius: dims.trackH / 2,
            backgroundColor: checked ? colors.accent : TOGGLE_TRACK_OFF,
          },
        ]}>
        <View
          style={[
            styles.toggleThumb,
            {
              width: dims.thumb,
              height: dims.thumb,
              borderRadius: dims.thumb / 2,
              top: dims.offset,
              left: dims.offset + (checked ? dims.onTranslate : 0),
            },
          ]}
        />
      </View>
      {label ? (
        <AppText style={styles.toggleLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── inlined @/components/ui DataTable (subset used here) ──────────────── */

interface PaginationConfig {
  defaultPageSize?: number;
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  compact?: boolean;
  pagination?: PaginationConfig;
}

// Inlined native DataTable covering exactly the props this caller uses: a header
// row of column headers and one body row per datum, each cell rendered through
// the column's render(). compact tightens the vertical padding; pagination
// slices at the page size with a Prev/Next pager shown only when there is more
// than one page (the page resets to 1 whenever the row count changes so a
// shrinking dataset never strands the viewer on an empty trailing page).
function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  compact = false,
  pagination,
}: DataTableProps<T>) {
  const paginationEnabled = !!pagination;
  const pageSize = pagination?.defaultPageSize ?? 25;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [data.length]);

  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil(data.length / pageSize))
    : 1;
  const safePage = Math.min(page, totalPages);
  const pagedData = paginationEnabled
    ? data.slice((safePage - 1) * pageSize, safePage * pageSize)
    : data;

  const rowPadStyle = compact ? styles.rowCompact : styles.rowComfortable;

  return (
    <View style={styles.table} testID={tableId}>
      <View style={[styles.row, styles.headerRowTable, rowPadStyle]}>
        {columns.map(col => (
          <View key={col.key} style={[styles.cell, styles.cellFlex]}>
            <AppText
              numberOfLines={1}
              style={styles.headerText}
              tone="muted"
              weight="semibold">
              {col.header}
            </AppText>
          </View>
        ))}
      </View>

      {pagedData.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.row, styles.bodyRow, rowPadStyle]}>
          {columns.map(col => (
            <View key={col.key} style={[styles.cell, styles.cellFlex]}>
              {col.render(row)}
            </View>
          ))}
        </View>
      ))}

      {paginationEnabled && totalPages > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage <= 1}}
            disabled={safePage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={({pressed}) => [
              styles.pagerBtn,
              safePage <= 1 ? styles.pagerBtnDisabled : null,
              pressed && safePage > 1 ? styles.pagerBtnPressed : null,
            ]}>
            <AppText variant="caption" weight="semibold">
              Prev
            </AppText>
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`Page ${safePage} of ${totalPages}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage >= totalPages}}
            disabled={safePage >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            style={({pressed}) => [
              styles.pagerBtn,
              safePage >= totalPages ? styles.pagerBtnDisabled : null,
              pressed && safePage < totalPages ? styles.pagerBtnPressed : null,
            ]}>
            <AppText variant="caption" weight="semibold">
              Next
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ─── SignalStatsPanel ─────────────────────────────────────────────────── */

export function SignalStatsPanel({
  stats,
  selectedSignals,
  loading = false,
  title,
  style,
  signalIndex,
}: SignalStatsPanelProps) {
  const {t} = useTranslation();
  const [hideEmpty, setHideEmpty] = useState(false);

  // Compute the display rows: when `selectedSignals` is provided, emit
  // one row per selected signal (filling gaps with placeholder rows);
  // otherwise pass `stats` through unchanged.
  const displayStats = useMemo<SignalStat[]>(() => {
    if (!selectedSignals?.length) {
      return stats;
    }
    const byName = new Map(stats.map(s => [s.signal, s]));
    return selectedSignals.map(sig => byName.get(sig) ?? emptyStatRow(sig));
  }, [stats, selectedSignals]);

  const emptyCount = useMemo(
    () => displayStats.reduce((n, s) => (isEmptyStat(s) ? n + 1 : n), 0),
    [displayStats],
  );
  const visibleStats = useMemo(
    () => (hideEmpty ? displayStats.filter(s => !isEmptyStat(s)) : displayStats),
    [displayStats, hideEmpty],
  );

  const renderNumeric = (n: number) =>
    Number.isNaN(n) || !Number.isFinite(n) ? (
      <AppText accessibilityLabel="No data" style={styles.numDash} tone="muted">
        —
      </AppText>
    ) : (
      <AppText style={styles.numSecondary}>{fmtNumber(n)}</AppText>
    );

  const columns: Column<SignalStat>[] = useMemo(
    () => [
      {
        key: 'signal',
        header: t('Signal'),
        render: (s: SignalStat) => {
          const idx = signalIndex?.[s.signal] ?? displayStats.indexOf(s);
          const color = CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
          return (
            <View style={styles.signalCell}>
              <AppText
                numberOfLines={1}
                style={[styles.signalName, {color}]}
                weight="semibold">
                {s.signal}
              </AppText>
              {isEmptyStat(s) ? (
                <AppText style={styles.signalNoData} tone="muted">
                  {t('signalStats.noDataInRange', 'No data in range')}
                </AppText>
              ) : null}
            </View>
          );
        },
      },
      {key: 'min', header: t('Min'), render: (s: SignalStat) => renderNumeric(s.min)},
      {key: 'max', header: t('Max'), render: (s: SignalStat) => renderNumeric(s.max)},
      {
        key: 'avg',
        header: t('Avg'),
        render: (s: SignalStat) =>
          Number.isNaN(s.avg) || !Number.isFinite(s.avg) ? (
            <AppText style={styles.numDash} tone="muted">
              —
            </AppText>
          ) : (
            <AppText style={styles.numPrimary}>{fmtNumber(s.avg)}</AppText>
          ),
      },
      {
        key: 'count',
        header: t('Count'),
        render: (s: SignalStat) => (
          <AppText style={styles.numMuted}>{fmtInt(s.count)}</AppText>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayStats, signalIndex, t],
  );

  return (
    <FadeIn>
      <GlassPanel style={[styles.panel, style]}>
        <View style={styles.header}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {title ?? t('Stats Summary')}
          </AppText>
          {emptyCount > 0 ? (
            <Toggle
              checked={hideEmpty}
              label={t('signalStats.hideEmpty', 'Hide empty ({{count}})', {
                count: emptyCount,
              })}
              onChange={setHideEmpty}
              size="sm"
            />
          ) : null}
        </View>
        {loading ? (
          <View style={styles.loadingGrid}>
            {[1, 2, 3, 4].map(i => (
              <View key={i} style={styles.loadingCell}>
                <Skeleton height={80} />
              </View>
            ))}
          </View>
        ) : visibleStats.length > 0 ? (
          <DataTable
            columns={columns}
            compact
            data={visibleStats}
            keyExtractor={s => s.signal}
            pagination={{defaultPageSize: 50}}
            tableId="telemetry:signal-stats"
          />
        ) : (
          <AppText style={styles.emptyText} tone="muted">
            {t('No stats available')}
          </AppText>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

SignalStatsPanel.displayName = 'SignalStatsPanel';

const MONO_FONT = Platform.select({
  ios: 'Courier New',
  android: 'monospace',
  default: 'monospace',
});

const numericCell: TextStyle = {
  fontFamily: MONO_FONT,
  fontSize: 13,
  lineHeight: 18,
};

const styles = StyleSheet.create({
  panel: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.4,
  },
  loadingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  loadingCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 16,
  },
  toggleRoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleTrack: {
    justifyContent: 'center',
  },
  toggleThumb: {
    position: 'absolute',
    backgroundColor: '#ffffff',
  },
  toggleLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  table: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  rowComfortable: {
    paddingVertical: spacing.sm,
  },
  rowCompact: {
    paddingVertical: spacing.xs,
  },
  headerRowTable: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  cell: {
    minWidth: 0,
    justifyContent: 'center',
    paddingRight: spacing.xs,
  },
  cellFlex: {
    flex: 1,
  },
  headerText: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  signalCell: {
    gap: 2,
  },
  signalName: {
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 18,
  },
  signalNoData: {
    fontSize: 10,
    lineHeight: 14,
  },
  numDash: {
    fontSize: 13,
    lineHeight: 18,
  },
  numSecondary: {
    ...numericCell,
    color: colors.textSecondary,
  },
  numPrimary: {
    ...numericCell,
    color: colors.textPrimary,
  },
  numMuted: {
    ...numericCell,
    color: colors.textMuted,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  pagerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pagerBtnDisabled: {
    opacity: 0.4,
  },
  pagerBtnPressed: {
    opacity: 0.7,
  },
  pagerLabel: {
    minWidth: 96,
    textAlign: 'center',
  },
});
