// Native parity port of web/src/features/trips/pages/TripListPage.tsx.
//
// TripListPage is the multi-drive trip report: a header (title / subtitle /
// actions), a four-up summary grid (Total Distance / Energy Used / Total Cost /
// Total Trips), a "Top Trips by Distance" horizontal bar chart with CSV + JSON
// export actions, the trip list (one TripRow per trip), and a pagination bar.
// Loading swaps the summary grid for skeleton tiles; an empty trip list shows an
// EmptyState; the whole body is wrapped in pull-to-refresh.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Pagination, Button), the data-display kit (MetricCard, InlineMetric,
// SavedViewMenu, DataFreshnessAuto), the Recharts BarChart tree via
// @/components/charts, the forms kit (RangePicker, VehicleSelect), EmptyState /
// Skeleton, framer-motion FadeIn, the mobile PullToRefresh, lucide-react icons,
// react-i18next, the react-router URL-state hooks (useUrlNumber / useUrlString /
// useUrlBatch / useSavedViewUrl), the selected-vehicle store (useSelectedVehicle),
// useUnits / useFormatting, usePageTitle, the @/lib helpers (convertDistanceFromSI,
// formatDate, fmtInt, exportAsCSV / exportAsJSON). React Native has no DOM, no
// Recharts/SVG, no Tailwind, no lucide, no react-router URL state, no
// localStorage-backed vehicle store, no wired react-i18next, no document.title and
// no Blob/anchor file download, so this port reproduces the same behaviour with RN
// primitives + the established native parity building blocks and documents every
// adaptation in the sidecar:
//
//   - PageContainer (title/subtitle/actions + loading) -> an inline ScrollView
//     scaffold: a header (title + subtitle + actions row) plus the body. The
//     `loading` prop maps to the source's own `isLoading ? Skeleton : MetricCards`
//     summary-grid swap (web L159-200), reproduced verbatim with native skeleton
//     tiles. usePageTitle(t('trips.title')) sets the browser tab title, which has
//     no native analogue, so the same translated string is surfaced as the header.
//   - useSelectedVehicle() (URL > store > first vehicle) has no native router/store;
//     `vehicleId` keeps its exact name as local state seeded to the first
//     useVehicles() vehicle (the same "default to first vehicle" contract), driven
//     by a native segmented VehicleSelect (the CostAnalysisPage idiom).
//   - useUrlNumber('page'/'size') + useUrlString('from'/'to') + useUrlBatch have no
//     native URL; `page`/`setPage`, `pageSize`, `startDate`, `endDate` and
//     `setRangeBatch` keep their exact names as local state, preserving the
//     "set page to null -> reset to 1" semantics of useUrlBatch.
//   - useUnits (unitPrefs.distance / formatEnergy) + useFormatting (formatCurrency)
//     are derived from the native useSettings AppSettings query exactly as the web
//     hooks derive them (distance = unit_of_length === 'mi' ? 'mi' : 'km';
//     formatEnergy = convertEnergyFromSI(wh,'kWh') at the user precision;
//     formatCurrency = currencySymbol + fmtNumber(amount, decimal_precision)). The
//     SI converters convertDistanceFromSI / convertEnergyFromSI and the
//     fmtInt / fmtNumber / formatDate helpers are inlined verbatim from the web
//     @/lib modules (en-US grouping stands in for the not-yet-wired global locale,
//     matching the sibling CostAnalysisPage port).
//   - The Recharts horizontal BarChart (top-10 trips by distance) -> a native
//     per-trip horizontal progress bar preserving the same sort/slice(0,10) +
//     convertDistanceFromSI data and the ChartContainer title + accessible
//     data-table intent (bar labels + values) + the CSV/JSON export actions +
//     EmptyState. exportAsCSV / exportAsJSON keep their verbatim CSV/JSON
//     serialisation; the browser Blob+anchor download has no native analogue, so
//     the serialised content is handed to the RN Share sheet (documented).
//   - MetricCard (4 colours + icon + subtitle) -> a native SummaryStat tile
//     preserving the cyan/amber/green/purple accent per card and the subtitle.
//   - InlineMetric (calendar/clock icon + value) inside TripRow -> the same
//     date/duration values rendered as muted captions (the 12px inline glyphs are
//     simplified to text; the data is identical).
//   - SavedViewMenu (URL-saved views) + DataFreshnessAuto (live freshness) are
//     browser-only and omitted (documented), matching the AlertsListPage port.
//   - framer-motion FadeIn is dropped (children render directly); PullToRefresh ->
//     the native RefreshControl wired to the same `await refetchTrips()` onRefresh.
//   - react-i18next useTranslation -> a native English-default `t` that keeps every
//     trips.* / pagination.* key verbatim and reproduces i18next {{var}}
//     interpolation (count / start / end / total / page / totalPages).
//
// State names (page, pageSize, startDate, endDate, vehicleId), the useTrips params
// (vehicle_id / limit / offset / start / end), the summary reduces, the chartData
// sort/slice/map, the estimatedTotal pagination heuristic, the totalDistDisplay
// fix, formatDuration, and every snake_case field read are preserved. The one
// rename is the summary reduce accumulator/param: web `(s, t) =>` becomes
// `(sum, trip) =>` to avoid shadowing the i18n `t` — behaviour is identical. No
// DOM, Recharts, Leaflet, lucide-react, framer-motion, or old web UI components
// are imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type DimensionValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppButton} from '../../../../components/ui/AppButton';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useSettings, type AppSettings} from '../../../api/hooks/useSettings';
import {useTrips, type Trip} from '../../../api/hooks/useTrips';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback ───────────────────────────────────────────────────────── */

// react-i18next is not wired in native; i18next returns the supplied default (or
// the key itself when no default is given) when a translation is missing, so the
// fallback returns the English default while keeping every key verbatim and
// reproducing i18next's {{var}} interpolation.
type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, options?: TVars) => string;

function interpolate(template: string, options: TVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = options[name];
    return value === undefined ? '' : String(value);
  });
}

const t: TFunc = (key, fallback, options) => {
  const base = fallback ?? key;
  return options ? interpolate(base, options) : base;
};

/* ─── Number + date formatters (mirror @/lib/numberFormat + @/lib/dateFormat) ─ */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.isFiniteNumber.
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Mirrors web lib/numberFormat.fmtNumber. en-US grouping stands in for the
// not-yet-ported global locale/precision (same precedent as CostAnalysisPage).
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// Mirrors web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Mirrors web lib/dateFormat.formatDate ("Apr 4, 2025"; nullish / unparseable ->
// em dash). Device locale stands in for the optional locale override.
function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ─── SI converters (verbatim from web @/lib/unitConversion) ────────────────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type EnergyUnitPref = 'Wh' | 'kWh';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    default:
      return meters / METERS_PER_KM;
  }
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  return to === 'Wh' ? wh : wh / 1000;
}

// Mirrors web useUnits.deriveDistance: unit_of_length === 'mi' -> 'mi' else 'km'.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// Mirrors web useUnits.formatEnergy: default energy pref 'kWh', precision falls
// back to the lib DEFAULT_PRECISION.energy (2) when the user precision is unset.
function formatEnergy(wh: number | null | undefined, precision: number): string {
  if (!isFiniteNumber(wh)) {
    return '—';
  }
  return `${fmtNumber(convertEnergyFromSI(wh, 'kWh'), precision)} kWh`;
}

// Wh/km -> Wh/(display unit) conversion uses an inline factor because
// @/lib/unitConversion does not yet expose a convertEfficiencyFromSI helper.
// Same precedent as FleetComparePage.whPerKmToDisplay (web L28-31).
const KM_PER_MILE = 1.609344;

function formatDuration(startDate: string, endDate: string | null): string {
  if (!endDate) {
    return 'In progress';
  }
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  const hours = Math.floor(ms / 3600000);
  const minsRaw = (ms % 3600000) / 60000;
  if (hours === 0) {
    return `${fmtInt(minsRaw)}m`;
  }
  return minsRaw >= 0.5 ? `${hours}h ${fmtInt(minsRaw)}m` : `${hours}h`;
}

/* ─── CSV / JSON export (verbatim serialisation from web @/lib/export) ───────── */

// Mirrors web lib/export.exportAsCSV column derivation + RFC-4180 escaping.
function buildCsv<T extends Record<string, unknown>>(data: T[]): string {
  const cols = Object.keys(data[0]).map(key => ({
    key: key as keyof T,
    label: String(key),
  }));
  const header = cols.map(c => c.label).join(',');
  const rows = data.map(row =>
    cols
      .map(c => {
        const val = row[c.key];
        if (val === null || val === undefined) {
          return '';
        }
        if (
          typeof val === 'string' &&
          (val.includes(',') || val.includes('"') || val.includes('\n'))
        ) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      })
      .join(','),
  );
  return [header, ...rows].join('\n');
}

// The browser Blob + anchor download has no native analogue; the serialised
// payload is handed to the RN Share sheet so the export intent is preserved.
async function shareExport(content: string, filename: string): Promise<void> {
  try {
    await Share.share({title: filename, message: content});
  } catch (error) {
    console.warn('[TripListPage] export share unavailable:', error);
  }
}

function exportAsCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
): void {
  if (!data.length) {
    return;
  }
  void shareExport(buildCsv(data), filename);
}

function exportAsJSON<T>(data: T[], filename: string): void {
  void shareExport(JSON.stringify(data, null, 2), filename);
}

/* ─── Summary stat tile (mirrors @/components/data-display MetricCard) ───────── */

type StatTone = 'accent' | 'success' | 'violet' | 'warning';

interface SummaryStatProps {
  label: string;
  value: string;
  glyph: string;
  tone: StatTone;
  subtitle: string;
}

function SummaryStat({label, value, glyph, tone, subtitle}: SummaryStatProps) {
  return (
    <GlassPanel style={styles.statCard}>
      <View style={styles.statRow}>
        <View style={styles.statTextCol}>
          <AppText
            variant="caption"
            tone="muted"
            weight="semibold"
            style={styles.statLabel}>
            {label}
          </AppText>
          <AppText variant="title" weight="bold">
            {value}
          </AppText>
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        </View>
        <View style={[styles.statChip, statChipTone[tone]]}>
          <AppText variant="caption" weight="bold" style={statGlyphTone[tone]}>
            {glyph}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

/* ─── Top-trips chart (mirrors Recharts horizontal BarChart) ─────────────────── */

interface ChartDatum {
  name: string;
  distance: number;
  energy: number;
}

interface TopTripsChartProps {
  data: ChartDatum[];
  distancePref: DistanceUnitPref;
  onExportCSV: () => void;
  onExportJSON: () => void;
}

function barWidth(value: number, max: number): DimensionValue {
  return `${Math.max((value / max) * 100, 6)}%` as DimensionValue;
}

function TopTripsChart({
  data,
  distancePref,
  onExportCSV,
  onExportJSON,
}: TopTripsChartProps) {
  const max = Math.max(...data.map(d => d.distance), 1);
  return (
    <GlassPanel style={styles.chartPanel}>
      <View style={styles.chartHeader}>
        <AppText weight="semibold">
          {t('trips.chart.title', 'Top Trips by Distance')}
        </AppText>
        <View style={styles.chartActions}>
          <AppButton
            label={t('trips.export.csv', 'CSV')}
            variant="ghost"
            onPress={onExportCSV}
          />
          <AppButton
            label={t('trips.export.json', 'JSON')}
            variant="ghost"
            onPress={onExportJSON}
          />
        </View>
      </View>
      {data.length > 0 ? (
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={t(
            'trips.chart.title.aria',
            'Top trips ranked by distance horizontal bar chart',
          )}
          style={styles.chartBars}>
          {data.map(d => (
            <View key={d.name} style={styles.chartRow}>
              <AppText
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                style={styles.chartLabel}>
                {d.name}
              </AppText>
              <View style={styles.chartTrack}>
                <View
                  style={[styles.chartFill, {width: barWidth(d.distance, max)}]}
                />
              </View>
              <AppText
                variant="caption"
                tone="secondary"
                style={styles.chartValue}>
                {`${fmtInt(d.distance)} ${distancePref}`}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          title={t('trips.chart.emptyTitle', 'No Data')}
          message={t('trips.chart.empty', 'No trip data to chart')}
        />
      )}
    </GlassPanel>
  );
}

/* ─── Trip row ───────────────────────────────────────────────────────────────── */

interface TripRowProps {
  trip: Trip;
  distancePref: DistanceUnitPref;
  efficiencyUnit: string;
  userPrecision: number;
  formatCurrency: (amount: number, decimals?: number) => string;
}

function TripRow({
  trip,
  distancePref,
  efficiencyUnit,
  userPrecision,
  formatCurrency,
}: TripRowProps) {
  const whPerKm =
    trip.total_distance_m > 0
      ? trip.total_energy_wh / (trip.total_distance_m / 1000)
      : 0;
  const efficiencyDisplay =
    distancePref === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const distanceDisplay = convertDistanceFromSI(trip.total_distance_m, distancePref);

  return (
    <GlassPanel style={styles.rowPanel}>
      <View style={styles.rowMain}>
        <View style={styles.rowIcon}>
          <AppText variant="caption" weight="bold" style={styles.rowIconText}>
            TR
          </AppText>
        </View>
        <View style={styles.rowInfo}>
          <AppText weight="semibold" numberOfLines={1}>
            {trip.name ?? `${t('trips.row.trip', 'Trip')} #${trip.id}`}
          </AppText>
          <View style={styles.rowMetaRow}>
            <AppText variant="caption" tone="muted">
              {formatDate(trip.start_date)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {formatDuration(trip.start_date, trip.end_date ?? null)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('trips.row.drives', '{{count}} drives', {
                count: trip.drive_count,
              })}
            </AppText>
            {trip.charge_count > 0 ? (
              <AppText variant="caption" tone="muted">
                {t('trips.row.charges', '{{count}} charges', {
                  count: trip.charge_count,
                })}
              </AppText>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.rowStats}>
        <View style={styles.rowStat}>
          <AppText weight="bold">{`${fmtInt(distanceDisplay)} ${distancePref}`}</AppText>
          <AppText variant="caption" tone="muted">
            {t('trips.row.drives', '{{count}} drives', {
              count: trip.drive_count,
            })}
          </AppText>
        </View>
        <View style={styles.rowStat}>
          <AppText weight="bold" style={styles.rowEnergy}>
            {formatEnergy(trip.total_energy_wh, userPrecision)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {trip.total_distance_m > 0
              ? `${fmtInt(efficiencyDisplay)} ${efficiencyUnit}`
              : `0 ${efficiencyUnit}`}
          </AppText>
        </View>
        {trip.total_cost > 0 ? (
          <View style={styles.rowStat}>
            <AppText weight="bold" style={styles.rowCost}>
              {formatCurrency(trip.total_cost)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('trips.row.cost', 'cost')}
            </AppText>
          </View>
        ) : null}
      </View>
    </GlassPanel>
  );
}

/* ─── Vehicle select (mirrors the header VehicleSelect / useSelectedVehicle) ─── */

interface VehicleOption {
  id: number;
  label: string;
}

interface VehicleSelectProps {
  options: VehicleOption[];
  value: number | null;
  onChange: (id: number) => void;
}

function VehicleSelect({options, value, onChange}: VehicleSelectProps) {
  if (options.length === 0) {
    return null;
  }
  return (
    <View testID="trip-list-vehicle-select" style={styles.segment}>
      {options.map(opt => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(opt.id)}
            style={[styles.segmentItem, active && styles.segmentItemActive]}>
            <AppText
              variant="caption"
              tone={active ? 'accent' : 'secondary'}
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Range picker (mirrors the forms RangePicker preset behaviour) ──────────── */

interface RangeValue {
  start: string;
  end: string;
}

interface RangePickerProps {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
}

const RANGE_PRESETS = [
  {labelKey: 'trips.range.30d', label: '30D', days: 30},
  {labelKey: 'trips.range.90d', label: '90D', days: 90},
  {labelKey: 'trips.range.1y', label: '1Y', days: 365},
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function RangePicker({value, onChange}: RangePickerProps) {
  const today = isoToday();
  return (
    <View testID="trip-list-range" style={styles.segment}>
      {RANGE_PRESETS.map(preset => {
        const start = isoDaysAgo(preset.days);
        const active = value.start === start && value.end === today;
        return (
          <Pressable
            key={preset.label}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange({start, end: today})}
            style={[styles.segmentItem, active && styles.segmentItemActive]}>
            <AppText variant="caption" tone={active ? 'accent' : 'secondary'}>
              {t(preset.labelKey, preset.label)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Pagination (mirrors the @/components/ui Pagination contract) ───────────── */

const PAGE_SIZE_OPTIONS = [25, 50, 100];

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const atStart = page <= 1;
  const atEnd = page >= totalPages;
  return (
    <View testID="trip-list-pagination" style={styles.pagination}>
      <AppText variant="caption" tone="muted">
        {t('pagination.range', '{{start}}–{{end}} of {{total}}', {
          start,
          end,
          total,
        })}
      </AppText>
      <View style={styles.paginationControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{disabled: atStart}}
          disabled={atStart}
          onPress={() => onPageChange(page - 1)}
          style={[styles.pageButton, atStart && styles.pageButtonDisabled]}>
          <AppText variant="caption" tone={atStart ? 'muted' : 'accent'}>
            {t('pagination.prev', 'Prev')}
          </AppText>
        </Pressable>
        <AppText variant="caption" tone="secondary">
          {t('pagination.page', 'Page {{page}} of {{totalPages}}', {
            page,
            totalPages,
          })}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{disabled: atEnd}}
          disabled={atEnd}
          onPress={() => onPageChange(page + 1)}
          style={[styles.pageButton, atEnd && styles.pageButtonDisabled]}>
          <AppText variant="caption" tone={atEnd ? 'muted' : 'accent'}>
            {t('pagination.next', 'Next')}
          </AppText>
        </Pressable>
      </View>
      <View style={styles.pageSizeRow}>
        {PAGE_SIZE_OPTIONS.map(size => {
          const active = size === pageSize;
          return (
            <Pressable
              key={size}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onPageSizeChange(size)}
              style={[styles.segmentItem, active && styles.segmentItemActive]}>
              <AppText variant="caption" tone={active ? 'accent' : 'secondary'}>
                {String(size)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */

interface RangeBatchPatch {
  from?: string;
  to?: string;
  size?: string;
  page?: number | null;
}

export default function TripListPage() {
  // usePageTitle (document.title) has no native analogue — the same translated
  // title renders in the on-screen header below.
  const pageTitle = t('trips.title', 'Trips');

  const settingsQuery = useSettings();
  const settings: AppSettings | undefined = settingsQuery.data;
  const distancePref = deriveDistance(settings?.unit_of_length);
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const formatCurrency = useCallback(
    (amount: number, decimals?: number) =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  // useSettings retained for the legacy efficiencyUnit label string only (web L65).
  const efficiencyUnit = distancePref === 'mi' ? 'Wh/mi' : 'Wh/km';

  // useSelectedVehicle() (URL > store > first vehicle) -> local `vehicleId` seeded
  // to the first vehicle, the same "default to first vehicle" contract.
  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (vehicleId == null && vehicleList.length > 0) {
      setVehicleId(vehicleList[0].id);
    }
  }, [vehicleId, vehicleList]);
  const vehicleOptions: VehicleOption[] = vehicleList.map(v => ({
    id: v.id,
    label: v.display_name,
  }));

  // URL state (useUrlNumber / useUrlString / useUrlBatch) -> local state keeping
  // the exact names + the "page=null resets to 1" useUrlBatch semantics.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const setRangeBatch = useCallback((patch: RangeBatchPatch) => {
    if (patch.from !== undefined) {
      setStartDate(patch.from);
    }
    if (patch.to !== undefined) {
      setEndDate(patch.to);
    }
    if (patch.size !== undefined) {
      setPageSize(Number(patch.size));
    }
    if (patch.page === null) {
      setPage(1);
    } else if (patch.page !== undefined) {
      setPage(patch.page);
    }
  }, []);

  const tripsQuery = useTrips({
    vehicle_id: vehicleId ?? undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    start: startDate,
    end: endDate,
  });
  const {data: trips, isLoading, refetch: refetchTrips} = tripsQuery;

  // web `const allTrips = trips ?? []` -> memoised so the chart/export deps stay
  // referentially stable (react-hooks/exhaustive-deps); value is identical.
  const allTrips = useMemo(() => trips ?? [], [trips]);

  // Summary stats. (web reduce accumulator/param `(s, t)` -> `(sum, trip)` to
  // avoid shadowing the i18n `t`; arithmetic is identical.)
  const totalDist = allTrips.reduce((sum, trip) => sum + trip.total_distance_m, 0);
  const totalEnergy = allTrips.reduce((sum, trip) => sum + trip.total_energy_wh, 0);
  const totalCost = allTrips.reduce((sum, trip) => sum + trip.total_cost, 0);
  const totalDrives = allTrips.reduce((sum, trip) => sum + trip.drive_count, 0);

  // Bar chart: top 10 trips by distance.
  const chartData = useMemo<ChartDatum[]>(
    () =>
      [...allTrips]
        .sort((a, b) => b.total_distance_m - a.total_distance_m)
        .slice(0, 10)
        .map(trip => ({
          name: trip.name ?? `Trip ${trip.id}`,
          distance: convertDistanceFromSI(trip.total_distance_m, distancePref),
          energy: trip.total_energy_wh,
        })),
    [allTrips, distancePref],
  );

  const handleExportCSV = useCallback(() => {
    exportAsCSV(
      allTrips.map(trip => ({
        id: trip.id,
        name: trip.name ?? `Trip ${trip.id}`,
        start_date: trip.start_date,
        end_date: trip.end_date ?? '',
        distance_m: trip.total_distance_m,
        energy_wh: trip.total_energy_wh,
        cost: trip.total_cost,
        drives: trip.drive_count,
        charges: trip.charge_count,
      })),
      'teslasync-trips-v2.csv',
    );
  }, [allTrips]);

  const handleExportJSON = useCallback(() => {
    exportAsJSON(allTrips, 'teslasync-trips.json');
  }, [allTrips]);

  // Heuristic total for pagination (backend doesn't return total count).
  const estimatedTotal =
    allTrips.length < pageSize
      ? (page - 1) * pageSize + allTrips.length
      : page * pageSize + 1;

  // totalDist is already a sum of SI meters (Trip.total_distance_m); convert
  // straight from meters to the display unit (web L125-128).
  const totalDistDisplay = convertDistanceFromSI(totalDist, distancePref);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchTrips();
    } finally {
      setRefreshing(false);
    }
  }, [refetchTrips]);

  return (
    <ScrollView
      testID="trip-list-page"
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.accent}
        />
      }>
      {/* Header */}
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {pageTitle}
        </AppText>
        <AppText tone="muted">
          {t(
            'trips.subtitle',
            'Multi-drive trip reports with distance and cost tracking',
          )}
        </AppText>
        <View style={styles.actions}>
          <VehicleSelect
            options={vehicleOptions}
            value={vehicleId}
            onChange={setVehicleId}
          />
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setRangeBatch({from: r.start, to: r.end, page: null})}
          />
        </View>
      </View>

      {/* Stats Cards */}
      {isLoading ? (
        <View style={styles.statsGrid}>
          {[1, 2, 3, 4].map(i => (
            <View key={i} style={styles.skeletonCard} />
          ))}
        </View>
      ) : (
        <View style={styles.statsGrid}>
          <SummaryStat
            label={t('trips.stats.distance', 'Total Distance')}
            value={`${fmtInt(totalDistDisplay)} ${distancePref}`}
            glyph="PN"
            tone="accent"
            subtitle={t('trips.stats.tripCount', '{{count}} trips', {
              count: allTrips.length,
            })}
          />
          <SummaryStat
            label={t('trips.stats.energy', 'Energy Used')}
            value={formatEnergy(totalEnergy, userPrecision)}
            glyph="ZP"
            tone="warning"
            subtitle={t('trips.stats.driveCount', '{{count}} drives', {
              count: totalDrives,
            })}
          />
          <SummaryStat
            label={t('trips.stats.cost', 'Total Cost')}
            value={formatCurrency(totalCost)}
            glyph="$"
            tone="success"
            subtitle={
              totalDistDisplay > 0
                ? `${formatCurrency(
                    (totalCost / totalDistDisplay) * 100,
                  )}/100${distancePref}`
                : formatCurrency(0)
            }
          />
          <SummaryStat
            label={t('trips.stats.total', 'Total Trips')}
            value={`${allTrips.length}`}
            glyph="TR"
            tone="violet"
            subtitle={t('trips.stats.totalDrives', '{{count}} total drives', {
              count: totalDrives,
            })}
          />
        </View>
      )}

      {/* Top Trips Chart */}
      <TopTripsChart
        data={chartData}
        distancePref={distancePref}
        onExportCSV={handleExportCSV}
        onExportJSON={handleExportJSON}
      />

      {/* Trip List */}
      <GlassPanel style={styles.listPanel}>
        <AppText weight="semibold" style={styles.listHeading}>
          {t('trips.list.heading', 'All Trips')}
        </AppText>
        {allTrips.length === 0 ? (
          <EmptyState
            title={t('trips.list.emptyTitle', 'No Trips')}
            message={t('trips.list.empty', 'No trips recorded yet')}
          />
        ) : (
          <View style={styles.tripList}>
            {allTrips.map(trip => (
              <TripRow
                key={trip.id}
                trip={trip}
                distancePref={distancePref}
                efficiencyUnit={efficiencyUnit}
                userPrecision={userPrecision}
                formatCurrency={formatCurrency}
              />
            ))}
          </View>
        )}
      </GlassPanel>

      {/* Pagination */}
      {allTrips.length > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={estimatedTotal}
          onPageChange={setPage}
          onPageSizeChange={s => setRangeBatch({size: String(s), page: null})}
        />
      ) : null}
    </ScrollView>
  );
}

TripListPage.displayName = 'TripListPage';

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chartActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chartBars: {
    gap: spacing.sm,
  },
  chartFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  chartHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  chartLabel: {
    width: 84,
  },
  chartPanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  chartRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chartTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 10,
    overflow: 'hidden',
  },
  chartValue: {
    textAlign: 'right',
    width: 72,
  },
  header: {
    gap: spacing.xs,
  },
  listHeading: {
    marginBottom: spacing.md,
  },
  listPanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  pageButton: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageButtonDisabled: {
    opacity: 0.48,
  },
  pageSizeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pagination: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  paginationControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowCost: {
    color: colors.success,
  },
  rowEnergy: {
    color: colors.warning,
  },
  rowIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rowIconText: {
    color: colors.accent,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowMain: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    gap: spacing.md,
    minWidth: 200,
  },
  rowMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowPanel: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  rowStat: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowStats: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'flex-end',
  },
  scrollContent: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  segmentItem: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  segmentItemActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  skeletonCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 18,
    flexBasis: '47%',
    flexGrow: 1,
    height: 96,
    minWidth: 150,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.lg,
  },
  statChip: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  statLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  statTextCol: {
    flex: 1,
    gap: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  tripList: {
    gap: spacing.sm,
  },
});

const statChipTone = StyleSheet.create<Record<StatTone, ViewStyle>>({
  accent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  violet: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const statGlyphTone = StyleSheet.create<Record<StatTone, TextStyle>>({
  accent: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  violet: {
    color: colors.violet,
  },
  warning: {
    color: colors.warning,
  },
});
