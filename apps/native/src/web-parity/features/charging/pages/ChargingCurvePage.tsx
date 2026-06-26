// Native parity port of web/src/features/charging/pages/ChargingCurvePage.tsx.
//
// The web module is the "Charging Curve" page: a PageContainer (title + subtitle
// + a header actions row with a VehicleSelect and a RangePicker) that, while the
// paginated charging-sessions query loads, shows a LoadingSkeleton; when there
// are no sessions shows a header + an empty GlassPanel + the two AI narrator
// sections; otherwise renders the AI narrators, a session Select (+ TimeStamp /
// start_place caption), a SummaryStatsGrid, a single-session SessionCurveChart +
// SessionDetailPanel (or a "pick a session" placeholder), a SessionComparison
// overlay, a side-by-side ChargerType + SpeedTrend pair, and a Time-to-Charge
// section (cards + YearlyTrendChart). Power/energy come from the API as SI
// (peak_power_w / avg_power_w in watts, total_energy_added_wh in watt-hours);
// the page converts at the display boundary to kW / kWh. Sessions are read from
// GET /charging?vehicle_id=&limit=&start=&end= via the ported paginated hook.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?, vars?) returns the English fallback (or key) and applies
//     {{var}} interpolation, preserving every translation key verbatim at the
//     call site (the only interpolated key is charging.curve.sessionId).
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN); the
//     call site + translated title key are preserved.
//   • @/hooks/useSelectedVehicle -> an inlined native hook over the ported
//     useVehicles() that keeps the "first vehicle is the default" precedence in
//     local state (RN has no router path/query precedence or persisted store).
//     The web's prop-less <VehicleSelect /> shares selection through that hook;
//     RN cannot share local hook state across instances, so the page owns the
//     single useSelectedVehicle() and threads vehicleId/vehicles/onChange into a
//     native VehicleSelect.
//   • @/hooks/useRangeState -> an inlined in-memory range hook (RN has no URL /
//     localStorage); defaultPresetId 'all' seeds start='2015-01-01'..end=today,
//     and setRange replaces the in-memory window that drives the query. The
//     {start,end,setRange} surface the page uses is preserved; persistKey is
//     accepted for parity but has no native persistence target.
//   • @/hooks/useSettings (side-effect theme load) -> the ported native
//     useSettings() query (warms the same /settings cache).
//   • @/hooks/useFormatting (formatCurrency) + the settings-driven locale ->
//     derived from the native useSettings() query exactly like the web hook
//     (`${currency_symbol||'$'}${fmtNumber(amount, decimals ?? decimal_precision,
//     locale)}`).
//   • @/hooks/useChartPalette -> inlined CB-safe (Okabe-Ito) + neon palettes and
//     resolveChartPalette(pref==='neon' ? neon : cb_safe), read from the settings
//     chart_palette pref.
//   • @/lib/numberFormat fmtNumber/fmtInt/fmtWithUnit + @/lib/dateFormat
//     formatDateShort/formatDateTime + @/lib/unitConversion convert*FromSI ->
//     inlined faithfully (fmtNumber: locale-aware fixed-decimal, non-finite -> 0,
//     bad-locale en-US fallback; convertEnergyFromSI kWh = wh/1000;
//     convertPowerFromSI kW = watts/1000). Date formatting uses en-US (RN ships
//     no global-locale singleton).
//   • ../components/charging-curve helpers + types (sessionLabel /
//     generateChargingCurve / avg / durationMinutes / isDcSession /
//     getChargerLabel; CurvePoint / SummaryStats / ChargerTypeStats /
//     MonthlySpeed / TimeToChargeMetrics) -> inlined verbatim (the only deviation
//     is durationMinutes widening endedAt to string|null|undefined for the native
//     ChargingSession shape, and TimeToChargeMetrics.fastest/slowest.id being a
//     string because the native ChargingSession.id is a string).
//   • The shared web SummaryStatsGrid / SessionDetailPanel / SessionComparison
//     Chart / ChargerTypeChart / SpeedTrendChart / TimeToChargeSection /
//     YearlyTrendChart / LoadingSkeleton sub-components -> inlined native
//     equivalents in this file (the sibling charging-curve modules are not yet
//     ported, except SessionCurveChart which IS imported and reused). Every
//     Recharts AreaChart/LineChart/ComposedChart (CartesianGrid/XAxis/YAxis/
//     Tooltip/Bar/Line/Cell + chartGrid/axisTickSm/AREA_DEFAULTS/ChartTooltip)
//     collapses onto the already-ported native <AreaChartWrapper> series model
//     (grid/axes + an always-visible latest-value summary; per-cell CHARGER_COLORS
//     fills collapse to the series-level fallback colour), all wrapped by the
//     ported native <ChartContainer> keeping the exportable data table.
//   • The shared web <PageContainer>/<Select>/<TimeStamp> -> inlined native
//     equivalents (PageContainer header collapses into the ScrollView; Select =
//     a pressable option-chip row whose onChange yields the chosen value
//     mirroring web e.target.value; TimeStamp renders the absolute formatted
//     datetime since the 'auto' time_format runtime is unavailable here).
//   • The shared web <GlassPanel>/<FadeIn>/<EmptyState>/<Skeleton> +
//     <SessionCurveChart> + <AIChargingCurveFingerprintClustering>/
//     <AIMLChargingCurveClustering> -> the already-ported native components.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys); every API path / query key is preserved. The DOM-only
// data-tour attributes carry no native effect and are dropped. No DOM elements,
// react-i18next, framer-motion, Recharts, Leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  useChargingSessionsPaginated,
  type ApiChargingSession,
} from '../../../api/hooks/useCharging';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AIChargingCurveFingerprintClustering} from '../../../components/ai/AIChargingCurveFingerprintClustering';
import {AIMLChargingCurveClustering} from '../../../components/ai/AIMLChargingCurveClustering';
import {
  AreaChartWrapper,
  CHART_COLORS,
  ChartContainer,
} from '../../../components/charts';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {RangePicker} from '../../../components/forms/RangePicker';
import {FadeIn} from '../../../components/motion/FadeIn';
import SessionCurveChart from '../components/charging-curve/SessionCurveChart';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, vars?: TVars) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site, with simple {{var}} interpolation so the
// charging.curve.sessionId 'Session #{{id}}' call still substitutes the id.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, vars) => {
    let out = fallback ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.replace(
          new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'),
          String(value),
        );
      }
    }
    return out;
  }, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ─── inlined @/lib/numberFormat fmtNumber + fmtInt + fmtWithUnit ───────── */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; the web global precision default is 2 and
// a bad locale tag falls back to en-US so a string is always produced.
function fmtNumber(
  v: unknown,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
  const d = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

// web fmtInt(value) = fmtNumber(value, 0).
function fmtInt(v: unknown, locale: string = DEFAULT_LOCALE): string {
  return fmtNumber(v, 0, locale);
}

// web fmtWithUnit(value, unit, decimals?) = `${fmtNumber(value, decimals)} ${unit}`.
function fmtWithUnit(
  v: unknown,
  unit: string,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
  return `${fmtNumber(v, decimals, locale)} ${unit}`;
}

/* ─── inlined @/lib/dateFormat formatDateShort + formatDateTime ─────────── */

// web formatDateShort: "Apr 4" (month short + day numeric); '—' for invalid.
function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(DEFAULT_LOCALE, {month: 'short', day: 'numeric'});
}

// web formatDateTime: "Apr 4, 2026, 02:30 PM"; '—' for invalid.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(DEFAULT_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── inlined @/lib/unitConversion convert{Energy,Power}FromSI ──────────── */

// web convertEnergyFromSI(wh, 'kWh') = wh / 1000.
function convertEnergyFromSI(wh: number, to: 'Wh' | 'kWh'): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

// web convertPowerFromSI(watts, 'kW') = watts / 1000.
function convertPowerFromSI(watts: number, to: 'W' | 'kW'): number {
  return to === 'kW' ? watts / 1000 : watts;
}

/* ─── inlined @/hooks/useFormatting (settings-derived formatCurrency) ───── */

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return DEFAULT_PRECISION;
}

interface FormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
  locale: string;
}

// web useFormatting: formatCurrency(amount, decimals?) =
// `${currency_symbol||'$'}${fmtNumber(amount, decimals ?? decimal_precision)}`,
// using the settings-driven currency symbol, precision, and locale.
function useFormatting(): FormattingResult {
  const {data} = useSettings();
  const locale = deriveLocale(data?.locale);
  const currencySymbol =
    data?.currency_symbol && data.currency_symbol.trim()
      ? data.currency_symbol
      : '$';
  const userPrecision = derivePrecision(data?.decimal_precision);

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision, locale)}`,
    [currencySymbol, userPrecision, locale],
  );

  return {formatCurrency, locale};
}

/* ─── inlined @/hooks/useChartPalette (CB-safe + neon) ──────────────────── */

// web @/lib/colors CHART_COLORS_CB_SAFE (Okabe-Ito) — the static default.
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

// web @/lib/colors CHART_COLORS_NEON — the opt-in stylistic palette.
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

// web resolveChartPalette: 'neon' selects the neon palette, anything else (incl.
// missing/unloaded) falls back to the CB-safe default.
function resolveChartPalette(pref: string | null | undefined): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

function useChartPalette(): readonly string[] {
  const {data} = useSettings();
  return resolveChartPalette(data?.chart_palette);
}

/* ─── inlined ../components/charging-curve/types ────────────────────────── */

// useChargingSessionsPaginated resolves to ApiChargingSession (the /charging row
// shape: id is a number — matching the web ChargingSession — and it already
// carries avg_power_w / start_place / start_odometer_m / end_odometer_m), so the
// web charging-curve components' field access maps onto it 1:1.
type CurveSession = ApiChargingSession;

interface CurvePoint {
  soc: number;
  power: number;
}

interface ChargerTypeStats {
  label: string;
  count: number;
  avgKw: number;
  avgKwh: number;
  avgDuration: number;
}

type MonthlySpeed = {
  month: string;
  dcAvgKw: number;
  acAvgKw: number;
};

interface TimeToChargeMetrics {
  avg10to80: number | null;
  avg20to80: number | null;
  fastest: {rate: number; id: number} | null;
  slowest: {rate: number; id: number} | null;
  yearlyTrend: {
    year: string;
    avg10to80: number;
    avg20to80: number;
    count: number;
  }[];
}

interface SummaryStats {
  totalSessions: number;
  totalEnergy: number;
  avgRate: number;
  peakRate: number;
  avgDuration: number;
  totalCost: number;
}

/* ─── inlined ../components/charging-curve/helpers ──────────────────────── */

function isDcSession(s: CurveSession): boolean {
  return !!(s.charger_type || (s.peak_power_w && s.peak_power_w > 20_000));
}

function getChargerLabel(s: CurveSession): string {
  if (
    s.charger_type === 'Tesla' ||
    (s.charger_type ?? '').toLowerCase().includes('tesla')
  )
    return 'Supercharger';
  if (s.charger_type) return 'DC Fast';
  if (s.peak_power_w && s.peak_power_w > 20_000) return 'DC Fast';
  return 'Home / AC';
}

function durationMinutes(
  startedAt: string,
  endedAt: string | null | undefined,
): number {
  if (!endedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function sessionLabel(s: CurveSession): string {
  const date = formatDateShort(s.started_at);
  const label = getChargerLabel(s);
  const energy =
    s.total_energy_added_wh != null
      ? fmtNumber(s.total_energy_added_wh / 1000, 1)
      : '?';
  return `${date} — ${label} — ${energy} kWh`;
}

/** Simulate a power-vs-SOC curve based on session metadata. */
function generateChargingCurve(session: CurveSession): CurvePoint[] {
  const points: CurvePoint[] = [];
  const startSoc = session.start_soc_pct ?? 0;
  const endSoc = session.end_soc_pct ?? 100;
  const peakPower = (session.peak_power_w ?? 11_000) / 1000;
  const dc = isDcSession(session);

  for (let soc = startSoc; soc <= endSoc; soc += 1) {
    let power: number;
    if (dc) {
      if (soc <= 50) {
        power = peakPower;
      } else if (soc <= 80) {
        const taper = 1 - ((soc - 50) / 30) * 0.5;
        power = peakPower * taper;
      } else {
        const drop = 1 - ((soc - 80) / 20) * 0.7;
        power = peakPower * 0.5 * drop;
      }
    } else {
      power = peakPower;
    }
    points.push({soc, power: Math.max(power, 0)});
  }
  return points;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/* ─── inlined @/components/ui Select ────────────────────────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

// web <Select> (native <select> with a placeholder option) -> a row of pressable
// option chips (the selected chip is accent-tinted); onChange receives the chosen
// option value, mirroring the web `e.target.value` payload. The placeholder is
// surfaced as a caption when nothing is selected.
function Select({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.optionRow}>
      {placeholder && value === '' ? (
        <AppText style={styles.selectPlaceholder} tone="muted" variant="caption">
          {placeholder}
        </AppText>
      ) : null}
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.option,
              active ? styles.optionActive : null,
              pressed ? styles.optionPressed : null,
            ]}>
            <AppText
              numberOfLines={1}
              style={active ? styles.optionTextActive : styles.optionText}
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── inlined @/components/forms VehicleSelect (prop-wired) ──────────────── */

// web <VehicleSelect /> is prop-less and shares the selection through
// useSelectedVehicle's store; RN can't share local hook state across instances,
// so the page owns the single useSelectedVehicle() and threads the selection in.
function VehicleSelect({
  vehicleId,
  vehicles,
  onChange,
}: {
  vehicleId: number | null;
  vehicles: Vehicle[];
  onChange: (id: number | null) => void;
}) {
  const options = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));
  return (
    <Select
      options={options}
      value={vehicleId != null ? String(vehicleId) : ''}
      onChange={val => onChange(Number(val) || null)}
    />
  );
}

/* ─── inlined @/components/data-display TimeStamp ────────────────────────── */

// web <TimeStamp value /> defaults to the 'auto' format (settings-driven
// relative/absolute); the native parity bundle ships no time_format runtime, so
// this renders the absolute formatted datetime.
function TimeStamp({value}: {value: string | null | undefined}) {
  return (
    <AppText style={styles.metaText} tone="secondary" variant="caption">
      {formatDateTime(value)}
    </AppText>
  );
}

/* ─── inlined @/hooks/useSelectedVehicle ────────────────────────────────── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native useSelectedVehicle: RN has no router path/query precedence or persisted
// store, so the selection lives in local state, defaulting to the first vehicle
// the moment the fleet loads (the web hook's final precedence tier).
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const [stored, setVehicleId] = useState<number | null>(null);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  const effectiveId = stored ?? firstVehicleId;
  return {vehicleId: effectiveId, vehicles, setVehicleId};
}

/* ─── inlined @/hooks/useRangeState (in-memory) ─────────────────────────── */

interface RangeValue {
  start: string;
  end: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// web useRangeState resolves URL > localStorage > default preset; RN has neither,
// so the range lives in component state. defaultPresetId 'all' seeds the
// 2015-01-01 .. today floor (the web 'all'-time semantic), and setRange replaces
// the window. persistKey is accepted for parity but has no native target.
function useRangeState(opts: {
  persistKey?: string;
  defaultPresetId?: string;
}): {start: string; end: string; setRange: (range: RangeValue) => void} {
  const [range, setRangeState] = useState<RangeValue>(() => {
    const end = todayIso();
    const start = opts.defaultPresetId === 'all' ? '2015-01-01' : end;
    return {start, end};
  });
  const setRange = useCallback((next: RangeValue) => {
    setRangeState(next);
  }, []);
  return {start: range.start, end: range.end, setRange};
}

/* ─── inlined SummaryStatsGrid ──────────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <GlassPanel style={styles.summaryCard}>
      <AppText numberOfLines={1} style={styles.summaryLabel} tone="secondary">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.summaryValue} weight="semibold">
        {value}
        {unit ? (
          <AppText style={styles.summaryUnit} tone="secondary">
            {' '}
            {unit}
          </AppText>
        ) : null}
      </AppText>
    </GlassPanel>
  );
}

function SummaryStatsGrid({stats}: {stats: SummaryStats | null}) {
  const {t} = useTranslation();
  const {formatCurrency, locale} = useFormatting();

  return (
    <FadeIn delay={0.05}>
      <View style={styles.summaryGrid}>
        <SummaryCard
          label={t('charging.curve.totalSessions', 'Total Sessions')}
          value={fmtInt(stats?.totalSessions ?? 0, locale)}
        />
        <SummaryCard
          label={t('charging.curve.totalEnergy', 'Total Energy')}
          value={fmtNumber(stats?.totalEnergy ?? 0, DEFAULT_PRECISION, locale)}
          unit="kWh"
        />
        <SummaryCard
          label={t('charging.curve.avgChargeRate', 'Avg Charge Rate')}
          value={fmtNumber(stats?.avgRate ?? 0, DEFAULT_PRECISION, locale)}
          unit="kW"
        />
        <SummaryCard
          label={t('charging.curve.peakRate', 'Peak Rate')}
          value={fmtNumber(stats?.peakRate ?? 0, DEFAULT_PRECISION, locale)}
          unit="kW"
        />
        <SummaryCard
          label={t('charging.curve.avgDuration', 'Avg Duration')}
          value={fmtInt(stats?.avgDuration ?? 0, locale)}
          unit="min"
        />
        <SummaryCard
          label={t('charging.curve.totalCost', 'Total Cost')}
          value={formatCurrency(stats?.totalCost ?? 0)}
        />
      </View>
    </FadeIn>
  );
}

/* ─── inlined SessionDetailPanel ────────────────────────────────────────── */

function SessionDetailRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.detailRow}>
      <AppText style={styles.detailLabel} tone="secondary">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.detailValue} weight="semibold">
        {value}
      </AppText>
    </View>
  );
}

function SessionDetailPanel({session}: {session: CurveSession}) {
  const {t} = useTranslation();
  const {formatCurrency, locale} = useFormatting();

  return (
    <GlassPanel style={styles.detailPanel}>
      <AppText style={styles.detailHeading} tone="secondary" weight="semibold">
        {t('charging.curve.sessionDetails', 'Session Details')}
      </AppText>
      <SessionDetailRow
        label={t('charging.curve.date', 'Date')}
        value={formatDateTime(session.started_at)}
      />
      <SessionDetailRow
        label={t('charging.curve.chargerType', 'Charger Type')}
        value={getChargerLabel(session)}
      />
      <SessionDetailRow
        label={t('charging.curve.socRange', 'SOC Range')}
        value={`${session.start_soc_pct}% → ${session.end_soc_pct ?? '?'}%`}
      />
      <SessionDetailRow
        label={t('charging.curve.energyAdded', 'Energy Added')}
        value={fmtWithUnit(
          session.total_energy_added_wh / 1000,
          'kWh',
          DEFAULT_PRECISION,
          locale,
        )}
      />
      <SessionDetailRow
        label={t('charging.curve.peakPower', 'Peak Power')}
        value={fmtWithUnit(
          (session.peak_power_w ?? 0) / 1000,
          'kW',
          DEFAULT_PRECISION,
          locale,
        )}
      />
      {session.avg_power_w != null && (
        <SessionDetailRow
          label={t('charging.curve.avgPower', 'Avg Power')}
          value={fmtWithUnit(
            session.avg_power_w / 1000,
            'kW',
            DEFAULT_PRECISION,
            locale,
          )}
        />
      )}
      <SessionDetailRow
        label={t('charging.curve.duration', 'Duration')}
        value={fmtWithUnit(
          durationMinutes(session.started_at, session.ended_at),
          'min',
          DEFAULT_PRECISION,
          locale,
        )}
      />
      {session.cost_decimal != null && (
        <SessionDetailRow
          label={t('charging.curve.cost_decimal', 'Cost')}
          value={formatCurrency(session.cost_decimal)}
        />
      )}
      {session.start_place && (
        <SessionDetailRow
          label={t('charging.curve.location', 'Location')}
          value={session.start_place}
        />
      )}
    </GlassPanel>
  );
}

/* ─── inlined SessionComparisonChart (Recharts LineChart substitute) ────── */

function SessionComparisonChart({sessions}: {sessions: CurveSession[]}) {
  const {t} = useTranslation();
  const palette = useChartPalette();

  const comparisonSessions = useMemo(() => sessions.slice(0, 10), [sessions]);

  const comparisonData = useMemo(() => {
    if (!comparisonSessions.length) return [];
    const curves = comparisonSessions.map((s, i) => ({
      curve: generateChargingCurve(s),
      key: `s${i}`,
    }));
    const allSocs = new Set<number>();
    curves.forEach(c => c.curve.forEach(p => allSocs.add(p.soc)));
    const socValues = Array.from(allSocs).sort((a, b) => a - b);

    return socValues.map(soc => {
      const point: Record<string, number> = {soc};
      curves.forEach(({curve, key}) => {
        const match = curve.find(p => p.soc === soc);
        if (match) point[key] = Math.round(match.power * 10) / 10;
      });
      return point;
    });
  }, [comparisonSessions]);

  const series = comparisonSessions.map((s, i) => ({
    key: `s${i}`,
    label: `${formatDateShort(s.started_at)} (${getChargerLabel(s)})`,
    color: palette[i % palette.length] ?? colors.accent,
  }));

  return (
    <FadeIn delay={0.15}>
      {/* chart-a11y:no-table dense overlay of up to 10 power curves; per-session detail available on the session page */}
      <ChartContainer
        title={t('charging.curve.sessionComparison', 'Session Comparison')}
        subtitle={t(
          'charging.curve.sessionComparisonDesc',
          'Power curves overlaid from last 10 sessions',
        )}
        ariaLabel={t(
          'charging.curve.sessionComparison.aria',
          'Overlaid power-vs-SOC line chart comparing the last several charging sessions',
        )}
        height={300}
        exportable
        exportFilename="session-comparison">
        <AreaChartWrapper
          data={comparisonData}
          xKey="soc"
          series={series}
          height={300}
          yFormatter={(value: number) => `${Math.round(value * 10) / 10} kW`}
        />
      </ChartContainer>
    </FadeIn>
  );
}

/* ─── inlined ChargerTypeChart (Recharts ComposedChart substitute) ──────── */

function ChargerTypeChart({sessions}: {sessions: CurveSession[]}) {
  const {t} = useTranslation();
  const {locale} = useFormatting();

  const chargerTypeStats = useMemo((): ChargerTypeStats[] => {
    if (!sessions.length) return [];
    const groups = new Map<string, CurveSession[]>();
    sessions.forEach(s => {
      const label = getChargerLabel(s);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(s);
    });
    return Array.from(groups.entries()).map(
      ([label, items]): ChargerTypeStats => ({
        label,
        count: items.length,
        avgKw: avg(items.map(s => (s.peak_power_w ?? 0) / 1000)),
        avgKwh: avg(items.map(s => s.total_energy_added_wh / 1000)),
        avgDuration: avg(items.map(s => durationMinutes(s.started_at, s.ended_at))),
      }),
    );
  }, [sessions]);

  return (
    <ChartContainer
      title={t('charging.curve.chargerType', 'Charge Rate by Charger Type')}
      subtitle={t(
        'charging.curve.chargerTypeDesc',
        'Average kW and kWh per charger category',
      )}
      ariaLabel={t(
        'charging.curve.chargerType.aria',
        'Composed bar/line chart of average power and energy per charger type',
      )}
      data={chargerTypeStats.map(s => ({
        label: s.label,
        count: s.count,
        avgKw: fmtNumber(s.avgKw, 1, locale),
        avgKwh: fmtNumber(s.avgKwh, 1, locale),
        avgDuration: fmtInt(s.avgDuration, locale),
      }))}
      dataColumns={[
        {key: 'label', label: t('charging.curve.col.charger', 'Charger Type')},
        {key: 'count', label: t('charging.curve.col.sessions', 'Sessions')},
        {key: 'avgKw', label: t('charging.curve.col.avgKw', 'Avg kW')},
        {key: 'avgKwh', label: t('charging.curve.col.avgKwh', 'Avg kWh')},
        {key: 'avgDuration', label: t('charging.curve.col.avgMin', 'Avg minutes')},
      ]}
      height={280}
      exportable
      exportFilename="charge-rate-by-type">
      <AreaChartWrapper
        data={chargerTypeStats.map(s => ({
          label: s.label,
          avgKw: s.avgKw,
          avgKwh: s.avgKwh,
        }))}
        xKey="label"
        series={[
          {
            key: 'avgKw',
            label: t('charging.curve.avgPower', 'Avg Power'),
            color: CHART_COLORS[3],
          },
          {
            key: 'avgKwh',
            label: t('charging.curve.avgEnergy', 'Avg Energy'),
            color: CHART_COLORS[4],
          },
        ]}
        height={280}
        yFormatter={(value: number) => fmtNumber(value, 1, locale)}
      />
      <View style={styles.legendList}>
        {chargerTypeStats.map(ct => (
          <View key={ct.label} style={styles.legendRow}>
            <View style={styles.legendLabelGroup}>
              <View
                style={[
                  styles.legendDot,
                  {backgroundColor: CHART_COLORS[3]},
                ]}
              />
              <AppText style={styles.legendText} tone="secondary" variant="caption">
                {ct.label}
              </AppText>
            </View>
            <AppText style={styles.legendText} tone="secondary" variant="caption">
              {`${fmtInt(ct.count, locale)} ${t(
                'charging.curve.sessions',
                'sessions',
              )} · ${fmtNumber(ct.avgDuration, DEFAULT_PRECISION, locale)} ${t(
                'charging.curve.minAvg',
                'min avg',
              )}`}
            </AppText>
          </View>
        ))}
      </View>
    </ChartContainer>
  );
}

/* ─── inlined SpeedTrendChart (Recharts LineChart substitute) ───────────── */

function SpeedTrendChart({sessions}: {sessions: CurveSession[]}) {
  const {t} = useTranslation();
  const palette = useChartPalette();

  const monthlyTrend = useMemo((): MonthlySpeed[] => {
    if (!sessions.length) return [];
    const byMonth = new Map<string, {dc: number[]; ac: number[]}>();
    sessions.forEach(s => {
      const month = (s.started_at ?? '').slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, {dc: [], ac: []});
      const group = byMonth.get(month)!;
      const power = convertPowerFromSI(s.peak_power_w ?? 0, 'kW');
      if (isDcSession(s)) group.dc.push(power);
      else group.ac.push(power);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, {dc, ac}]) => ({
        month,
        dcAvgKw: Math.round(avg(dc) * 10) / 10,
        acAvgKw: Math.round(avg(ac) * 10) / 10,
      }));
  }, [sessions]);

  return (
    <ChartContainer
      title={t('charging.curve.speedTrend', 'Charging Speed Trend')}
      subtitle={t(
        'charging.curve.speedTrendDesc',
        'Monthly average DC vs AC charge rate',
      )}
      ariaLabel={t(
        'charging.curve.speedTrend.aria',
        'Monthly average DC and AC charging speed line chart',
      )}
      data={monthlyTrend.map(m => ({
        month: m.month,
        dcAvgKw: m.dcAvgKw,
        acAvgKw: m.acAvgKw,
      }))}
      dataColumns={[
        {key: 'month', label: t('charging.curve.col.month', 'Month')},
        {key: 'dcAvgKw', label: t('charging.curve.col.dcAvgKw', 'DC Avg kW')},
        {key: 'acAvgKw', label: t('charging.curve.col.acAvgKw', 'AC Avg kW')},
      ]}
      height={280}
      exportable
      exportFilename="charging-speed-trend">
      <AreaChartWrapper
        data={monthlyTrend}
        xKey="month"
        series={[
          {
            key: 'dcAvgKw',
            label: t('charging.curve.dcAvg', 'DC Avg'),
            color: palette[0] ?? colors.accent,
          },
          {
            key: 'acAvgKw',
            label: t('charging.curve.acAvg', 'AC Avg'),
            color: palette[1] ?? colors.success,
          },
        ]}
        height={280}
        yFormatter={(value: number) => `${Math.round(value * 10) / 10} kW`}
      />
      <View style={styles.legendInline}>
        <View style={styles.legendLabelGroup}>
          <View style={[styles.legendChip, {backgroundColor: '#00f0ff'}]} />
          <AppText style={styles.legendText} tone="secondary" variant="caption">
            {t('charging.curve.dcFast', 'DC Fast')}
          </AppText>
        </View>
        <View style={styles.legendLabelGroup}>
          <View style={[styles.legendChip, {backgroundColor: '#10b981'}]} />
          <AppText style={styles.legendText} tone="secondary" variant="caption">
            {t('charging.curve.acHome', 'AC / Home')}
          </AppText>
        </View>
      </View>
    </ChartContainer>
  );
}

/* ─── inlined YearlyTrendChart (Recharts ComposedChart substitute) ──────── */

function YearlyTrendChart({
  yearlyTrend,
}: {
  yearlyTrend: {
    year: string;
    avg10to80: number;
    avg20to80: number;
    count: number;
  }[];
}) {
  const {t} = useTranslation();

  return (
    <ChartContainer
      title={t('charging.curve.yearlyTrend', 'Yearly Charging Speed Trend')}
      subtitle={t(
        'charging.curve.yearlyTrendDesc',
        'Average time-to-charge and session count by year',
      )}
      ariaLabel={t(
        'charging.curve.yearlyTrend.aria',
        'Yearly average charge-time and session-count composed chart',
      )}
      data={yearlyTrend}
      dataColumns={[
        {key: 'year', label: t('charging.curve.col.year', 'Year')},
        {
          key: 'avg10to80',
          label: t('charging.curve.col.avg10to80', '10→80% avg min'),
        },
        {
          key: 'avg20to80',
          label: t('charging.curve.col.avg20to80', '20→80% avg min'),
        },
        {key: 'count', label: t('charging.curve.col.dcSessions', 'DC Sessions')},
      ]}
      height={280}
      exportable
      exportFilename="yearly-charging-trend">
      {yearlyTrend.length > 0 ? (
        <AreaChartWrapper
          data={yearlyTrend}
          xKey="year"
          series={[
            {
              key: 'count',
              label: t('charging.curve.dcSessions', 'DC Sessions'),
              color: CHART_COLORS[5],
            },
            {
              key: 'avg10to80',
              label: t('charging.curve.avg10to80Line', '10→80% avg'),
              color: CHART_COLORS[0],
            },
            {
              key: 'avg20to80',
              label: t('charging.curve.avg20to80Line', '20→80% avg'),
              color: CHART_COLORS[2],
            },
          ]}
          height={280}
          yFormatter={(value: number) => `${Math.round(value * 10) / 10}`}
        />
      ) : (
        <EmptyState
          message={t('common.noData', 'No data available')}
          style={styles.chartEmpty}
        />
      )}
    </ChartContainer>
  );
}

/* ─── inlined TimeToChargeSection ───────────────────────────────────────── */

function TimeToChargeCard({
  label,
  value,
  unit,
  subtitle,
}: {
  label: string;
  value: string | null;
  unit?: string;
  subtitle?: string;
}) {
  return (
    <GlassPanel style={styles.ttcCard}>
      <AppText style={styles.ttcLabel} tone="secondary">
        {label}
      </AppText>
      <AppText style={styles.ttcValue} weight="semibold">
        {value ?? '—'}
        {unit && value ? (
          <AppText style={styles.ttcUnit} tone="secondary">
            {' '}
            {unit}
          </AppText>
        ) : null}
      </AppText>
      {subtitle ? (
        <AppText style={styles.ttcSubtitle} tone="muted" variant="caption">
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

function TimeToChargeSection({sessions}: {sessions: CurveSession[]}) {
  const {t} = useTranslation();
  const {locale} = useFormatting();

  const timeToCharge = useMemo((): TimeToChargeMetrics => {
    const empty: TimeToChargeMetrics = {
      avg10to80: null,
      avg20to80: null,
      fastest: null,
      slowest: null,
      yearlyTrend: [],
    };
    if (!sessions.length) return empty;

    const dcSessions = sessions.filter(isDcSession);
    if (!dcSessions.length) return empty;

    const cross10to80 = dcSessions.filter(
      s => s.start_soc_pct <= 10 && (s.end_soc_pct ?? 0) >= 80,
    );
    const cross20to80 = dcSessions.filter(
      s => s.start_soc_pct <= 20 && (s.end_soc_pct ?? 0) >= 80,
    );

    const avg10to80 = cross10to80.length
      ? avg(cross10to80.map(s => durationMinutes(s.started_at, s.ended_at)))
      : null;
    const avg20to80 = cross20to80.length
      ? avg(cross20to80.map(s => durationMinutes(s.started_at, s.ended_at)))
      : null;

    const withRate = dcSessions
      .filter(
        s =>
          durationMinutes(s.started_at, s.ended_at) > 0 &&
          s.total_energy_added_wh > 0,
      )
      .map(s => ({
        id: s.id,
        rate:
          (convertEnergyFromSI(s.total_energy_added_wh, 'kWh') /
            durationMinutes(s.started_at, s.ended_at)) *
          60,
      }));

    const fastest = withRate.length
      ? withRate.reduce((a, b) => (a.rate > b.rate ? a : b))
      : null;
    const slowest = withRate.length
      ? withRate.reduce((a, b) => (a.rate < b.rate ? a : b))
      : null;

    const byYear = new Map<string, {d10: number[]; d20: number[]; count: number}>();
    dcSessions.forEach(s => {
      const year = (s.started_at ?? '').slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, {d10: [], d20: [], count: 0});
      const g = byYear.get(year)!;
      g.count++;
      if (s.start_soc_pct <= 10 && (s.end_soc_pct ?? 0) >= 80)
        g.d10.push(durationMinutes(s.started_at, s.ended_at));
      if (s.start_soc_pct <= 20 && (s.end_soc_pct ?? 0) >= 80)
        g.d20.push(durationMinutes(s.started_at, s.ended_at));
    });

    const yearlyTrend = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, {d10, d20, count}]) => ({
        year,
        avg10to80: Math.round(avg(d10) * 10) / 10,
        avg20to80: Math.round(avg(d20) * 10) / 10,
        count,
      }));

    return {avg10to80, avg20to80, fastest, slowest, yearlyTrend};
  }, [sessions]);

  return (
    <FadeIn delay={0.25}>
      <View style={styles.ttcStack}>
        <AppText style={styles.sectionTitle} weight="semibold">
          {t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}
        </AppText>
        <AppText style={styles.sectionSubtitle} tone="secondary">
          {t(
            'charging.curve.timeToChargeDesc',
            'How long DC sessions take to reach key SOC thresholds',
          )}
        </AppText>

        <View style={styles.ttcGrid}>
          <TimeToChargeCard
            label={t('charging.curve.avg10to80', '10% → 80%')}
            value={
              timeToCharge.avg10to80 != null
                ? fmtNumber(timeToCharge.avg10to80, DEFAULT_PRECISION, locale)
                : null
            }
            unit="min"
            subtitle={t('charging.curve.avgDuration', 'Avg duration')}
          />
          <TimeToChargeCard
            label={t('charging.curve.avg20to80', '20% → 80%')}
            value={
              timeToCharge.avg20to80 != null
                ? fmtNumber(timeToCharge.avg20to80, DEFAULT_PRECISION, locale)
                : null
            }
            unit="min"
            subtitle={t('charging.curve.avgDuration', 'Avg duration')}
          />
          <TimeToChargeCard
            label={t('charging.curve.fastest', 'Fastest Session')}
            value={
              timeToCharge.fastest
                ? fmtNumber(timeToCharge.fastest.rate, DEFAULT_PRECISION, locale)
                : null
            }
            unit="kWh/h"
            subtitle={
              timeToCharge.fastest
                ? t('charging.curve.sessionId', 'Session #{{id}}', {
                    id: timeToCharge.fastest.id,
                  })
                : undefined
            }
          />
          <TimeToChargeCard
            label={t('charging.curve.slowest', 'Slowest Session')}
            value={
              timeToCharge.slowest
                ? fmtNumber(timeToCharge.slowest.rate, DEFAULT_PRECISION, locale)
                : null
            }
            unit="kWh/h"
            subtitle={
              timeToCharge.slowest
                ? t('charging.curve.sessionId', 'Session #{{id}}', {
                    id: timeToCharge.slowest.id,
                  })
                : undefined
            }
          />
        </View>

        <YearlyTrendChart yearlyTrend={timeToCharge.yearlyTrend} />
      </View>
    </FadeIn>
  );
}

/* ─── inlined LoadingSkeleton ───────────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <View style={styles.sectionStack}>
      <View style={styles.skelHeader}>
        <Skeleton height={32} width="60%" />
        <Skeleton height={16} width="80%" />
      </View>

      <View style={styles.skelRow}>
        <Skeleton height={40} width="40%" />
        <Skeleton height={40} width="55%" />
      </View>

      <View style={styles.summaryGrid}>
        {Array.from({length: 6}).map((_, i) => (
          <GlassPanel key={i} style={styles.skelCard}>
            <Skeleton height={12} width="55%" />
            <Skeleton height={28} style={styles.skelMt} width="65%" />
          </GlassPanel>
        ))}
      </View>

      <GlassPanel style={styles.skelPanel}>
        <Skeleton height={20} width="40%" />
        <Skeleton height={256} style={styles.skelMt} />
      </GlassPanel>

      <GlassPanel style={styles.skelPanel}>
        <Skeleton height={20} width="55%" />
        <Skeleton height={208} style={styles.skelMt} />
      </GlassPanel>

      <View style={styles.twoColumn}>
        <GlassPanel style={[styles.skelPanel, styles.twoColumnCell]}>
          <Skeleton height={20} width="45%" />
          <Skeleton height={192} style={styles.skelMt} />
        </GlassPanel>
        <GlassPanel style={[styles.skelPanel, styles.twoColumnCell]}>
          <Skeleton height={20} width="45%" />
          <Skeleton height={192} style={styles.skelMt} />
        </GlassPanel>
      </View>

      <View style={styles.summaryGrid}>
        {Array.from({length: 4}).map((_, i) => (
          <GlassPanel key={i} style={styles.skelCard}>
            <Skeleton height={12} width="60%" />
            <Skeleton height={28} style={styles.skelMt} width="50%" />
          </GlassPanel>
        ))}
      </View>
    </View>
  );
}

/* ─── ChargingCurvePage ─────────────────────────────────────────────────── */

export default function ChargingCurvePage(): React.ReactElement {
  const {t} = useTranslation();
  useSettings();
  usePageTitle(t('charging.curve.title', 'Charging Curve'));

  /* ── Vehicle & Session selection ─────────────────────────────────────── */

  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const activeVehicleId = vehicleId ?? null;

  const {start, end, setRange} = useRangeState({
    persistKey: 'charging-curve.range',
    defaultPresetId: 'all',
  });

  const {data: sessionsData, isLoading} = useChargingSessionsPaginated(
    activeVehicleId,
    {
      limit: 200,
      start,
      end,
    },
  );

  const sessions = useMemo<CurveSession[]>(
    () => sessionsData ?? [],
    [sessionsData],
  );

  const sessionOptions = useMemo(
    () =>
      sessions.map(s => ({
        value: String(s.id),
        label: sessionLabel(s),
      })),
    [sessions],
  );

  const handleSessionChange = (value: string) => {
    setSelectedSessionId(Number(value) || null);
  };

  /* ── Computed Data ───────────────────────────────────────────────────── */

  const stats = useMemo((): SummaryStats | null => {
    if (!sessions.length) return null;
    const totalEnergy = sessions.reduce(
      (sum, s) => sum + (s.total_energy_added_wh ?? 0),
      0,
    );
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost_decimal ?? 0), 0);
    const avgDuration = avg(
      sessions.map(s => durationMinutes(s.started_at, s.ended_at)),
    );
    const powers = sessions.map(s => (s.peak_power_w ?? 0) / 1000);
    const avgRate = avg(powers);
    const peakRate = Math.max(...powers);
    return {
      totalSessions: sessions.length,
      totalEnergy,
      avgRate,
      peakRate,
      avgDuration,
      totalCost,
    };
  }, [sessions]);

  const selectedSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const curveData = useMemo(
    () => (selectedSession ? generateChargingCurve(selectedSession) : []),
    [selectedSession],
  );

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
        <FadeIn>
          <View style={styles.maxWidth}>
            <LoadingSkeleton />
          </View>
        </FadeIn>
      </ScrollView>
    );
  }

  const isEmpty = sessions.length === 0;

  if (isEmpty) {
    return (
      <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
        <FadeIn>
          <View style={styles.maxWidth}>
            <View style={styles.pageHeader}>
              <View style={styles.pageHeaderText}>
                <AppText style={styles.pageTitle} weight="bold">
                  {t('charging.curve.title', 'Charging Curve')}
                </AppText>
                <AppText style={styles.pageSubtitle} tone="secondary">
                  {t(
                    'charging.curve.subtitle',
                    'Power vs state-of-charge across sessions',
                  )}
                </AppText>
              </View>
              <View style={styles.pageActions}>
                <VehicleSelect
                  vehicleId={vehicleId}
                  vehicles={vehicles}
                  onChange={setVehicleId}
                />
                <RangePicker
                  value={{start, end}}
                  onChange={r => {
                    setRange(r);
                    setSelectedSessionId(null);
                  }}
                  align="end"
                  triggerTestId="charging-curve-range"
                />
              </View>
            </View>

            <GlassPanel style={styles.emptyPanel}>
              <AppText style={styles.emptyTitle} tone="secondary" weight="semibold">
                {t('charging.curve.empty', 'No charging sessions to plot a curve.')}
              </AppText>
              <AppText style={styles.emptyHint} tone="muted" variant="caption">
                {t(
                  'charging.curve.emptyHint',
                  'Start a charging session and data will appear here.',
                )}
              </AppText>
            </GlassPanel>

            {/* AI charging-curve fingerprint cluster narrator — present in the
                empty branch too; the inner Explain button stays disabled until a
                vehicle is in scope. */}
            <FadeIn delay={0.05}>
              <AIChargingCurveFingerprintClustering
                vehicleId={vehicleId ?? undefined}
              />
            </FadeIn>

            {/* ML charging-curve clustering narrator — independent per-feature
                toggle; the inner Train button stays disabled until a vehicle is
                in scope. */}
            <FadeIn delay={0.07}>
              <AIMLChargingCurveClustering vehicleId={vehicleId ?? undefined} />
            </FadeIn>
          </View>
        </FadeIn>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {t('charging.curve.title', 'Charging Curve')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="secondary">
            {t(
              'charging.curve.subtitle',
              'Power vs state-of-charge across sessions',
            )}
          </AppText>
        </View>
        <View style={styles.pageActions}>
          <VehicleSelect
            vehicleId={vehicleId}
            vehicles={vehicles}
            onChange={setVehicleId}
          />
          <RangePicker
            value={{start, end}}
            onChange={r => {
              setRange(r);
              setSelectedSessionId(null);
            }}
            align="end"
            triggerTestId="charging-curve-range"
          />
        </View>
      </View>

      <View style={styles.sectionStack}>
        {/* AI charging-curve fingerprint cluster narrator, above the
            deterministic charts. */}
        <FadeIn delay={0.05}>
          <AIChargingCurveFingerprintClustering vehicleId={vehicleId ?? undefined} />
        </FadeIn>

        {/* ML charging-curve clustering narrator — sibling with an independent
            per-feature toggle. */}
        <FadeIn delay={0.07}>
          <AIMLChargingCurveClustering vehicleId={vehicleId ?? undefined} />
        </FadeIn>

        {/* Session Selector */}
        <View style={styles.selectorRow}>
          <Select
            value={String(selectedSessionId ?? '')}
            onChange={handleSessionChange}
            options={sessionOptions}
            placeholder={t(
              'charging.curve.selectSession',
              'Select a session to inspect',
            )}
          />
          {selectedSession ? (
            <View style={styles.selectorMeta}>
              <TimeStamp value={selectedSession.started_at} />
              {selectedSession.start_place ? (
                <AppText style={styles.metaText} tone="secondary" variant="caption">
                  {` · ${selectedSession.start_place}`}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Summary Stats */}
        <SummaryStatsGrid stats={stats} />

        {/* Single Session Curve + Detail Sidebar */}
        <FadeIn delay={0.1}>
          {selectedSession ? (
            <View style={styles.curveGrid}>
              <View style={styles.curveChartCell}>
                <SessionCurveChart curveData={curveData} />
              </View>
              <View style={styles.curveDetailCell}>
                <SessionDetailPanel session={selectedSession} />
              </View>
            </View>
          ) : (
            <GlassPanel style={styles.curvePlaceholder}>
              <AppText
                style={styles.curvePlaceholderText}
                tone="muted"
                variant="caption">
                {t(
                  'charging.curve.selectSessionHint',
                  'Select a session above to view its charging curve',
                )}
              </AppText>
            </GlassPanel>
          )}
        </FadeIn>

        {/* Session Comparison */}
        <SessionComparisonChart sessions={sessions} />

        {/* Charger Type + Speed Trend (side by side) */}
        <FadeIn delay={0.2}>
          <View style={styles.twoColumn}>
            <View style={styles.twoColumnCell}>
              <ChargerTypeChart sessions={sessions} />
            </View>
            <View style={styles.twoColumnCell}>
              <SpeedTrendChart sessions={sessions} />
            </View>
          </View>
        </FadeIn>

        {/* Time-to-Charge Analysis */}
        <TimeToChargeSection sessions={sessions} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  maxWidth: {
    alignSelf: 'stretch',
    gap: spacing.lg,
    width: '100%',
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  pageHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
    fontSize: 13,
    lineHeight: 18,
  },
  pageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  sectionStack: {
    gap: spacing.lg,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  twoColumnCell: {
    flexGrow: 1,
    flexBasis: '100%',
    minWidth: 280,
  },

  /* Select / VehicleSelect */
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectPlaceholder: {
    marginRight: spacing.xs,
  },
  option: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 32,
    justifyContent: 'center',
  },
  optionActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
    maxWidth: 320,
  },
  optionTextActive: {
    color: colors.accent,
    maxWidth: 320,
  },

  /* Session selector meta */
  selectorRow: {
    gap: spacing.sm,
  },
  selectorMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 12,
    lineHeight: 16,
  },

  /* Summary stats */
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
    padding: spacing.md,
    overflow: 'hidden',
  },
  summaryLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    marginTop: spacing.xs,
  },
  summaryUnit: {
    fontSize: 12,
    lineHeight: 16,
  },

  /* Session detail panel */
  detailPanel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  detailHeading: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  detailValue: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
    textAlign: 'right',
  },

  /* Curve grid */
  curveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  curveChartCell: {
    flexGrow: 1,
    flexBasis: '100%',
    minWidth: 280,
  },
  curveDetailCell: {
    flexGrow: 1,
    flexBasis: '100%',
    minWidth: 280,
  },
  curvePlaceholder: {
    minHeight: 192,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  curvePlaceholderText: {
    textAlign: 'center',
  },

  /* Empty state branch */
  emptyPanel: {
    marginTop: spacing.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyHint: {
    textAlign: 'center',
  },

  /* Chart legends */
  legendList: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  legendInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  legendLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendChip: {
    width: 12,
    height: 8,
    borderRadius: 2,
  },
  legendText: {
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  chartEmpty: {
    paddingVertical: spacing.xl,
  },

  /* Time-to-charge */
  ttcStack: {
    gap: spacing.md,
  },
  ttcGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  ttcCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
    padding: spacing.md,
  },
  ttcLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  ttcValue: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    marginTop: spacing.xs,
  },
  ttcUnit: {
    fontSize: 13,
    lineHeight: 18,
  },
  ttcSubtitle: {
    marginTop: spacing.xs,
  },

  /* Loading skeleton */
  skelHeader: {
    gap: spacing.sm,
  },
  skelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  skelCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
    padding: spacing.md,
  },
  skelPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  skelMt: {
    marginTop: spacing.sm,
  },
});
