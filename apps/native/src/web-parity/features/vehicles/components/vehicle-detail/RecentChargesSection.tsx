// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/RecentChargesSection.tsx.
//
// The web component is the vehicle-detail "Recent Charges" section: a GlassPanel
// (p-6) with a header row (a neon-green BatteryCharging icon + a bold "Recent
// Charges" title on the left, and a muted "View all ›" react-router <Link
// to="/charging"> on the right) and, when `sessions` has at least one row, a
// compact paginated DataTable of five columns —
//   1. Date     — formatDateTime(s.start_ts)
//   2. Energy   — `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'))} kWh`  (sortable)
//   3. Duration — durationStr(s.duration_min)
//   4. Cost     — s.cost != null ? formatCurrency(s.cost) : '—'
//   5. Battery  — s.end_soc_pct != null ? `${s.start_soc_pct}% → ${s.end_soc_pct}%` : `${s.start_soc_pct}%`
// When `sessions` is empty/undefined the section shows an EmptyState
// (BatteryCharging icon + "No charging sessions recorded yet").
//
// This native port preserves that contract 1:1 — the same `sessions` prop, the
// same five columns / headers / render expressions, the same `?? 0` / `!= null`
// null-safety, the same SI watt-hours → kWh convert-at-display unit handling,
// the same `tableId="vehicles:detail-recent-charges"` + `compact` + `pagination`
// DataTable flags, every i18n key + English default, and the same visual intent
// — using React Native primitives, the existing native GlassPanel + AppText +
// design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-router-dom <Link to="/charging"> (web L1): React Native has no DOM
//     anchor / browser-history router, so the "View all" link becomes a Pressable
//     with accessibilityRole="link" and navigation delegated to an optional
//     onNavigate(to) bridge prop (the established QuickNav / HistoryListRow
//     precedent). Without a bridge a press is an explicit no-op; the `/charging`
//     path is preserved verbatim. The hover:text-neon-green colour shift has no
//     native equivalent and is replaced by a subtle pressed-opacity feedback.
//   - react-i18next useTranslation (web L2): no native i18next runtime → inline
//     useNativeTranslation() returns t(key, fallback) = fallback, preserving every
//     key + English default verbatim (common.recentCharges, common.viewAll,
//     common.date, common.energy, common.duration, common.cost, common.battery,
//     common.noCharges).
//   - lucide-react BatteryCharging / ChevronRight (web L3): DOM SVG icons →
//     semantic glyph stand-ins — 🔋 (BatteryCharging, the sibling
//     ChargingTelemetrySection / QuickNav convention) and the › guillemet
//     (ChevronRight, the QuickNav / Pagination convention).
//   - @/components/ui GlassPanel + DataTable + type Column (web L5): GlassPanel →
//     native GlassPanel; DataTable + Column<T> have no native parity port yet, so
//     a minimal native-safe DataTable<T> + Column<T> are reproduced locally (the
//     established XRayFieldsTable precedent) supporting exactly the props this
//     component passes (tableId / columns / data / keyExtractor / compact /
//     pagination / emptyMessage). The web DataTable does NOT sort internally
//     (sorting is caller-delegated via onSort/sortKey/sortDir, which this usage
//     does not pass), so the `sortable` energy column is an inert affordance here
//     exactly as on the web (no arrow, rows render in array order); pagination
//     defaults (pageSize 25, options [20,50,100]) mirror the web DataTable.
//   - @/components/feedback EmptyState (web L6): → a local native-safe icon +
//     message EmptyState mirroring the web layout (centred column, muted icon
//     above a centred message).
//   - @/lib/dateFormat formatDateTime (web L7): inlined port — null/Date/string
//     guard → '—' for unrenderable input, else toLocaleString with the same
//     year/month/day/hour/minute fields and browser-default locale.
//   - @/lib/numberFormat fmtNumber (web L8): inlined port — safeNumber guard +
//     toLocaleString('en-US', min/maxFractionDigits) with a toFixed fallback;
//     default precision 2 (the web global default). fmtInt = fmtNumber(v, 0).
//   - @/lib/unitConversion convertEnergyFromSI (web L9): inlined for the only
//     consumed arm — Wh → kWh (wh / 1000).
//   - @/hooks/useFormatting useFormatting (web L10): only formatCurrency is
//     consumed, so a scoped native useFormatCurrency() is reproduced reading the
//     same web-parity useSettings() query (currency_symbol → '$' fallback,
//     decimal_precision → floored non-negative finite else 2) and formatting as
//     `${symbol}${fmtNumber(amount, decimals ?? precision)}` exactly like the web
//     hook (the weekly-digest ChargingSection precedent).
//   - @/api/types ChargingSession (web L11): imported from the already-ported
//     native web-parity api/types so the prop contract is identical (all consumed
//     fields — id, start_ts, total_energy_added_wh, duration_min, cost,
//     start_soc_pct, end_soc_pct — exist there with identical types).
//   - ./helpers durationStr (web L12): ported verbatim — h = floor(min/60),
//     m = fmtInt(min % 60); `${h}h ${m}m` when h > 0 else `${m}m`.
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {ChargingSession} from '../../../../api/types';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../theme/tokens';

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

/* ── lucide-react glyph stand-ins (web L3) ─────────────────────────────────── */

const ICON_BATTERY_CHARGING = '\uD83D\uDD0B'; // 🔋 (BatteryCharging)
const GLYPH_CHEVRON_RIGHT = '\u203A'; // › (ChevronRight)
const NEON_GREEN = '#10b981'; // --neon-green (tailwind neon green base)
const EMPTY_DISPLAY = '\u2014'; // '—'
const SOC_ARROW = '\u2192'; // '→'

/* ── numberFormat: fmtNumber / fmtInt (web @/lib/numberFormat) ─────────────── */

function fmtNumber(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/* ── unitConversion: convertEnergyFromSI (web @/lib/unitConversion) ────────── */
// Only the 'kWh' arm is consumed by this component (Wh -> kWh).

function convertEnergyFromSI(wh: number): number {
  return wh / 1000;
}

/* ── dateFormat: formatDateTime (web @/lib/dateFormat) ─────────────────────── */
// "Apr 4, 2026, 2:30 AM" — '—' for null / unparseable input, browser-default locale.

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return EMPTY_DISPLAY;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return EMPTY_DISPLAY;
  }
  try {
    return d.toLocaleString(undefined, {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d.toISOString();
  }
}

/* ── helpers: durationStr (web ./helpers) ──────────────────────────────────── */

function durationStr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = fmtInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ── scoped native formatCurrency (web @/hooks/useFormatting formatCurrency) ─ */

function useFormatCurrency(): (amount: number, decimals?: number) => string {
  const {data: settings} = useSettings();
  const symbolRaw = settings?.currency_symbol;
  const currencySymbol = symbolRaw && symbolRaw.trim() ? symbolRaw : '$';
  const precisionRaw = settings?.decimal_precision;
  const userPrecision =
    typeof precisionRaw === 'number' &&
    Number.isFinite(precisionRaw) &&
    precisionRaw >= 0
      ? Math.floor(precisionRaw)
      : 2;

  return useMemo(
    () =>
      (amount: number, decimals?: number): string =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
}

/* ── Local native-safe DataTable (reproduce @/components/ui DataTable) ─────── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface PaginationConfig {
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  /** Legacy boolean density toggle (web `compact`): tighter rows. */
  compact?: boolean;
  pagination?: boolean | PaginationConfig;
}

function isTextNode(node: ReactNode): node is string | number {
  return typeof node === 'string' || typeof node === 'number';
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No data',
  compact,
  pagination,
}: DataTableProps<T>) {
  const paginationEnabled = !!pagination;
  const paginationConfig: PaginationConfig =
    typeof pagination === 'object' ? pagination : {};
  const defaultPageSize = paginationConfig.defaultPageSize ?? 25;
  const pageSizeOptions = paginationConfig.pageSizeOptions ?? [20, 50, 100];

  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const pageCount =
    paginationEnabled && data.length > 0 ? Math.ceil(data.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount);
  const visible = paginationEnabled
    ? data.slice((safePage - 1) * pageSize, safePage * pageSize)
    : data;

  const changePageSize = useCallback((next: number) => {
    setPageSize(next);
    setPage(1);
  }, []);

  const bodyRowStyle = compact
    ? [styles.tableRow, styles.tableBodyRow, styles.tableBodyRowCompact]
    : [styles.tableRow, styles.tableBodyRow];
  const cellStyle = compact
    ? [styles.tableCell, styles.tableCellCompact]
    : styles.tableCell;

  return (
    <View accessibilityLabel={tableId} style={styles.tableWrap} testID={tableId}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {columns.map(col => (
          <View key={col.key} style={cellStyle}>
            <AppText
              numberOfLines={1}
              style={styles.tableHeaderText}
              tone="secondary"
              weight="semibold">
              {col.header}
            </AppText>
          </View>
        ))}
      </View>

      {visible.length === 0 ? (
        <View
          style={styles.tableEmptyRow}
          testID={tableId ? `${tableId}-empty` : undefined}>
          <AppText style={styles.tableEmptyText} tone="muted">
            {emptyMessage}
          </AppText>
        </View>
      ) : (
        visible.map(row => {
          const rowKey = keyExtractor(row);
          return (
            <View
              key={String(rowKey)}
              style={bodyRowStyle}
              testID={tableId ? `${tableId}-row-${rowKey}` : undefined}>
              {columns.map(col => {
                const content = col.render(row);
                return (
                  <View key={col.key} style={cellStyle}>
                    {isTextNode(content) ? (
                      <AppText numberOfLines={1} style={styles.tableCellText}>
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
        })
      )}

      {paginationEnabled && data.length > 0 ? (
        <View
          style={styles.pager}
          testID={tableId ? `${tableId}-pager` : undefined}>
          <View style={styles.pageSizeRow}>
            {pageSizeOptions.map(size => {
              const selected = size === pageSize;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={size}
                  onPress={() => changePageSize(size)}
                  style={({pressed}) => [
                    styles.pageSizeChip,
                    selected ? styles.pageSizeChipActive : null,
                    pressed ? styles.pressed : null,
                  ]}>
                  <AppText
                    style={styles.pageSizeText}
                    tone={selected ? 'accent' : 'muted'}>
                    {String(size)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.pagerNav}>
            <Pressable
              accessibilityRole="button"
              disabled={safePage <= 1}
              onPress={() => setPage(p => Math.max(1, p - 1))}
              style={({pressed}) => [
                styles.pagerButton,
                safePage <= 1 || pressed ? styles.pressed : null,
              ]}>
              <AppText style={styles.pagerLabel} tone="secondary">
                {'\u2039'}
              </AppText>
            </Pressable>
            <AppText style={styles.pagerInfo} tone="muted">
              {`${safePage} / ${pageCount}`}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={safePage >= pageCount}
              onPress={() => setPage(p => Math.min(pageCount, p + 1))}
              style={({pressed}) => [
                styles.pagerButton,
                safePage >= pageCount || pressed ? styles.pressed : null,
              ]}>
              <AppText style={styles.pagerLabel} tone="secondary">
                {GLYPH_CHEVRON_RIGHT}
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ── EmptyState (native-safe port of @/components/feedback EmptyState) ──────── */

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View
      accessibilityRole="text"
      accessible
      style={styles.emptyState}
      testID="recent-charges-empty">
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── ported: useChargeColumns (web L18-52) ─────────────────────────────────── */

function useChargeColumns(): Column<ChargingSession>[] {
  const t = useNativeTranslation();
  const formatCurrency = useFormatCurrency();
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: s => formatDateTime(s.start_ts),
    },
    {
      key: 'energy',
      header: t('common.energy', 'Energy'),
      render: s =>
        `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh ?? 0))} kWh`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: s => durationStr(s.duration_min),
    },
    {
      key: 'cost',
      header: t('common.cost', 'Cost'),
      render: s => (s.cost != null ? formatCurrency(s.cost) : EMPTY_DISPLAY),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: s =>
        s.end_soc_pct != null
          ? `${s.start_soc_pct}% ${SOC_ARROW} ${s.end_soc_pct}%`
          : `${s.start_soc_pct}%`,
    },
  ];
}

/* ── ported: RecentChargesSection (web L54-92) ─────────────────────────────── */

interface RecentChargesSectionProps {
  sessions: ChargingSession[] | undefined;
  /**
   * Native bridge for the web react-router <Link to="/charging">. Invoked with
   * the `/charging` path when "View all" is pressed. The web file takes only
   * `sessions`; this is the sole native-navigation addition. Without it a press
   * is an explicit no-op.
   */
  onNavigate?: (to: string) => void;
}

export function RecentChargesSection({
  sessions,
  onNavigate,
}: RecentChargesSectionProps) {
  const t = useNativeTranslation();
  const chargeColumns = useChargeColumns();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.titleGroup}>
          <AppText style={styles.titleIcon}>{ICON_BATTERY_CHARGING}</AppText>
          <AppText style={styles.title} weight="bold">
            {t('common.recentCharges', 'Recent Charges')}
          </AppText>
        </View>
        <Pressable
          accessibilityLabel={t('common.viewAll', 'View all')}
          accessibilityRole="link"
          onPress={() => onNavigate?.('/charging')}
          style={({pressed}) => [
            styles.viewAll,
            pressed ? styles.pressed : null,
          ]}>
          <AppText style={styles.viewAllText} tone="muted">
            {t('common.viewAll', 'View all')}
          </AppText>
          <AppText style={styles.viewAllChevron} tone="muted">
            {GLYPH_CHEVRON_RIGHT}
          </AppText>
        </Pressable>
      </View>
      {sessions && sessions.length > 0 ? (
        <DataTable<ChargingSession>
          tableId="vehicles:detail-recent-charges"
          columns={chargeColumns}
          data={sessions}
          keyExtractor={s => s.id}
          compact
          pagination
          emptyMessage={t(
            'common.noCharges',
            'No charging sessions recorded yet',
          )}
        />
      ) : (
        <EmptyState
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available (web L85).
          icon={<AppText style={styles.emptyGlyph}>{ICON_BATTERY_CHARGING}</AppText>}
          message={t('common.noCharges', 'No charging sessions recorded yet')}
        />
      )}
    </GlassPanel>
  );
}

RecentChargesSection.displayName = 'RecentChargesSection';

const styles = StyleSheet.create({
  emptyGlyph: {
    color: colors.textMuted, // text-muted
    fontSize: 32, // h-8 w-8
  },
  emptyIcon: {
    marginBottom: 16, // mb-4
  },
  emptyMessage: {
    maxWidth: 448, // max-w-md
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64, // py-16
  },
  pageSizeChip: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pageSizeChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  pageSizeRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  pageSizeText: {
    fontSize: typography.caption,
  },
  pager: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pagerButton: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pagerInfo: {
    fontSize: typography.caption,
  },
  pagerLabel: {
    fontSize: 14,
  },
  pagerNav: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  panel: {
    padding: spacing.lg + 4, // p-6 (24px)
  },
  pressed: {
    opacity: 0.7,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16, // mb-4
  },
  tableBodyRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tableBodyRowCompact: {
    minHeight: 32, // compact density
  },
  tableCell: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tableCellCompact: {
    paddingVertical: spacing.xs, // compact density
  },
  tableCellText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  tableEmptyRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  tableEmptyText: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  tableHeaderRow: {
    backgroundColor: colors.surfaceRaised,
  },
  tableHeaderText: {
    fontSize: typography.caption,
  },
  tableRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  tableWrap: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  title: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 18, // text-lg
  },
  titleGroup: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2
    flexDirection: 'row',
  },
  titleIcon: {
    color: NEON_GREEN, // text-[var(--neon-green)]
    fontSize: 16, // h-4 w-4
  },
  viewAll: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1
    flexDirection: 'row',
  },
  viewAllChevron: {
    fontSize: 12, // h-3 w-3
  },
  viewAllText: {
    fontSize: 12, // text-xs
  },
});
