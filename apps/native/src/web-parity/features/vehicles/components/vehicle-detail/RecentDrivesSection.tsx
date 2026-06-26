// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx.
//
// Vehicle Detail — the "Recent Drives" panel. Renders a header (Route icon +
// title + "View all" link) followed by either a paginated DataTable of the
// recent drives (Date / Distance / Duration / Battery columns) or a transient
// no-action empty state when the drives prop is missing/empty. The prop name
// (drives), the `useDriveColumns` column factory, every column key + header +
// render expression, the `?? 0` fallbacks, the `!= null` battery ladder, the
// distance unit suffix, the `compact` / `pagination` table behaviour and all
// i18n keys + English defaults are preserved.
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-router-dom `Link to="/drives"` (web L1, L62-67) -> an
//     accessibilityRole="link" Pressable (PeriodComparePage precedent). Native
//     has no router, so the internal `/drives` navigation target is unavailable
//     in this parity surface; the label + trailing chevron are preserved.
//   - react-i18next `useTranslation` (web L2, L19, L49) -> inline
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('key', 'English') call keeps its English default + translation-key intent.
//   - lucide-react Route/ChevronRight (web L3) -> the shared SemanticIcon
//     ('drives' glyph for Route — the title marker + empty-state icon) and a
//     literal '\u203A' chevron AppText for ChevronRight (no chevron glyph in the
//     native SemanticIcon set; PeriodComparePage uses inline arrow glyphs). The
//     web cyan/muted icon tints map to the SemanticIcon's baked tone, a
//     documented minor tradeoff.
//   - `@/components/ui` GlassPanel + DataTable + Column (web L5) -> the native
//     GlassPanel (className 'p-6' -> padding 24) and a focused, self-contained
//     DataTable + Column<T> built from the established native table pattern
//     (TeslaChargingHistoryPage): a horizontal ScrollView of fixed-width
//     columns, header row, body rows via col.render, compact density and
//     paginate-by-25. The web `tableId` column-state persistence has no native
//     storage surface and is intentionally dropped; the page-size selector chips
//     of the shared web DataTable are omitted (the section passes a bare
//     `pagination` with no config and renders a single page in practice), while
//     the core paginate-by-25 + prev/next behaviour is preserved.
//   - `@/components/feedback` EmptyState (web L6, L80-83) -> the source passes an
//     icon + message (no title/action), so native renders a centred Route
//     (SemanticIcon 'drives') over a muted message rather than the shared native
//     EmptyState (which requires a title the call site does not supply,
//     ClimateSection/SecurityPanel precedent). The web "no-action: transient
//     empty state" comment is preserved below.
//   - `@/hooks/useUnits` useUnits().unitPrefs.distance (web L7, L50-51) ->
//     useFormatPrefs().distanceUnit. Both derive identically ('mi' iff
//     unit_of_length === 'mi', else 'km'), so the DistanceUnitPref 'ft' member is
//     unreachable here — full parity.
//   - `@/lib/unitConversion` convertDistanceFromSI + DistanceUnitPref (web L8) ->
//     the ported native _formatPrimitives convertDistanceFromSI + DistanceUnit.
//   - `@/lib/dateFormat` formatDateTime (web L9) -> an inline formatDateTime that
//     mirrors web dateFormat.formatDateTime exactly (device locale + tz, '\u2014'
//     fallback for nullish/Invalid Date).
//   - `@/lib/numberFormat` fmtNumber (web L10) -> useFormatPrefs().fmt, the same
//     locale-aware fixed-precision formatter driven by settings.decimal_precision.
//   - `@/api/types` Drive (web L11) -> the ported native web-parity api/types.
//   - `./helpers` durationStr (web L12) -> an inline durationStr mirroring the
//     vehicle-detail helpers.durationStr (minutes -> "2h 05m" / "5m"); its
//     fmtInt(minutes % 60) becomes prefs.fmt(value, 0), the same locale-aware
//     integer.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, lucide-react,
// react-router-dom or react-i18next are imported — only react, react-native
// primitives (Pressable, ScrollView, StyleSheet, View), the existing apps/native
// SemanticIcon / AppText / GlassPanel / theme tokens, and the ported web-parity
// _formatPrimitives + Drive type.

import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import type {Drive} from '../../../../api/types';
import {
  convertDistanceFromSI,
  useFormatPrefs,
  type FormatPrefs,
} from '../../../../components/data-display/format/_formatPrimitives';

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

/** Em-dash placeholder (web `'—'`, U+2014). Web dateFormat/battery fallback. */
const DASH = '\u2014';

/** Stable row key type, mirrors the web @/components/ui DataTable RowKey. */
type RowKey = string | number;

/** Fallback fixed column width (web DataTable sizes columns implicitly). */
const DEFAULT_COL_WIDTH = 150;

/** Web DataTable default pagination page size (PaginationConfig defaultPageSize). */
const ROWS_PER_PAGE = 25;

/**
 * Inline port of web `@/lib/dateFormat` formatDateTime (no-opts call site):
 * device locale + timezone, "Apr 4, 2026, 2:30 AM", with the '\u2014' fallback
 * for nullish / Invalid Date input. Matches the web renderer byte-for-byte.
 */
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return DASH;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return DASH;
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Inline port of vehicle-detail helpers.durationStr: minutes -> "2h 05m" / "5m".
 * The web `fmtInt(minutes % 60)` (locale-aware integer) becomes the injected
 * `fmtInt` built from useFormatPrefs().fmt(value, 0).
 */
function durationStr(minutes: number, fmtInt: (value: number) => string): string {
  const h = Math.floor(minutes / 60);
  const m = fmtInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface RecentDrivesSectionProps {
  drives: Drive[] | undefined;
}

/** Mirrors the web @/components/ui Column<T> surface used by this section. */
interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: number;
}

function useDriveColumns(prefs: FormatPrefs): Column<Drive>[] {
  const t = useNativeTranslation();
  const fmtInt = (value: number): string => prefs.fmt(value, 0);
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: d => formatDateTime(d.start_ts),
      width: 184,
    },
    {
      key: 'distance',
      header: t('common.distance', 'Distance'),
      render: d =>
        `${prefs.fmt(
          convertDistanceFromSI(d.distance_m ?? 0, prefs.distanceUnit),
        )} ${prefs.distanceUnit}`,
      sortable: true,
      width: 120,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: d => durationStr((d.duration_s ?? 0) / 60, fmtInt),
      width: 120,
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: d =>
        d.start_soc_pct != null && d.end_soc_pct != null
          ? `${d.start_soc_pct}% \u2192 ${d.end_soc_pct}%`
          : DASH,
      width: 132,
    },
  ];
}

interface DriveTableProps {
  columns: Column<Drive>[];
  data: Drive[];
  keyExtractor: (row: Drive) => RowKey;
  compact?: boolean;
  pagination?: boolean;
  emptyMessage: string;
}

/**
 * Focused native DataTable for this section, modelled on the established
 * apps/native table pattern (TeslaChargingHistoryPage): a horizontal ScrollView
 * of fixed-width columns, header row, body rows via col.render, compact density,
 * and paginate-by-25 with prev/next. Sortable columns are accepted for parity
 * but, as in the web call site (no onSort handler is wired), sorting is a no-op:
 * rows render in the order received.
 */
function DriveTable({
  columns,
  data,
  keyExtractor,
  compact,
  pagination,
  emptyMessage,
}: DriveTableProps) {
  const t = useNativeTranslation();
  const [page, setPage] = useState(0);

  const totalWidth = columns.reduce(
    (sum, col) => sum + (col.width ?? DEFAULT_COL_WIDTH),
    0,
  );
  const pageCount = pagination
    ? Math.max(1, Math.ceil(data.length / ROWS_PER_PAGE))
    : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = pagination
    ? data.slice(
        clampedPage * ROWS_PER_PAGE,
        clampedPage * ROWS_PER_PAGE + ROWS_PER_PAGE,
      )
    : data;
  const rangeStart = data.length === 0 ? 0 : clampedPage * ROWS_PER_PAGE + 1;
  const rangeEnd = pagination
    ? Math.min(clampedPage * ROWS_PER_PAGE + ROWS_PER_PAGE, data.length)
    : data.length;
  const cellPad = compact ? styles.cellCompact : styles.cellComfortable;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{width: totalWidth}}>
          <View style={styles.headerRow}>
            {columns.map(col => (
              <View
                key={col.key}
                style={[
                  styles.headerCell,
                  cellPad,
                  {width: col.width ?? DEFAULT_COL_WIDTH},
                ]}>
                <AppText tone="muted" variant="caption" weight="semibold">
                  {col.header}
                </AppText>
              </View>
            ))}
          </View>
          {pageRows.length === 0 ? (
            <View style={styles.tableEmptyRow}>
              <AppText tone="muted" variant="caption">
                {emptyMessage}
              </AppText>
            </View>
          ) : (
            pageRows.map(row => (
              <View key={String(keyExtractor(row))} style={styles.bodyRow}>
                {columns.map(col => (
                  <View
                    key={col.key}
                    style={[
                      styles.bodyCell,
                      cellPad,
                      {width: col.width ?? DEFAULT_COL_WIDTH},
                    ]}>
                    <AppText variant="caption">{col.render(row)}</AppText>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
      {pagination && data.length > 0 ? (
        <View style={styles.paginationRow}>
          <AppText tone="muted" variant="caption">
            {rangeStart}
            {'\u2013'}
            {rangeEnd} {t('table.of', 'of')} {data.length}
          </AppText>
          <View style={styles.pageNavRow}>
            <Pressable
              accessibilityLabel={t('table.prev', 'Previous')}
              accessibilityRole="button"
              accessibilityState={{disabled: clampedPage <= 0}}
              disabled={clampedPage <= 0}
              hitSlop={4}
              onPress={() => setPage(p => Math.max(0, p - 1))}
              style={({pressed}) => [
                styles.pageNavBtn,
                clampedPage <= 0 && styles.buttonDisabled,
                pressed && clampedPage > 0 && styles.pressed,
              ]}>
              <SemanticIcon decorative name="previous" size="sm" />
            </Pressable>
            <AppText tone="secondary" variant="caption">
              {clampedPage + 1}/{pageCount}
            </AppText>
            <Pressable
              accessibilityLabel={t('table.next', 'Next')}
              accessibilityRole="button"
              accessibilityState={{disabled: clampedPage >= pageCount - 1}}
              disabled={clampedPage >= pageCount - 1}
              hitSlop={4}
              onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              style={({pressed}) => [
                styles.pageNavBtn,
                clampedPage >= pageCount - 1 && styles.buttonDisabled,
                pressed && clampedPage < pageCount - 1 && styles.pressed,
              ]}>
              <SemanticIcon decorative name="next" size="sm" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function RecentDrivesSection({drives}: RecentDrivesSectionProps) {
  const t = useNativeTranslation();
  const prefs = useFormatPrefs();
  const driveColumns = useDriveColumns(prefs);

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <SemanticIcon decorative name="drives" size="sm" />
          <AppText style={styles.title}>
            {t('common.recentDrives', 'Recent Drives')}
          </AppText>
        </View>
        <Pressable accessibilityRole="link" hitSlop={4} style={styles.viewAll}>
          <AppText tone="muted" variant="caption">
            {t('common.viewAll', 'View all')}
          </AppText>
          <AppText tone="muted" variant="caption">
            {'\u203A'}
          </AppText>
        </Pressable>
      </View>
      {drives && drives.length > 0 ? (
        <DriveTable
          columns={driveColumns}
          compact
          data={drives}
          emptyMessage={t('common.noDrives', 'No drives recorded yet')}
          keyExtractor={d => d.id}
          pagination
        />
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View style={styles.emptyState}>
          <SemanticIcon decorative name="drives" size="lg" />
          <AppText style={styles.emptyText} tone="muted">
            {t('common.noDrives', 'No drives recorded yet')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 24,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  viewAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  headerCell: {
    justifyContent: 'center',
  },
  bodyRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  bodyCell: {
    justifyContent: 'center',
  },
  cellCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cellComfortable: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  tableEmptyRow: {
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  paginationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  pageNavRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  pageNavBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
});

export default RecentDrivesSection;
