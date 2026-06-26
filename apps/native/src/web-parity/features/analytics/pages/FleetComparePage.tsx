// Native parity port of web/src/features/analytics/pages/FleetComparePage.tsx.
//
// FleetComparePage — compare two fleet vehicles side by side: a vehicle-A /
// vehicle-B selector pair (with cross-disable), two live status cards, an
// overlaid Monthly Distance line chart, a Drives-per-Month bar chart, a
// lifetime-stats comparison table with per-row winner highlighting, and a
// four-up "Key Highlights" stat grid. A dismissible info banner points users
// who actually wanted the period view at /period-compare, and a single-vehicle
// account sees a focused EmptyState instead of empty selectors.
//
// The web original composes the shared DOM page kit (PageContainer, Grid,
// GlassPanel, Select, DataTable, StatCard, EmptyState, Skeleton, AlertBanner,
// FadeIn), the Recharts LineChart/BarChart trees, lucide SVG icons,
// react-router-dom (useNavigate / useSearchParams / <Link>), react-i18next, the
// app-level useUnits / useFormatting / useChartPalette / usePageTitle hooks, the
// @/lib/unitConversion SI converters, @/lib/numberFormat.fmtNumber and @/lib/cn.
// React Native has no DOM, no Recharts/SVG backend, no Tailwind, no lucide, no
// react-router, no browser localStorage and no wired react-i18next, so this port
// reproduces the same behaviour with RN primitives + the established native
// parity building blocks:
//
//   - PageContainer (title/subtitle + a loading gate that swaps the body for a
//     centered spinner) -> an inline scaffold: a persistent header (title +
//     subtitle) plus a body that, exactly like web, renders the full content
//     only once vehicles have loaded; while loading it shows a centered
//     ActivityIndicator. usePageTitle(t('comparison.title')) sets the browser
//     tab title, which has no native analogue, so the same translated string is
//     surfaced as the on-screen header (documented in the sidecar).
//   - @/hooks/useUnits + @/hooks/useFormatting + @/hooks/useChartPalette are
//     reproduced by reading the native useSettings() query and deriving the same
//     values the web hooks derive: distance/speed/temperature unit prefs from
//     unit_of_length / unit_of_temp, the currency symbol, the locale + decimal
//     precision, and the CB-safe-vs-neon chart palette from chart_palette. The
//     SI converters (convertDistanceFromSI / convertSpeedFromSI / convertTempFromSI
//     / convertEnergyFromSI) and the formatDistance / formatTemperature /
//     formatEnergy / formatCurrency / fmtNumber formatters are inlined verbatim
//     from @/lib/unitConversion + @/lib/numberFormat (same SI math, same per-call
//     precision resolution, same '—' nullish fallback). No unit math is invented.
//   - The Recharts overlaid LineChart (distA / distB per month) and the
//     drives-per-month BarChart (drivesA / drivesB) are reproduced with native
//     View/AppText "grouped bar" layers that preserve each series' data key,
//     palette colour and proportional intent (the same idiom as the converted
//     OverviewTab / ChargingTab), with the numeric value visible beside each bar
//     and the EmptyState fallback preserved when there is no data.
//   - DataTable (Metric / nameA / nameB columns with winner ✓ highlighting) ->
//     a native header row + one row per ComparisonRow, preserving getWinner /
//     winnerCell semantics (emerald winner + " ✓", neutral otherwise). The
//     Skeleton loading branch is preserved as inline placeholder bars.
//   - StatCard x4 -> a native HighlightCard (label + leading SemanticIcon, then
//     value + optional unit, with a loading placeholder), preserving every
//     label/value/unit and the loading gate.
//   - Select x2 -> a labelled segmented pill group (the established native
//     single-choice control) preserving optionsA/optionsB and the cross-disable.
//   - AlertBanner (info, calendar icon, onClose) -> an inline info GlassPanel
//     with a SemanticIcon 'calendar', the banner copy, the /period-compare link
//     as static (non-navigating) text, and an "X" close Pressable. localStorage
//     dismissal persistence -> a module-level session flag (AsyncStorage is not
//     wired); the banner still defaults visible and hides on dismiss.
//   - useSearchParams ?leftId/?rightId deep-linking is not wired on native, so
//     both ids start empty and the auto-select effect picks the first two
//     vehicles, exactly like web with no query params.
//   - useNavigate('/vehicles') (the single-vehicle CTA) is reproduced as a
//     static "Manage vehicles" affordance; native EmptyState has no action slot
//     and router navigation is not wired (documented).
//   - lucide icons (Battery/Thermometer/Lock/Shield/Wifi/Car/Gauge/Zap/
//     TrendingUp/DollarSign/Leaf/Route/ArrowLeftRight/Info/Calendar) map onto the
//     shared native SemanticIcon set or are dropped where purely decorative,
//     following the OverviewTab / ChargingTab precedent.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     that preserves every t('comparison.*' , 'Default') key + default verbatim.
//
// State names (vehicleIdA, vehicleIdB, bannerVisible), every API path (via the
// unchanged native hooks), the auto-select effect, the cross-disable options
// memos, the monthly merge/align memo, the comparison-row builder and the
// SI-km/SI-km/h unit handling are preserved verbatim. No DOM, Recharts, Leaflet,
// react-router, lucide-react, or old web UI components are imported.

import React, {useEffect, useMemo, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useCostBreakdown, useMonthlyMileage} from '../../../api/hooks/useAnalytics';
import {useDrivingStats} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {
  useVehicles,
  useVehicleState,
  type Vehicle,
  type VehicleState,
} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so the fallback returns the English default
// while keeping every comparison.* key verbatim.
type TFunc = (key: string, fallback: string) => string;
const t: TFunc = (_key, fallback) => fallback;

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ──── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';
type EnergyUnitPref = 'Wh' | 'kWh';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;
// backend useDrivingStats returns explicit-SI fields (km, km/h, Wh/km); the
// page bridges Wh/km -> Wh/mi for the miles preference with this exact factor.
const KM_PER_MILE = 1.609344;

const DEFAULT_EMPTY_DISPLAY = '—';

// Pure SI -> display converters, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// The native useVehicleState normalizer types `.state` as VehicleState | string
// | null (the bare FSM-state string is the "no live snapshot" case); narrow it
// to the VehicleState object the web page consumes, otherwise undefined.
function asVehicleState(
  value: VehicleState | string | null | undefined,
): VehicleState | undefined {
  return value != null && typeof value === 'object' ? value : undefined;
}

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/unitConversion.formatNumber (Intl grouping, pinned digits).
function formatNumber(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }
}

// Mirrors web lib/unitConversion.resolvePrecision: per-call override > pref
// precision > per-quantity fallback.
function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

// Mirrors web useUnits.derivePrecision (settings.decimal_precision -> pref).
function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision)) {
    return undefined;
  }
  if (decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

/* ─── Chart palette (mirror web useChartPalette + lib/colors) ──────────── */

// Web @/lib/colors CHART_COLORS_CB_SAFE (Okabe-Ito) verbatim.
const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

// Web @/lib/colors CHART_COLORS_NEON verbatim.
const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
] as const;

// Web useChartPalette: 'neon' pref -> neon palette, otherwise CB-safe default.
function resolveChartPalette(
  pref: string | null | undefined,
): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

/* ── Types ─────────────────────────────────────────────── */

type WinnerSemantic = 'higher' | 'lower' | 'neutral';

interface ComparisonRow {
  metric: string;
  valueA: string;
  valueB: string;
  rawA: number;
  rawB: number;
  winner: WinnerSemantic;
}

/* ── Helpers ───────────────────────────────────────────── */

function getWinner(
  a: number,
  b: number,
  semantic: WinnerSemantic,
): 'a' | 'b' | 'tie' {
  if (semantic === 'neutral' || a === b) {
    return 'tie';
  }
  if (semantic === 'higher') {
    return a > b ? 'a' : 'b';
  }
  return a < b ? 'a' : 'b';
}

// Native winnerCell: the web emerald-300 winner colour + " ✓" suffix becomes a
// success-toned AppText, the loser stays primary-toned.
function WinnerValue({
  value,
  side,
  row,
}: {
  value: string;
  side: 'a' | 'b';
  row: ComparisonRow;
}) {
  const winner = getWinner(row.rawA, row.rawB, row.winner);
  const isWinner = winner === side;
  return (
    <AppText
      variant="caption"
      weight="semibold"
      style={[styles.cellValue, isWinner ? styles.winnerText : undefined]}
      numberOfLines={1}>
      {value}
      {isWinner ? ' ✓' : ''}
    </AppText>
  );
}

// disambiguation banner dismissal is persisted so users who already understand
// the difference between the two compare pages don't have to dismiss it on
// every visit. localStorage is unavailable on native, so this module-level flag
// persists the dismissal for the JS session (AsyncStorage is not wired yet).
const BANNER_DISMISSED_KEY = 'phase40.compareBanner.dismissed.fleet';
let bannerDismissedSession = false;

/* ─── Native chart / status primitives (replace Recharts SVG + lucide) ─── */

function ProportionBar({pct, color}: {pct: number; color: string}) {
  const width = `${Math.max(Math.min(pct, 100), 0)}%` as DimensionValue;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, {width, backgroundColor: color}]} />
    </View>
  );
}

function ChartLegend({items}: {items: {label: string; color: string}[]}) {
  return (
    <View style={styles.legend}>
      {items.map(item => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: item.color}]} />
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

interface SeriesDef {
  label: string;
  color: string;
  format: (n: number) => string;
}

// Native stand-in for a multi-series Recharts LineChart / BarChart overlay: one
// row per category (month) with a Legend, each series scaled to its own max.
function GroupedBars({
  rows,
  series,
}: {
  rows: {label: string; values: number[]}[];
  series: SeriesDef[];
}) {
  const maxes = series.map(
    (_s, si) => rows.reduce((m, r) => Math.max(m, r.values[si] ?? 0), 0) || 1,
  );
  return (
    <View style={styles.list}>
      <ChartLegend items={series.map(s => ({label: s.label, color: s.color}))} />
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={styles.groupOuter}>
          <AppText
            variant="caption"
            tone="muted"
            style={styles.groupLabel}
            numberOfLines={1}>
            {r.label}
          </AppText>
          <View style={styles.groupBars}>
            {series.map((s, si) => (
              <View key={s.label} style={styles.groupRow}>
                <ProportionBar
                  pct={((r.values[si] ?? 0) / maxes[si]) * 100}
                  color={s.color}
                />
                <AppText variant="caption" style={styles.groupValue}>
                  {s.format(r.values[si] ?? 0)}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// Native ChartContainer stand-in: a titled GlassPanel with an EmptyState
// fallback when the chart has no data (web ChartContainer + EmptyState).
function ChartPanel({
  title,
  emptyIcon,
  emptyMessage,
  hasData,
  children,
}: {
  title: string;
  emptyIcon: SemanticIconName;
  emptyMessage: string;
  hasData: boolean;
  children: ReactNode;
}) {
  return (
    <GlassPanel style={styles.panel}>
      <AppText weight="semibold" style={styles.sectionTitle}>
        {title}
      </AppText>
      {hasData ? (
        children
      ) : (
        <View style={styles.emptyWrap}>
          <SemanticIcon name={emptyIcon} size="md" decorative />
          <EmptyState title={title} message={emptyMessage} />
        </View>
      )}
    </GlassPanel>
  );
}

// Native StatCard stand-in for the four "Key Highlights": label + leading icon,
// then value (+ optional unit), with a loading placeholder.
function HighlightCard({
  label,
  value,
  unit,
  icon,
  loading,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: SemanticIconName;
  loading?: boolean;
}) {
  return (
    <GlassPanel style={styles.highlightCard}>
      <View style={styles.spaceBetween}>
        <AppText variant="caption" tone="muted" weight="semibold">
          {label}
        </AppText>
        <SemanticIcon name={icon} size="sm" decorative />
      </View>
      {loading ? (
        <View style={styles.skeletonLine} />
      ) : (
        <View style={styles.valueRow}>
          <AppText variant="title" weight="bold" numberOfLines={1}>
            {value}
          </AppText>
          {unit ? (
            <AppText variant="caption" tone="muted">
              {unit}
            </AppText>
          ) : null}
        </View>
      )}
    </GlassPanel>
  );
}

/* ── Status Card Sub-component ─────────────────────────── */

function VehicleStatusCard({
  vehicle,
  state,
  isLoading,
  formatDistance,
  formatTemperature,
}: {
  vehicle: Vehicle | undefined;
  state: VehicleState | undefined;
  isLoading: boolean;
  formatDistance: (value: number, precision?: number) => string;
  formatTemperature: (value: number, precision?: number) => string;
}) {
  if (isLoading) {
    return (
      <GlassPanel style={styles.statusCard}>
        <View style={styles.skeletonBlock}>
          {[0, 1, 2, 3, 4].map(i => (
            <View key={i} style={styles.skeletonLine} />
          ))}
        </View>
      </GlassPanel>
    );
  }

  if (!vehicle) {
    return (
      <GlassPanel style={styles.statusCard}>
        <View style={styles.emptyWrap}>
          <SemanticIcon name="vehicle" size="md" decorative />
          <EmptyState
            title={t('comparison.selectVehicle', 'Select a vehicle')}
            message={t('comparison.selectVehicle', 'Select a vehicle')}
          />
        </View>
      </GlassPanel>
    );
  }

  const batteryLevel = state?.battery_level ?? null;
  const range = state?.rated_range ?? null;
  const insideTemp = state?.inside_temp ?? null;
  const outsideTemp = state?.outside_temp ?? null;
  const isOnline = vehicle.state === 'online';

  return (
    <GlassPanel style={styles.statusCard}>
      <View style={styles.statusHeader}>
        <SemanticIcon name="vehicle" size="md" decorative />
        <View style={styles.statusHeaderText}>
          <AppText weight="semibold" numberOfLines={1}>
            {vehicle.display_name || vehicle.vin}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {vehicle.model}
            {vehicle.trim_badging ? ` · ${vehicle.trim_badging}` : ''}
          </AppText>
        </View>
      </View>

      <View style={styles.statusRows}>
        {/* Battery */}
        <View style={styles.spaceBetween}>
          <AppText variant="caption" tone="secondary">
            {t('comparison.battery', 'Battery')}
          </AppText>
          <AppText variant="caption" weight="semibold">
            {batteryLevel != null ? `${batteryLevel}%` : '—'}
          </AppText>
        </View>
        {batteryLevel != null ? (
          <ProportionBar
            pct={Math.min(batteryLevel, 100)}
            color={
              batteryLevel > 50
                ? colors.success
                : batteryLevel > 20
                ? colors.warning
                : colors.danger
            }
          />
        ) : null}

        {/* Range */}
        <View style={styles.spaceBetween}>
          <AppText variant="caption" tone="secondary">
            {t('comparison.range', 'Range')}
          </AppText>
          <AppText variant="caption" weight="semibold">
            {range != null ? formatDistance(range) : '—'}
          </AppText>
        </View>

        {/* Temperature */}
        <View style={styles.spaceBetween}>
          <AppText variant="caption" tone="secondary">
            {t('comparison.temp', 'Temperature')}
          </AppText>
          <AppText variant="caption" weight="semibold">
            {insideTemp != null ? formatTemperature(insideTemp) : '—'}
            {outsideTemp != null ? ` / ${formatTemperature(outsideTemp)}` : ''}
          </AppText>
        </View>

        {/* Lock & Sentry */}
        <View style={styles.spaceBetween}>
          <AppText variant="caption" tone="secondary">
            {t('comparison.security', 'Security')}
          </AppText>
          {state ? (
            <View style={styles.inlineEnd}>
              <AppText
                variant="caption"
                style={state.is_locked ? styles.winnerText : styles.lossText}>
                {state.is_locked
                  ? t('comparison.locked', 'Locked')
                  : t('comparison.unlocked', 'Unlocked')}
              </AppText>
              {state.sentry_mode ? (
                <AppText variant="caption" tone="accent">
                  {t('comparison.sentry', 'Sentry')}
                </AppText>
              ) : null}
            </View>
          ) : (
            <AppText variant="caption" tone="muted">
              —
            </AppText>
          )}
        </View>

        {/* Status */}
        <View style={styles.spaceBetween}>
          <AppText variant="caption" tone="secondary">
            {t('comparison.status', 'Status')}
          </AppText>
          <View
            style={[
              styles.statusPill,
              isOnline ? styles.statusPillOnline : styles.statusPillOffline,
            ]}>
            <AppText
              variant="caption"
              weight="semibold"
              style={isOnline ? styles.onlineText : undefined}
              tone={isOnline ? undefined : 'muted'}>
              {vehicle.state ?? t('comparison.unknown', 'Unknown')}
            </AppText>
          </View>
        </View>
      </View>
    </GlassPanel>
  );
}

/* ── Vehicle selector (web Select with cross-disable) ──── */

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function VehicleSelect({
  label,
  options,
  value,
  onChange,
  testID,
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (next: string) => void;
  testID?: string;
}) {
  return (
    <View style={styles.selectBlock} testID={testID}>
      <AppText variant="caption" tone="muted" weight="semibold">
        {label}
      </AppText>
      <View style={styles.pillRow}>
        {options.map(opt => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              disabled={opt.disabled}
              onPress={() => onChange(opt.value)}
              style={[
                styles.pill,
                selected ? styles.pillSelected : undefined,
                opt.disabled ? styles.pillDisabled : undefined,
              ]}>
              <AppText
                variant="caption"
                weight={selected ? 'semibold' : 'regular'}
                tone={selected ? 'accent' : 'secondary'}
                numberOfLines={1}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── Main Component ────────────────────────────────────── */

export default function FleetComparePage() {
  // usePageTitle(t('comparison.title')) sets the browser tab title on web; there
  // is no native analogue, so the same translated string is the on-screen header.

  /* ── Unit + formatting bridge (web useUnits / useFormatting / useChartPalette) ── */
  const {data: settings} = useSettings();
  const distanceUnit: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  const speedUnit: SpeedUnitPref =
    settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const temperatureUnit: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '°F' : '°C';
  const locale =
    settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';
  const unitPrecision = derivePrecision(settings?.decimal_precision);
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';

  // Mirrors web lib/numberFormat.fmtNumber (global precision/locale defaults).
  const fmtNumber = (v: number | null | undefined, decimals?: number): string => {
    const d = decimals ?? userPrecision;
    try {
      return safeNumber(v).toLocaleString(locale, {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    } catch {
      return safeNumber(v).toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    }
  };

  // Mirrors web useUnits().formatDistance / formatTemperature / formatEnergy.
  const formatDistance = (
    value: number | null | undefined,
    precision?: number,
  ): string => {
    if (!isFiniteNumber(value)) {
      return DEFAULT_EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(unitPrecision, precision, 1);
    return `${formatNumber(
      convertDistanceFromSI(value, distanceUnit),
      locale,
      digits,
    )} ${distanceUnit}`;
  };
  const formatTemperature = (
    value: number | null | undefined,
    precision?: number,
  ): string => {
    if (!isFiniteNumber(value)) {
      return DEFAULT_EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(unitPrecision, precision, 1);
    // No space between number and °unit (typographic convention).
    return `${formatNumber(
      convertTempFromSI(value, temperatureUnit),
      locale,
      digits,
    )}${temperatureUnit}`;
  };
  const formatEnergy = (value: number | null | undefined): string => {
    if (!isFiniteNumber(value)) {
      return DEFAULT_EMPTY_DISPLAY;
    }
    const digits = resolvePrecision(unitPrecision, undefined, 2);
    return `${formatNumber(convertEnergyFromSI(value, 'kWh'), locale, digits)} kWh`;
  };
  // Mirrors web useFormatting().formatCurrency.
  const formatCurrency = (amount: number, decimals?: number): string => {
    const d = decimals ?? userPrecision;
    return `${currencySymbol}${fmtNumber(amount, d)}`;
  };

  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);
  const fromKmh = (kmh: number) =>
    convertSpeedFromSI((kmh * 1000) / 3600, speedUnit);
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  // reactive chart palette (CB-safe / neon per user pref).
  const palette = resolveChartPalette(settings?.chart_palette);

  // ?leftId / ?rightId deep-linking is not wired on native; both ids start empty
  // and the auto-select effect below picks the first two vehicles (web parity).
  const initialLeftId = '';
  const initialRightId = '';

  const [vehicleIdA, setVehicleIdA] = useState<string>(initialLeftId);
  const [vehicleIdB, setVehicleIdB] = useState<string>(initialRightId);

  // Disambiguation banner — defaults to visible, persists dismissal for the
  // session (web reads/writes localStorage under BANNER_DISMISSED_KEY).
  const [bannerVisible, setBannerVisible] = useState<boolean>(
    () => !bannerDismissedSession,
  );
  const dismissBanner = () => {
    setBannerVisible(false);
    bannerDismissedSession = true;
    // BANNER_DISMISSED_KEY documents the web localStorage key this mirrors.
    void BANNER_DISMISSED_KEY;
  };

  /* ── Vehicle list ── */
  const {data: vehicles, isLoading: vehiclesLoading} = useVehicles();
  // Memoised so the effect + options memos below get a stable reference (the
  // web `vehicles ?? []` literal is re-created every render).
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);

  // Auto-select first two vehicles if not provided via query params.
  useEffect(() => {
    if (vehicleList.length >= 2) {
      if (!vehicleIdA) {
        setVehicleIdA(String(vehicleList[0].id));
      }
      if (!vehicleIdB) {
        setVehicleIdB(String(vehicleList[1].id));
      }
    } else if (vehicleList.length === 1 && !vehicleIdA) {
      setVehicleIdA(String(vehicleList[0].id));
    }
  }, [vehicleList, vehicleIdA, vehicleIdB]);

  const vehicleA = vehicleList.find(v => String(v.id) === vehicleIdA);
  const vehicleB = vehicleList.find(v => String(v.id) === vehicleIdB);
  const numIdA = vehicleA?.id ?? 0;
  const numIdB = vehicleB?.id ?? 0;

  /* ── Vehicle state (live) ── */
  const {data: stateDataA, isLoading: stateLoadingA} = useVehicleState(numIdA);
  const {data: stateDataB, isLoading: stateLoadingB} = useVehicleState(numIdB);
  const stateA = asVehicleState(stateDataA?.state);
  const stateB = asVehicleState(stateDataB?.state);

  /* ── Driving stats (lifetime) ── */
  const {data: drivingStatsA, isLoading: dStatsLoadA} = useDrivingStats(
    vehicleIdA || undefined,
  );
  const {data: drivingStatsB, isLoading: dStatsLoadB} = useDrivingStats(
    vehicleIdB || undefined,
  );

  /* ── Cost breakdown (lifetime) ── */
  const {data: costA} = useCostBreakdown(vehicleIdA || '');
  const {data: costB} = useCostBreakdown(vehicleIdB || '');

  /* ── Monthly mileage (for chart) ── */
  const {data: monthlyA} = useMonthlyMileage(vehicleIdA || '');
  const {data: monthlyB} = useMonthlyMileage(vehicleIdB || '');

  const isLoading = vehiclesLoading;
  const statsLoading = dStatsLoadA || dStatsLoadB;

  /* ── Select options with cross-disable ── */
  const optionsA: SelectOption[] = useMemo(
    () =>
      vehicleList.map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin,
        disabled: String(v.id) === vehicleIdB,
      })),
    [vehicleList, vehicleIdB],
  );

  const optionsB: SelectOption[] = useMemo(
    () =>
      vehicleList.map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin,
        disabled: String(v.id) === vehicleIdA,
      })),
    [vehicleList, vehicleIdA],
  );

  /* ── Monthly mileage chart data (merged & aligned) ──
     Backend `/mileage/monthly` returns MonthlyMileageBucket{year_month,
     total_km, drive_count, …}. Distances stay in km here — the chart already
     reads km elsewhere on the page. */
  const monthlyChartData = useMemo(() => {
    const arrA = monthlyA ?? [];
    const arrB = monthlyB ?? [];
    const monthMap = new Map<
      string,
      {
        month: string;
        distA: number;
        distB: number;
        drivesA: number;
        drivesB: number;
      }
    >();

    for (const m of arrA) {
      const ym = m.year_month ?? '';
      monthMap.set(ym, {
        month: ym,
        distA: m.total_km ?? 0,
        distB: 0,
        drivesA: m.drive_count ?? 0,
        drivesB: 0,
      });
    }
    for (const m of arrB) {
      const ym = m.year_month ?? '';
      const existing = monthMap.get(ym);
      if (existing) {
        existing.distB = m.total_km ?? 0;
        existing.drivesB = m.drive_count ?? 0;
      } else {
        monthMap.set(ym, {
          month: ym,
          distA: 0,
          distB: m.total_km ?? 0,
          drivesA: 0,
          drivesB: m.drive_count ?? 0,
        });
      }
    }

    return Array.from(monthMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
  }, [monthlyA, monthlyB]);

  /* ── Charging sessions chart (drives per month as bar chart) ── */
  const drivesChartData = useMemo(
    () =>
      monthlyChartData.map(m => ({
        month: m.month,
        drivesA: m.drivesA,
        drivesB: m.drivesB,
      })),
    [monthlyChartData],
  );

  /* ── Comparison table rows ── */
  const nameA = vehicleA?.display_name ?? t('comparison.vehicleA', 'Vehicle A');
  const nameB = vehicleB?.display_name ?? t('comparison.vehicleB', 'Vehicle B');

  const comparisonRows: ComparisonRow[] = useMemo(() => {
    const dsA = drivingStatsA;
    const dsB = drivingStatsB;
    const cA = costA;
    const cB = costB;

    return [
      {
        metric: t('comparison.totalDrives', 'Total Drives'),
        valueA: fmtNumber(dsA?.totalDrives ?? 0),
        valueB: fmtNumber(dsB?.totalDrives ?? 0),
        rawA: dsA?.totalDrives ?? 0,
        rawB: dsB?.totalDrives ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.totalDistance', 'Total Distance'),
        valueA: `${fmtNumber(fromKm(dsA?.totalDistanceKm ?? 0))} ${distanceUnit}`,
        valueB: `${fmtNumber(fromKm(dsB?.totalDistanceKm ?? 0))} ${distanceUnit}`,
        rawA: dsA?.totalDistanceKm ?? 0,
        rawB: dsB?.totalDistanceKm ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.avgEfficiency', 'Avg Efficiency'),
        valueA: `${fmtNumber(whPerKmToDisplay(dsA?.avgEfficiencyWhKm ?? 0))} ${efficiencyUnit}`,
        valueB: `${fmtNumber(whPerKmToDisplay(dsB?.avgEfficiencyWhKm ?? 0))} ${efficiencyUnit}`,
        rawA: dsA?.avgEfficiencyWhKm ?? 0,
        rawB: dsB?.avgEfficiencyWhKm ?? 0,
        winner: 'lower' as WinnerSemantic,
      },
      {
        metric: t('comparison.avgSpeed', 'Avg Speed'),
        valueA: `${fmtNumber(fromKmh(dsA?.avgSpeedKmh ?? 0))} ${speedUnit}`,
        valueB: `${fmtNumber(fromKmh(dsB?.avgSpeedKmh ?? 0))} ${speedUnit}`,
        rawA: dsA?.avgSpeedKmh ?? 0,
        rawB: dsB?.avgSpeedKmh ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
      {
        metric: t('comparison.topSpeed', 'Top Speed'),
        valueA: `${fmtNumber(fromKmh(dsA?.topSpeedKmh ?? 0))} ${speedUnit}`,
        valueB: `${fmtNumber(fromKmh(dsB?.topSpeedKmh ?? 0))} ${speedUnit}`,
        rawA: dsA?.topSpeedKmh ?? 0,
        rawB: dsB?.topSpeedKmh ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
      {
        metric: t('comparison.regenRatio', 'Regen Ratio'),
        valueA: `${fmtNumber((dsA?.regenRatio ?? 0) * 100, 1)}%`,
        valueB: `${fmtNumber((dsB?.regenRatio ?? 0) * 100, 1)}%`,
        rawA: dsA?.regenRatio ?? 0,
        rawB: dsB?.regenRatio ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.co2Saved', 'CO₂ Saved'),
        valueA: `${fmtNumber(dsA?.co2SavedKg ?? 0)} kg`,
        valueB: `${fmtNumber(dsB?.co2SavedKg ?? 0)} kg`,
        rawA: dsA?.co2SavedKg ?? 0,
        rawB: dsB?.co2SavedKg ?? 0,
        winner: 'higher' as WinnerSemantic,
      },
      {
        metric: t('comparison.chargingCost', 'Charging Cost'),
        valueA: formatCurrency(cA?.total_charging_cost ?? 0, 0),
        valueB: formatCurrency(cB?.total_charging_cost ?? 0, 0),
        rawA: cA?.total_charging_cost ?? 0,
        rawB: cB?.total_charging_cost ?? 0,
        winner: 'lower' as WinnerSemantic,
      },
      {
        metric: t('comparison.totalEnergy', 'Total Energy'),
        valueA: formatEnergy(cA?.total_wh ?? 0),
        valueB: formatEnergy(cB?.total_wh ?? 0),
        rawA: cA?.total_wh ?? 0,
        rawB: cB?.total_wh ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
      {
        metric: t('comparison.chargeSessions', 'Charge Sessions'),
        valueA: fmtNumber(cA?.total_sessions ?? 0),
        valueB: fmtNumber(cB?.total_sessions ?? 0),
        rawA: cA?.total_sessions ?? 0,
        rawB: cB?.total_sessions ?? 0,
        winner: 'neutral' as WinnerSemantic,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    drivingStatsA,
    drivingStatsB,
    costA,
    costB,
    distanceUnit,
    speedUnit,
    efficiencyUnit,
    currencySymbol,
    locale,
    userPrecision,
    unitPrecision,
  ]);

  /* ── Render ── */

  const header = (
    <View style={styles.header}>
      <AppText variant="title" weight="bold">
        {t('comparison.title', 'Fleet Comparison')}
      </AppText>
      <AppText variant="caption" tone="secondary">
        {t('comparison.subtitle', 'Compare two vehicles side by side')}
      </AppText>
    </View>
  );

  // single-vehicle accounts can't usefully use Fleet Comparison. Show a focused
  // EmptyState that explains why and offers a path forward (manage vehicles).
  if (!vehiclesLoading && vehicleList.length < 2) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        testID="fleet-compare-page">
        {header}
        <GlassPanel style={styles.panel}>
          <View style={styles.emptyWrap} testID="fleet-compare-single-vehicle">
            <SemanticIcon name="vehicle" size="lg" decorative />
            <EmptyState
              title={t(
                'fleetCompare.singleVehicle.title',
                'Add a second vehicle to compare',
              )}
              message={t(
                'fleetCompare.singleVehicle.body',
                'Fleet comparison shows two vehicles side-by-side. You currently have one vehicle in TeslaSync.',
              )}
            />
            {/* useNavigate('/vehicles') is not wired on native; the CTA label is
                preserved as a static affordance. */}
            <View style={styles.ctaButton}>
              <AppText variant="caption" weight="semibold" tone="accent">
                {t('fleetCompare.singleVehicle.cta', 'Manage vehicles')}
              </AppText>
            </View>
          </View>
        </GlassPanel>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="fleet-compare-page">
      {header}

      {isLoading ? (
        <View style={styles.loadingWrap} testID="fleet-compare-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <>
          {/* Disambiguation banner — points users who wanted the period view to
              the right page. Persists dismissal for the session. */}
          {bannerVisible ? (
            <GlassPanel style={styles.banner} testID="fleet-compare-banner">
              <SemanticIcon name="calendar" size="sm" decorative />
              <View style={styles.bannerBody}>
                <AppText variant="caption" tone="secondary">
                  {t(
                    'comparison.banner.toPeriodPrefix',
                    'Looking to compare time periods instead?',
                  )}{' '}
                  {/* react-router <Link to="/period-compare"> -> static text
                      (navigation is not wired on native). */}
                  <AppText variant="caption" tone="accent" weight="semibold">
                    {t(
                      'comparison.banner.toPeriodCta',
                      'Open Period comparison →',
                    )}
                  </AppText>
                </AppText>
              </View>
              <Pressable
                onPress={dismissBanner}
                testID="fleet-compare-banner-close"
                style={styles.bannerClose}>
                <AppText variant="caption" tone="muted" weight="bold">
                  ✕
                </AppText>
              </Pressable>
            </GlassPanel>
          ) : null}

          {/* ── Vehicle Selectors ── */}
          <GlassPanel style={styles.selectorPanel}>
            <VehicleSelect
              label={t('comparison.vehicleA', 'Vehicle A')}
              options={optionsA}
              value={vehicleIdA}
              onChange={setVehicleIdA}
              testID="fleet-compare-select-a"
            />
            <View style={styles.swapIcon}>
              <SemanticIcon name="arrowLeftRight" size="sm" decorative />
            </View>
            <VehicleSelect
              label={t('comparison.vehicleB', 'Vehicle B')}
              options={optionsB}
              value={vehicleIdB}
              onChange={setVehicleIdB}
              testID="fleet-compare-select-b"
            />
          </GlassPanel>

          {/* ── Side-by-Side Status Cards ── */}
          <View style={styles.section}>
            <AppText
              variant="caption"
              tone="muted"
              weight="semibold"
              style={styles.sectionHeading}>
              {t('comparison.currentStatus', 'Current Status')}
            </AppText>
            <View style={styles.twoColumn}>
              <VehicleStatusCard
                vehicle={vehicleA}
                state={stateA}
                isLoading={stateLoadingA && !!vehicleIdA}
                formatDistance={formatDistance}
                formatTemperature={formatTemperature}
              />
              <VehicleStatusCard
                vehicle={vehicleB}
                state={stateB}
                isLoading={stateLoadingB && !!vehicleIdB}
                formatDistance={formatDistance}
                formatTemperature={formatTemperature}
              />
            </View>
          </View>

          {/* ── Monthly Distance Chart (overlaid) ── */}
          <ChartPanel
            title={t('comparison.monthlyDistance', 'Monthly Distance')}
            emptyIcon="trendUp"
            emptyMessage={t(
              'comparison.noMonthlyData',
              'No monthly data available yet',
            )}
            hasData={monthlyChartData.length > 0}>
            <GroupedBars
              rows={monthlyChartData.map(m => ({
                label: m.month,
                values: [m.distA, m.distB],
              }))}
              series={[
                {
                  label: nameA,
                  color: palette[0],
                  format: n => `${fmtNumber(n, 1)} km`,
                },
                {
                  label: nameB,
                  color: palette[1],
                  format: n => `${fmtNumber(n, 1)} km`,
                },
              ]}
            />
          </ChartPanel>

          {/* ── Drives per Month (bar chart) ── */}
          <ChartPanel
            title={t('comparison.drivesPerMonth', 'Drives per Month')}
            emptyIcon="drives"
            emptyMessage={t(
              'comparison.noDrivesData',
              'No drive data available yet',
            )}
            hasData={drivesChartData.length > 0}>
            <GroupedBars
              rows={drivesChartData.map(m => ({
                label: m.month,
                values: [m.drivesA, m.drivesB],
              }))}
              series={[
                {label: nameA, color: palette[0], format: n => fmtNumber(n, 0)},
                {label: nameB, color: palette[1], format: n => fmtNumber(n, 0)},
              ]}
            />
          </ChartPanel>

          {/* ── Lifetime Stats Comparison Table ── */}
          <GlassPanel style={styles.panel} testID="fleet-compare-table">
            <View style={styles.tableNote}>
              <SemanticIcon name="info" size="sm" decorative />
              <AppText variant="caption" tone="muted" style={styles.flexLabel}>
                {t(
                  'comparison.lifetimeNote',
                  'Statistics shown are lifetime totals across all tracked data.',
                )}
              </AppText>
            </View>
            {statsLoading ? (
              <View style={styles.skeletonBlock}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                  <View key={i} style={styles.skeletonLine} />
                ))}
              </View>
            ) : (
              <View style={styles.table}>
                <View style={styles.tableHeaderRow}>
                  <AppText
                    variant="caption"
                    tone="muted"
                    weight="semibold"
                    style={styles.cellMetric}>
                    {t('comparison.metric', 'Metric')}
                  </AppText>
                  <AppText
                    variant="caption"
                    tone="muted"
                    weight="semibold"
                    style={styles.cellValue}
                    numberOfLines={1}>
                    {nameA}
                  </AppText>
                  <AppText
                    variant="caption"
                    tone="muted"
                    weight="semibold"
                    style={styles.cellValue}
                    numberOfLines={1}>
                    {nameB}
                  </AppText>
                </View>
                {comparisonRows.map(row => (
                  <View key={row.metric} style={styles.tableRow}>
                    <AppText
                      variant="caption"
                      weight="semibold"
                      style={styles.cellMetric}>
                      {row.metric}
                    </AppText>
                    <WinnerValue value={row.valueA} side="a" row={row} />
                    <WinnerValue value={row.valueB} side="b" row={row} />
                  </View>
                ))}
              </View>
            )}
          </GlassPanel>

          {/* ── Quick Stat Cards (key differences) ── */}
          <View style={styles.section}>
            <AppText
              variant="caption"
              tone="muted"
              weight="semibold"
              style={styles.sectionHeading}>
              {t('comparison.highlights', 'Key Highlights')}
            </AppText>
            <View style={styles.highlightGrid}>
              <HighlightCard
                label={t('comparison.batteryDiff', 'Battery Level')}
                value={`${stateA?.battery_level ?? '—'}% vs ${
                  stateB?.battery_level ?? '—'
                }%`}
                icon="battery"
                loading={stateLoadingA || stateLoadingB}
              />
              <HighlightCard
                label={t('comparison.efficiencyDiff', 'Avg Efficiency')}
                value={`${fmtNumber(
                  whPerKmToDisplay(drivingStatsA?.avgEfficiencyWhKm ?? 0),
                )} vs ${fmtNumber(
                  whPerKmToDisplay(drivingStatsB?.avgEfficiencyWhKm ?? 0),
                )}`}
                unit={efficiencyUnit}
                icon="bolt"
                loading={statsLoading}
              />
              <HighlightCard
                label={t('comparison.costDiff', 'Charging Cost')}
                value={`${formatCurrency(
                  costA?.total_charging_cost ?? 0,
                  0,
                )} vs ${formatCurrency(costB?.total_charging_cost ?? 0, 0)}`}
                icon="dollarSign"
              />
              <HighlightCard
                label={t('comparison.co2Diff', 'CO₂ Saved')}
                value={`${fmtNumber(
                  drivingStatsA?.co2SavedKg ?? 0,
                )} vs ${fmtNumber(drivingStatsB?.co2SavedKg ?? 0)}`}
                unit="kg"
                icon="leaf"
                loading={statsLoading}
              />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  loadingWrap: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: spacing.md,
  },
  sectionHeading: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  /* Banner */
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  bannerBody: {
    flex: 1,
    minWidth: 0,
  },
  bannerClose: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  /* Selectors */
  selectorPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: spacing.md,
    padding: spacing.md,
  },
  selectBlock: {
    flexGrow: 1,
    minWidth: 200,
    gap: spacing.xs,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceRaised,
  },
  pillSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  pillDisabled: {
    opacity: 0.4,
  },
  swapIcon: {
    paddingBottom: spacing.sm,
  },
  /* Status card */
  statusCard: {
    flex: 1,
    minWidth: 260,
    padding: spacing.lg,
    gap: spacing.md,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  statusRows: {
    gap: spacing.sm,
  },
  spaceBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  inlineEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusPillOnline: {
    backgroundColor: colors.successSurface,
  },
  statusPillOffline: {
    backgroundColor: colors.surfaceRaised,
  },
  onlineText: {
    color: colors.success,
  },
  winnerText: {
    color: colors.success,
  },
  lossText: {
    color: colors.danger,
  },
  /* Charts */
  list: {
    gap: spacing.md,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 160,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  groupOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupLabel: {
    width: 72,
  },
  groupBars: {
    flex: 1,
    gap: spacing.xs,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupValue: {
    width: 96,
    textAlign: 'right',
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  ctaButton: {
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSelected,
  },
  /* Table */
  tableNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flexLabel: {
    flex: 1,
    minWidth: 0,
  },
  table: {
    gap: spacing.xs,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  cellMetric: {
    flex: 1.4,
  },
  cellValue: {
    flex: 1,
    textAlign: 'right',
  },
  /* Highlights */
  highlightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  highlightCard: {
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  /* Skeletons */
  skeletonBlock: {
    gap: spacing.sm,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 6,
    backgroundColor: colors.surfaceRaised,
  },
});
