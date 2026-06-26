// Native parity port of
// web/src/features/telemetry/components/SignalHistoryTable.tsx.
//
// The web component renders a paginated signal-history card: a GlassPanel
// (p-4 sm:p-5) whose header pairs a lucide `Activity` glyph (text-neon-cyan)
// with the title and an optional "Page X · N total" meta badge, above a shared
// `DataTable` of four columns (Timestamp, Signal, Value, Type) with raw-payload
// row expansion, followed by a `Pagination` control. The Signal column is
// colour-coded by the row signal's index in the caller's `selectedSignals`
// list (via CHART_COLORS) so the table stays visually aligned with the chart
// panel. Loading shows five skeleton bars; an empty result shows an EmptyState.
//
// Native substitutions (no DOM, lucide-react, framer-motion, Recharts, Leaflet,
// or web UI components are imported):
//   * `GlassPanel` (@/components/ui) -> the native `components/ui/GlassPanel`
//     (takes `style` instead of `className`; p-4 -> padding 16).
//   * `DataTable` + `type Column` (@/components/ui) -> a self-contained native
//     table: a sticky header row above a maxHeight-bounded ScrollView of rows;
//     `compact` -> tight row padding, `stickyHeader` -> header outside the
//     scroll body, `maxHeight={520}` -> ScrollView maxHeight 520. The `Column`
//     shape (key/header/render/visibleOnMobile) is reproduced locally; the
//     keyExtractor `${created_at}-${signal}`, the expandable/expandedKeys/
//     onExpandedChange/renderExpanded row-expansion contract, and the
//     `visibleOnMobile` responsive rule (the Type column hides below the sm
//     breakpoint) are all preserved. `tableId` and `showColumnsMenu` are web
//     column-persistence/menu affordances with no native analogue and are
//     intentionally not reproduced.
//   * `Badge` (@/components/ui) -> a self-contained native pill mirroring the
//     info/success/warning/neutral variant surfaces (size="sm").
//   * `Pagination` (@/components/ui) -> a self-contained native control
//     reproducing the web first/prev/next/last buttons (1-based; disabled at the
//     ends), the "Page p / totalPages" indicator, and the "Showing start–end of
//     total" copy, with totalPages = max(1, ceil(total / pageSize)).
//   * `EmptyState` (@/components/feedback) -> the native
//     `components/feedback/EmptyState` (title + message), wrapped with the
//     Activity SemanticIcon above it to preserve the web `icon` prop intent.
//   * `Skeleton` (@/components/feedback) -> an inlined muted placeholder bar
//     (h-8); five are stacked while loading, matching the web.
//   * `FadeIn` (@/components/motion) -> an inlined static final-state wrapper
//     (the web reduced-motion branch); it carries no behavioural contract.
//   * lucide `Activity` -> the repo SemanticIcon `activity` glyph (accent tone,
//     matching the web text-neon-cyan intent), rendered small in the header and
//     large in the empty state.
//   * `useDateFormat().formatDateTime` -> a native `useNativeDateFormat()`
//     whose `formatDateTime` mirrors @/lib/dateFormat.formatDateTime ("Jun 26,
//     2026, 9:42 AM" via toLocaleString en-US with year/month/day/hour:2-digit/
//     minute:2-digit), '—' for null/invalid. The user tz/locale binding has no
//     native settings surface here, so the device zone + en-US locale are used
//     (same approach as the sibling IncidentTimelinePage port).
//   * `CHART_COLORS` (@/lib/colors) -> the CB-safe Okabe-Ito palette inlined
//     verbatim (the bare web `CHART_COLORS` export resolves to CHART_COLORS_CB_SAFE).
//   * `fmtInt` (@/lib/numberFormat) -> a value-identical inline (safeNumber
//     coerces non-finite -> 0; en-US grouping at 0 fraction digits).
//   * `formatValue` + `type SignalLogEntry` (@/components/SignalQueryControls)
//     -> inlined field-for-field; the native SignalQueryControls port does not
//     exist yet in this file-by-file loop, so the entry shape and the
//     num/str/bool/'—' formatter are reproduced verbatim.
//   * `cn` (@/lib/cn) -> StyleSheet arrays / conditional styles.
//   * react-i18next `t` -> a self-contained fallback returning `fallback ?? key`
//     so every i18n key (which is also the English string here) is preserved.

import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {colors} from '../../../../theme/tokens';

// Cross-platform monospace family (matches the web `font-mono` cells/JSON).
const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// The web global number formatter defaults to the 'en-US' locale.
const DEFAULT_LOCALE = 'en-US';

// Tailwind `sm:` breakpoint (640px). Below it, the table behaves as "mobile":
// columns without `visibleOnMobile` (the Type column) are hidden, mirroring the
// shared DataTable's responsive column rule.
const SM_BREAKPOINT = 640;

// Inlined @/lib/colors `CHART_COLORS` (the bare export resolves to the CB-safe
// Okabe-Ito palette). Used to colour-code the Signal column by the row signal's
// position in `selectedSignals`.
const CHART_COLORS = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#4B4B4B', // neutral grey
] as const;

/* ── Inlined @/components/SignalQueryControls shared types/helpers ── */

// Field-for-field mirror of the web `SignalLogEntry`.
export interface SignalLogEntry {
  created_at: string;
  signal: string;
  value_num?: number | null;
  value_str?: string | null;
  value_bool?: boolean | null;
}

// Verbatim port of the web `formatValue`.
function formatValue(entry: SignalLogEntry): string {
  if (entry.value_num != null) {
    return String(entry.value_num);
  }
  if (entry.value_str != null) {
    return entry.value_str;
  }
  if (entry.value_bool != null) {
    return entry.value_bool ? 'true' : 'false';
  }
  return '—';
}

/* ── Inlined @/lib/numberFormat `fmtInt` ── */

function fmtInt(value: number): string {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safe));
  }
}

/* ── Inlined @/hooks/useDateFormat().formatDateTime ── */

// Mirrors @/lib/dateFormat.formatDateTime: "Jun 26, 2026, 9:42 AM" via
// toLocaleString(en-US) with the same field set; '—' for null/invalid input.
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  try {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

function useNativeDateFormat(): {
  formatDateTime: (value: string | null | undefined) => string;
} {
  const fmt = useCallback(
    (value: string | null | undefined) => formatDateTime(value),
    [],
  );
  return {formatDateTime: fmt};
}

/* ── Inlined react-i18next `t` fallback ── */

type NativeTFunction = (key: string, fallback?: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet; the key is also the English string here, so this returns
// `fallback ?? key`, preserving every English label/copy.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ── Type badge mapping (verbatim from the web source) ── */

type BadgeVariant = 'info' | 'success' | 'warning' | 'neutral';

const TYPE_BADGE_VARIANT: Record<string, 'info' | 'success' | 'warning'> = {
  number: 'info',
  string: 'success',
  boolean: 'warning',
};

function valueType(row: SignalLogEntry): string {
  if (row.value_num !== null && row.value_num !== undefined) {
    return 'number';
  }
  if (row.value_bool !== null && row.value_bool !== undefined) {
    return 'boolean';
  }
  return 'string';
}

/* ── Local mirror of the web `Column` shape used by this table ── */

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  visibleOnMobile?: boolean;
}

/* ── Inlined native parity primitives ── */

// framer-motion `<FadeIn>` -> static final-state wrapper (the web reduced-motion
// branch). No behavioural contract.
function FadeIn({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

// Native parity for the shared web `Badge` (size="sm").
function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeToneStyles[variant]]}>
      <AppText style={badgeTextStyles[variant]} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// Native parity for the shared web `Skeleton` (h-8 placeholder bar).
function Skeleton() {
  return <View style={styles.skeletonBar} />;
}

// One first/prev/next/last control in the native Pagination.
function PageButton({
  label,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.pageButton,
        disabled && styles.pageButtonDisabled,
        pressed && !disabled && styles.pageButtonPressed,
      ]}>
      <AppText style={styles.pageButtonLabel} tone="muted">
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the shared web `Pagination` (1-based; first/prev/next/last +
// "Showing start–end of total").
function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useNativeTranslationFallback();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <View style={styles.pagination}>
      <AppText style={styles.paginationInfo} tone="muted">
        {t(
          'pagination.showing',
          `Showing ${total > 0 ? start : 0}–${end} of ${total}`,
        )}
      </AppText>
      <View style={styles.paginationControls}>
        <PageButton
          accessibilityLabel={t('pagination.first', 'First page')}
          disabled={page <= 1}
          label="«"
          onPress={() => onPageChange(1)}
        />
        <PageButton
          accessibilityLabel={t('pagination.previous', 'Previous page')}
          disabled={page <= 1}
          label="‹"
          onPress={() => onPageChange(page - 1)}
        />
        <AppText style={styles.paginationCurrent} tone="secondary">
          {page} / {totalPages}
        </AppText>
        <PageButton
          accessibilityLabel={t('pagination.next', 'Next page')}
          disabled={page >= totalPages}
          label="›"
          onPress={() => onPageChange(page + 1)}
        />
        <PageButton
          accessibilityLabel={t('pagination.last', 'Last page')}
          disabled={page >= totalPages}
          label="»"
          onPress={() => onPageChange(totalPages)}
        />
      </View>
    </View>
  );
}

// Per-column flex weights so the four columns lay out proportionally.
function columnStyle(key: string): ViewStyle {
  switch (key) {
    case 'time':
      return styles.colTime;
    case 'signal':
      return styles.colSignal;
    case 'value':
      return styles.colValue;
    case 'type':
      return styles.colType;
    default:
      return styles.colDefault;
  }
}

export interface SignalHistoryTableProps {
  rows: SignalLogEntry[];
  selectedSignals: string[];
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  /** Override panel title. */
  title?: string;
  /** Show the "Page X · N total" badge in the header. Default true. */
  showHeaderMeta?: boolean;
  /** Optional row-expansion JSON. Default true. */
  expandable?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the panel (parity consumers). */
  style?: StyleProp<ViewStyle>;
}

export function SignalHistoryTable({
  rows,
  selectedSignals,
  page,
  pageSize,
  totalRows,
  onPageChange,
  loading = false,
  title,
  showHeaderMeta = true,
  expandable = true,
  className: _className,
  style,
}: SignalHistoryTableProps) {
  const t = useNativeTranslationFallback();
  const {formatDateTime: formatDateTimeValue} = useNativeDateFormat();
  const [expandedKeys, setExpandedKeys] = useState<(string | number)[]>([]);

  const {width} = useWindowDimensions();
  const isMobile = width < SM_BREAKPOINT;

  const toggleRow = useCallback((key: string) => {
    setExpandedKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  }, []);

  const renderExpanded = useCallback(
    (r: SignalLogEntry) => (
      <AppText style={styles.expandedJson}>{JSON.stringify(r, null, 2)}</AppText>
    ),
    [],
  );

  const columns: Column<SignalLogEntry>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('Timestamp'),
        render: (r: SignalLogEntry) => (
          <AppText numberOfLines={1} style={styles.timeText} tone="muted">
            {formatDateTimeValue(r.created_at)}
          </AppText>
        ),
        visibleOnMobile: true,
      },
      {
        key: 'signal',
        header: t('Signal'),
        render: (r: SignalLogEntry) => {
          const idx = selectedSignals.indexOf(r.signal);
          const color =
            idx >= 0 ? CHART_COLORS[idx % CHART_COLORS.length] : undefined;
          return (
            <View style={styles.signalCell}>
              {color ? (
                <View style={[styles.signalDot, {backgroundColor: color}]} />
              ) : null}
              <AppText
                numberOfLines={1}
                style={[
                  styles.signalText,
                  color ? {color} : styles.signalTextDefault,
                ]}>
                {r.signal}
              </AppText>
            </View>
          );
        },
        visibleOnMobile: true,
      },
      {
        key: 'value',
        header: t('Value'),
        render: (r: SignalLogEntry) => (
          <AppText numberOfLines={1} style={styles.valueText}>
            {formatValue(r)}
          </AppText>
        ),
        visibleOnMobile: true,
      },
      {
        key: 'type',
        header: t('Type'),
        render: (r: SignalLogEntry) => {
          const vt = valueType(r);
          return <Badge variant={TYPE_BADGE_VARIANT[vt] ?? 'neutral'}>{vt}</Badge>;
        },
      },
    ],
    [selectedSignals, t, formatDateTimeValue],
  );

  const visibleColumns = useMemo(
    () => columns.filter(col => !isMobile || col.visibleOnMobile),
    [columns, isMobile],
  );

  return (
    <FadeIn>
      <GlassPanel style={[styles.panel, style]}>
        <View style={styles.header}>
          <SemanticIcon decorative name="activity" size="sm" />
          <AppText style={styles.sectionTitle} weight="semibold">
            {title ?? t('Signal Data')}
          </AppText>
          {showHeaderMeta ? (
            <AppText style={styles.headerMeta} tone="muted">
              {`${t('Page')} ${page} · ${fmtInt(totalRows)} ${t('total')}`}
            </AppText>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.skeletonStack}>
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} />
            ))}
          </View>
        ) : rows.length > 0 ? (
          <>
            <View>
              <View style={styles.tableHeader}>
                {visibleColumns.map(col => (
                  <View key={col.key} style={[styles.headerCell, columnStyle(col.key)]}>
                    <AppText style={styles.headerCellText} tone="muted">
                      {col.header}
                    </AppText>
                  </View>
                ))}
                {expandable ? <View style={styles.expandCell} /> : null}
              </View>

              <ScrollView nestedScrollEnabled style={styles.tableBody}>
                {rows.map(r => {
                  const rowKey = `${r.created_at}-${r.signal}`;
                  const isExpanded = expandable && expandedKeys.includes(rowKey);
                  return (
                    <View key={rowKey} style={styles.rowWrap}>
                      <Pressable
                        accessibilityRole={expandable ? 'button' : undefined}
                        disabled={!expandable}
                        onPress={expandable ? () => toggleRow(rowKey) : undefined}
                        style={({pressed}) => [
                          styles.row,
                          pressed && expandable && styles.rowPressed,
                        ]}>
                        {visibleColumns.map(col => (
                          <View
                            key={col.key}
                            style={[styles.cell, columnStyle(col.key)]}>
                            {col.render(r)}
                          </View>
                        ))}
                        {expandable ? (
                          <View style={styles.expandCell}>
                            <SemanticIcon
                              decorative
                              name={isExpanded ? 'collapse' : 'expand'}
                              size="sm"
                            />
                          </View>
                        ) : null}
                      </Pressable>
                      {isExpanded ? (
                        <View style={styles.expandedRow}>{renderExpanded(r)}</View>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
            <Pagination
              onPageChange={onPageChange}
              page={page}
              pageSize={pageSize}
              total={totalRows}
            />
          </>
        ) : (
          // no-action: empty result for a user-issued query; the user adjusts the
          // controls above to re-query.
          <View style={styles.emptyWrap}>
            <SemanticIcon decorative name="activity" size="lg" />
            <EmptyState
              message={t('No signal data found for this query.')}
              title={t('No data')}
            />
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

SignalHistoryTable.displayName = 'SignalHistoryTable';

const styles = StyleSheet.create({
  // GlassPanel p-4 sm:p-5.
  panel: {
    padding: 16,
  },
  // flex items-center gap-2 mb-3.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  // .section-title: text-lg font-semibold tracking-tight text-primary.
  sectionTitle: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  // ml-auto text-[10px] text-muted.
  headerMeta: {
    marginLeft: 'auto',
    paddingLeft: 8,
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 14,
  },
  // space-y-2 stack of skeleton bars.
  skeletonStack: {
    gap: 8,
  },
  // h-8 placeholder bar.
  skeletonBar: {
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
  },

  // DataTable sticky header row.
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCell: {
    justifyContent: 'center',
  },
  headerCellText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  // maxHeight={520} scrollable body.
  tableBody: {
    maxHeight: 520,
  },
  rowWrap: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  // compact row padding.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  cell: {
    justifyContent: 'center',
  },
  colTime: {
    flex: 1.4,
  },
  colSignal: {
    flex: 1.6,
  },
  colValue: {
    flex: 1.2,
  },
  colType: {
    flex: 0.9,
  },
  colDefault: {
    flex: 1,
  },
  expandCell: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // whitespace-nowrap text-xs text-muted (Timestamp cell).
  timeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  // inline-flex items-center gap-1.5 (Signal cell).
  signalCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // h-2 w-2 rounded-full colour dot.
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  // font-mono text-xs.
  signalText: {
    flexShrink: 1,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  signalTextDefault: {
    color: colors.textPrimary,
  },
  // font-mono text-xs text-primary (Value cell).
  valueText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  // Expanded raw-payload JSON (whitespace-pre-wrap break-all text-[11px] font-mono).
  expandedRow: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  expandedJson: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  // size="sm" pill.
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },

  // EmptyState with the Activity icon above it.
  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },

  // pt-4 pagination row.
  pagination: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 16,
  },
  paginationInfo: {
    fontSize: 12,
    lineHeight: 16,
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  paginationCurrent: {
    paddingHorizontal: 12,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  pageButton: {
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  pageButtonDisabled: {
    opacity: 0.3,
  },
  pageButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  pageButtonLabel: {
    fontSize: 16,
    lineHeight: 18,
  },
});

const badgeToneStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
