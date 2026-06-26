// Native parity port of web/src/features/driving/pages/RouteEfficiencyPage.tsx.
//
// The web module is the "Route Efficiency" page: a PageContainer (title +
// subtitle + a header actions row with a prop-less VehicleSelect and a
// RangePicker) that renders a 4-up summary-stats GlassPanel (AnimatedNumber
// counts), the AI route-efficiency narrator, a per-route best/avg/worst
// comparison bar chart (only when chartData.length > 1), a StaggerContainer of
// per-route RouteCards, and a "Route Metrics" GlassPanel of MetricBars (or an
// EmptyState). Route efficiency is read from
// GET /analytics/route-efficiency?vehicle_id=&start=&end= via the ported
// useRouteEfficiency hook. avgEfficiency/bestEfficiency/worstEfficiency arrive
// as SI Wh/km and avgDistanceKm as kilometres; the page converts at the display
// boundary to the user's distance unit (Wh/km vs Wh/mi via *1.609344, and km vs
// mi via convertDistanceFromSI).
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or key), preserving every
//     translation key verbatim at the call site (no key here is interpolated).
//   • @/hooks/usePageTitle -> a native no-op hook (no document.title in RN); the
//     call site + translated title key are preserved.
//   • @/hooks/useSelectedVehicle -> an inlined native hook over the ported
//     useVehicles() that keeps the "first vehicle is the default" precedence in
//     local state (RN has no router path/query precedence or persisted store).
//     The web's prop-less <VehicleSelect /> shares selection through that hook;
//     RN cannot share local hook state across instances, so the page owns the
//     single useSelectedVehicle() and threads vehicleId/vehicles/onChange into a
//     native option-chip Select.
//   • @/hooks/useUrlState (useUrlString 'from'/'to' + useUrlBatch) -> in-memory
//     useState (RN has no browser URL / search params); the from/to window still
//     drives the query and the RangePicker still calls setRangeBatch({from,to}).
//   • @/hooks/useUnits -> an inlined useUnits() that derives unitPrefs.distance
//     from the ported useSettings() (unit_of_length 'mi' => 'mi', else 'km'),
//     exactly like the web deriveDistance; the unitPrefs.distance call sites are
//     preserved verbatim.
//   • @/lib/numberFormat fmtNumber/fmtInt + @/lib/unitConversion
//     convertDistanceFromSI -> inlined faithfully (fmtNumber: locale-aware
//     fixed-decimal, non-finite -> 0, bad-locale en-US fallback; fmtInt =
//     fmtNumber(_, 0); convertDistanceFromSI: meters/1000 km, meters/1609.344
//     mi). RN ships no global number-format locale singleton, so formatting uses
//     en-US (the web default before settings configure it).
//   • @/components/ui Badge/IconBox + @/components/data-display AnimatedNumber/
//     MetricBar + @/components/motion StaggerContainer/StaggerItem + lucide-react
//     icons -> inlined native equivalents (Badge pill via theme tokens; IconBox +
//     MapPin collapse onto the ported <SemanticIcon name="mapPinned">; the
//     ArrowRight/TrendingUp/Activity glyphs collapse onto a "->" text arrow, an
//     accent "↗" glyph, and <SemanticIcon name="activity">; AnimatedNumber is the
//     canonical requestAnimationFrame ease-out-quad count-up with reduce-motion
//     fallback; MetricBar is the label + value readout + track/fill; the stagger
//     entrance collapses onto the ported <FadeIn> with a per-index delay).
//   • @/components/layout PageContainer -> inlined native PageContainer (header +
//     ScrollView; loading -> ActivityIndicator, error -> error box, else
//     children) preserving title/subtitle/actions/loading/error.
//   • @/components/charts ChartContainer + the Recharts BarChart stack ->
//     ChartContainer is the already-ported native component (keeps the
//     title/ariaLabel + exportable data table); the vertical-layout grouped
//     BarChart (best/avg/worst per route) collapses onto an inlined native
//     horizontal grouped-bar layout with the same #10b981/#00f0ff/#ef4444 series
//     colours and a legend.
//   • @/components/feedback EmptyState + @/components/motion FadeIn +
//     @/components/forms RangePicker + @/components/ai AIRouteEfficiencySuggestions
//     -> the already-ported native components.
// Field access stays snake_case where the API uses it; the RouteSummary camelCase
// fields (startLocation/avgEfficiency/...) come straight from the ported hook's
// type. Every API path / query key is preserved. No DOM elements, react-i18next,
// framer-motion, Recharts, Leaflet, react-dom, or web UI-kit modules are imported
// into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {useRouteEfficiency, type RouteSummary} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AIRouteEfficiencySuggestions} from '../../../components/ai/AIRouteEfficiencySuggestions';
import {ChartContainer} from '../../../components/charts';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {RangePicker} from '../../../components/forms/RangePicker';
import {FadeIn} from '../../../components/motion/FadeIn';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── shared series colours (web Recharts fills + RouteCard gradient stops) ── */

const SERIES_BEST = '#10b981';
const SERIES_AVG = '#00f0ff';
const SERIES_WORST = '#ef4444';
const SERIES_TRIPS = '#a855f7';

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ─── inlined @/lib/numberFormat fmtNumber + fmtInt ─────────────────────── */

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

/* ─── inlined @/lib/unitConversion convertDistanceFromSI ────────────────── */

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
// web efficiencyUnit math: Wh/km -> Wh/mi multiplies by the km-per-mile factor.
const KM_PER_MILE = 1.609344;

type DistanceUnitPref = 'km' | 'mi';

// Pure SI meters -> display distance (web lib convertDistanceFromSI): km divides
// by 1000, mi divides by 1609.344.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/* ─── inlined @/hooks/useUnits (settings-derived; distance only) ─────────── */

interface UnitPrefs {
  distance: DistanceUnitPref;
}

// web useUnits' deriveDistance: 'mi' selects miles, everything else km. The page
// only reads unitPrefs.distance, so the native hook surfaces just that field.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  const unitPrefs = useMemo<UnitPrefs>(() => ({distance}), [distance]);
  return {unitPrefs};
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

/* ─── reduce-motion-aware count-up (web @/components/data-display) ────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// web AnimatedNumber: a requestAnimationFrame loop eases (ease-out quad,
// 1-(1-p)^2) from 0 to `value` over `duration` seconds, rendering
// fmtNumber(display, decimals) with tabular-nums. Reduced motion jumps straight
// to the final value (same final output); the rAF is cancelled on unmount so no
// timer dangles under --detectOpenHandles.
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  style,
  testID,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }

    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [decimals, duration, reduceMotion, value]);

  return (
    <AppText style={[styles.tabularNums, style]} testID={testID} weight="bold">
      {fmtNumber(display, decimals)}
    </AppText>
  );
}

/* ─── inlined @/components/ui Badge ─────────────────────────────────────── */

type EfficiencyVariant = 'success' | 'info' | 'warning' | 'danger';

// web Badge variant tints -> native theme-token tints (info has no surface token,
// so it carries an explicit blue to mirror the web blue-100/blue-800 chip).
const BADGE_PALETTE: Record<EfficiencyVariant, {bg: string; fg: string}> = {
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  info: {bg: 'rgba(59, 130, 246, 0.16)', fg: '#60a5fa'},
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
};

function Badge({
  variant = 'info',
  children,
}: {
  variant?: EfficiencyVariant;
  children: React.ReactNode;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── inlined @/components/data-display MetricBar ────────────────────────── */

// web MetricBar: a label + a colored value readout (sublabel ?? fmtNumber(value))
// above an animated fill capped at 100%. The native fill is static (the value is
// already meaningful without the 1s grow tween).
function MetricBar({
  value,
  max,
  color,
  label,
  sublabel,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View>
      <View style={styles.metricBarHeader}>
        <AppText numberOfLines={1} style={styles.metricBarLabel} variant="caption" weight="semibold">
          {label}
        </AppText>
        <AppText style={[styles.metricBarValue, {color}]} variant="caption">
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View style={[styles.metricBarFill, {width: `${pct}%`, backgroundColor: color}]} />
      </View>
    </View>
  );
}

/* ─── inlined @/components/ui Select (VehicleSelect substitute) ──────────── */

interface SelectOption {
  value: string;
  label: string;
}

// web prop-less <VehicleSelect/> (a shared <Select>) -> a row of pressable option
// chips (the selected chip is accent-tinted). onChange receives the chosen option
// value, mirroring the web `e.target.value` payload.
function Select({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.optionRow}>
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

/* ─── inlined @/components/layout PageContainer ──────────────────────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: React.ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ─── helpers (web RouteEfficiencyPage L33) ─────────────────────────────── */

function efficiencyVariant(eff: number): EfficiencyVariant {
  if (eff < 140) {
    return 'success';
  }
  if (eff < 180) {
    return 'info';
  }
  if (eff < 220) {
    return 'warning';
  }
  return 'danger';
}

/* ─── native grouped-bar comparison (web Recharts vertical BarChart) ─────── */

interface ChartRow {
  name: string;
  avg: number;
  best: number;
  worst: number;
  trips: number;
}

// web <BarChart layout="vertical"> with best/avg/worst Bars -> per-route rows of
// three horizontal tracks (best #10b981, avg #00f0ff, worst #ef4444), each filled
// to value/max and tagged with the rounded value, plus a colour legend.
function RouteComparisonChart({
  rows,
  efficiencyUnit,
  t,
}: {
  rows: ChartRow[];
  efficiencyUnit: string;
  t: TFunc;
}) {
  const series = [
    {key: 'best' as const, color: SERIES_BEST, label: t('routeEfficiency.best', 'Best')},
    {key: 'avg' as const, color: SERIES_AVG, label: t('routeEfficiency.avgLabel', 'Avg')},
    {key: 'worst' as const, color: SERIES_WORST, label: t('routeEfficiency.worst', 'Worst')},
  ];
  const max = Math.max(1, ...rows.flatMap(r => [r.best, r.avg, r.worst]));

  return (
    <View style={styles.comparison}>
      {rows.map((row, i) => (
        <View key={`${row.name}-${i}`} style={styles.comparisonGroup}>
          <AppText numberOfLines={1} style={styles.comparisonGroupLabel} tone="muted" variant="caption">
            {row.name}
          </AppText>
          {series.map(s => (
            <View key={s.key} style={styles.comparisonBarRow}>
              <View style={styles.comparisonTrack}>
                <View
                  style={[
                    styles.comparisonFill,
                    {backgroundColor: s.color, width: `${Math.max((row[s.key] / max) * 100, 2)}%`},
                  ]}
                />
              </View>
              <AppText style={styles.comparisonValue} variant="caption">
                {fmtInt(row[s.key])}
              </AppText>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.legendRow}>
        {series.map(s => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, {backgroundColor: s.color}]} />
            <AppText style={styles.legendLabel} variant="caption">
              {`${s.label} ${efficiencyUnit}`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ─── RouteCard (web RouteEfficiencyPage L44) ───────────────────────────── */

function RouteCard({
  route,
  efficiencyUnit,
  distanceUnit,
  toDistanceDisplay,
  toEfficiencyDisplay,
}: {
  route: RouteSummary;
  efficiencyUnit: string;
  distanceUnit: string;
  toDistanceDisplay: (v: number) => number;
  toEfficiencyDisplay: (v: number) => number;
}) {
  const {t} = useTranslation();
  const avgEff = toEfficiencyDisplay(route.avgEfficiency);
  const bestEff = toEfficiencyDisplay(route.bestEfficiency);
  const worstEff = toEfficiencyDisplay(route.worstEfficiency);

  // web linear-gradient stops: green 0->bestPct, cyan bestPct->avgPct, red
  // avgPct->100. Reproduced as three flex segments inside the rounded track.
  const denom = Math.max(worstEff, 1);
  const bestPct = Math.max(0, Math.min((bestEff / denom) * 100, 100));
  const avgPct = Math.max(0, Math.min((avgEff / denom) * 100, 100));
  const greenW = bestPct;
  const cyanW = Math.max(0, avgPct - bestPct);
  const redW = Math.max(0, 100 - greenW - cyanW);

  const caption = `${route.tripCount} ${t('routeEfficiency.trips', 'trips')} · ${fmtNumber(
    toDistanceDisplay(route.avgDistanceKm * 1000),
  )} ${distanceUnit} ${t('routeEfficiency.avg', 'avg')}`;

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <SemanticIcon decorative name="mapPinned" size="sm" />
          <View style={styles.cardHeaderText}>
            <View style={styles.routeLine}>
              <AppText numberOfLines={1} style={styles.routeEndpoint} weight="semibold">
                {route.startLocation}
              </AppText>
              <AppText style={styles.routeArrow}> → </AppText>
              <AppText numberOfLines={1} style={styles.routeEndpoint} weight="semibold">
                {route.endLocation}
              </AppText>
            </View>
            <AppText numberOfLines={1} style={styles.cardCaption} tone="muted" variant="caption">
              {caption}
            </AppText>
          </View>
        </View>
        <Badge variant={efficiencyVariant(route.avgEfficiency)}>
          {`${fmtInt(avgEff)} ${efficiencyUnit}`}
        </Badge>
      </View>

      {/* Efficiency bar */}
      <View style={styles.effBarRow}>
        <View style={styles.effTrack}>
          {greenW > 0 ? (
            <View style={[styles.effSeg, {backgroundColor: SERIES_BEST, width: `${greenW}%`}]} />
          ) : null}
          {cyanW > 0 ? (
            <View style={[styles.effSeg, {backgroundColor: SERIES_AVG, width: `${cyanW}%`}]} />
          ) : null}
          {redW > 0 ? (
            <View style={[styles.effSeg, {backgroundColor: SERIES_WORST, width: `${redW}%`}]} />
          ) : null}
        </View>
        <View style={styles.effNumbers}>
          <AppText style={[styles.effNumber, {color: SERIES_BEST}]} weight="bold">
            {fmtInt(bestEff)}
          </AppText>
          <AppText style={[styles.effNumber, {color: SERIES_AVG}]} weight="bold">
            {fmtInt(avgEff)}
          </AppText>
          <AppText style={[styles.effNumber, {color: SERIES_WORST}]} weight="bold">
            {fmtInt(worstEff)}
          </AppText>
        </View>
      </View>
      <View style={styles.effLabelsRow}>
        <AppText style={styles.effLabel} tone="muted">
          {t('routeEfficiency.best', 'Best')}
        </AppText>
        <AppText style={styles.effLabel} tone="muted">
          {t('routeEfficiency.avgLabel', 'Avg')}
        </AppText>
        <AppText style={styles.effLabel} tone="muted">
          {t('routeEfficiency.worst', 'Worst')}
        </AppText>
      </View>
    </GlassPanel>
  );
}

/* ─── RouteEfficiencyPage (web RouteEfficiencyPage L103) ─────────────────── */

export default function RouteEfficiencyPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('routeEfficiency.title', 'Route Efficiency'));

  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  // web useUrlString('from'/'to') + useUrlBatch() collapse to in-memory state
  // (RN has no browser URL/search params); the range still drives the query.
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const setRangeBatch = useCallback((next: {from: string; to: string}) => {
    setStartDate(next.from);
    setEndDate(next.to);
  }, []);

  const {data, isLoading, error} = useRouteEfficiency(vehicleIdStr, startDate, endDate);
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  // web has this as a per-render arrow; memoised on the distance pref so the
  // chartData useMemo below stays stable (same output) without the lint warning.
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => (unitPrefs.distance === 'mi' ? whPerKm * KM_PER_MILE : whPerKm),
    [unitPrefs.distance],
  );

  // web reads `data?.routes ?? []` inline each render; memoised on data so the
  // downstream reductions + chartData memo keep stable references.
  const routes = useMemo(() => data?.routes ?? [], [data]);
  const totalTrips = routes.reduce((sum, r) => sum + r.tripCount, 0);
  const bestEff = routes.length > 0 ? Math.min(...routes.map(r => r.bestEfficiency)) : 0;
  const worstEff = routes.length > 0 ? Math.max(...routes.map(r => r.worstEfficiency)) : 0;
  const avgEff =
    routes.length > 0 ? routes.reduce((s, r) => s + r.avgEfficiency, 0) / routes.length : 0;

  /* ---- Chart data for route comparison ---- */
  const chartData = useMemo<ChartRow[]>(() => {
    return routes
      .sort((a, b) => a.avgEfficiency - b.avgEfficiency)
      .slice(0, 10)
      .map(r => ({
        name: `${(r.startLocation ?? '').substring(0, 10)}→${(r.endLocation ?? '').substring(0, 10)}`,
        avg: Math.round(toEfficiencyDisplay(r.avgEfficiency)),
        best: Math.round(toEfficiencyDisplay(r.bestEfficiency)),
        worst: Math.round(toEfficiencyDisplay(r.worstEfficiency)),
        trips: r.tripCount,
      }));
  }, [routes, toEfficiencyDisplay]);

  const vehicleOptions = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const onPickVehicle = (id: string) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
    }
  };

  return (
    <PageContainer
      title={t('routeEfficiency.title', 'Route Efficiency')}
      subtitle={t('routeEfficiency.subtitle', 'Compare efficiency across your most-driven routes')}
      error={error as Error | null}
      actions={
        <View style={styles.actions}>
          {vehicles.length > 0 ? (
            <Select options={vehicleOptions} value={activeId} onChange={onPickVehicle} />
          ) : null}
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setRangeBatch({from: r.start, to: r.end})}
            align="end"
            triggerTestId="route-efficiency-range-picker"
          />
        </View>
      }
      loading={isLoading}>
      <View style={styles.sectionStack}>
        {/* Summary stats */}
        <FadeIn>
          <GlassPanel style={styles.summaryPanel}>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCell}>
                <AnimatedNumber style={[styles.summaryValue, {color: colors.accent}]} value={routes.length} />
                <AppText style={styles.summaryLabel} tone="muted" variant="caption">
                  {t('routeEfficiency.routes', 'Routes')}
                </AppText>
              </View>
              <View style={styles.summaryCell}>
                <AnimatedNumber style={[styles.summaryValue, styles.summaryValuePrimary]} value={totalTrips} />
                <AppText style={styles.summaryLabel} tone="muted" variant="caption">
                  {t('routeEfficiency.totalTrips', 'Total Trips')}
                </AppText>
              </View>
              <View style={styles.summaryCell}>
                <AnimatedNumber
                  style={[styles.summaryValue, {color: colors.success}]}
                  value={Math.round(toEfficiencyDisplay(bestEff))}
                />
                <AppText style={styles.summaryLabel} tone="muted" variant="caption">
                  {`${t('routeEfficiency.bestEfficiency', 'Best')} ${efficiencyUnit}`}
                </AppText>
              </View>
              <View style={styles.summaryCell}>
                <AnimatedNumber
                  style={[styles.summaryValue, {color: colors.warning}]}
                  value={Math.round(toEfficiencyDisplay(avgEff))}
                />
                <AppText style={styles.summaryLabel} tone="muted" variant="caption">
                  {`${t('routeEfficiency.avgEfficiency', 'Avg')} ${efficiencyUnit}`}
                </AppText>
              </View>
            </View>
          </GlassPanel>
        </FadeIn>

        {/*
          AI route-efficiency suggestions are hidden by withAiFeature when
          ai_mode='off' or the per-feature toggle is off. Rendered above the
          comparison chart so the narrative sits next to the figures it's
          narrating, not below the fold.
        */}
        <AIRouteEfficiencySuggestions vehicleId={vehicleIdStr} />

        {/* Route efficiency comparison chart */}
        {chartData.length > 1 ? (
          <FadeIn>
            <ChartContainer
              title={t('routeEfficiency.comparison', 'Route Efficiency Comparison')}
              ariaLabel={t(
                'routeEfficiency.comparison.aria',
                'Per-route best, average, and worst efficiency comparison bar chart',
              )}
              data={chartData.map(r => ({name: r.name, best: r.best, avg: r.avg, worst: r.worst}))}
              dataColumns={[
                {key: 'name', label: t('routeEfficiency.col.route', 'Route')},
                {key: 'best', label: `${t('routeEfficiency.best', 'Best')} ${efficiencyUnit}`},
                {key: 'avg', label: `${t('routeEfficiency.avgLabel', 'Avg')} ${efficiencyUnit}`},
                {key: 'worst', label: `${t('routeEfficiency.worst', 'Worst')} ${efficiencyUnit}`},
              ]}
              height={260}>
              <RouteComparisonChart rows={chartData} efficiencyUnit={efficiencyUnit} t={t} />
            </ChartContainer>
          </FadeIn>
        ) : null}

        {/* Route cards */}
        <View style={styles.routeCardsStack}>
          {routes.map((route, i) => (
            <FadeIn key={`${route.startLocation}-${route.endLocation}`} delay={i * 0.06}>
              <RouteCard
                route={route}
                efficiencyUnit={efficiencyUnit}
                distanceUnit={distanceUnit}
                toDistanceDisplay={toDistanceDisplay}
                toEfficiencyDisplay={toEfficiencyDisplay}
              />
            </FadeIn>
          ))}
        </View>

        {/* Metric bars */}
        <FadeIn>
          <GlassPanel style={styles.metricsPanel}>
            <View style={styles.metricsTitleRow}>
              <AppText style={styles.metricsTitleIcon} tone="accent" weight="bold">
                ↗
              </AppText>
              <AppText style={styles.metricsTitle} weight="semibold">
                {t('routeEfficiency.metrics', 'Route Metrics')}
              </AppText>
            </View>
            {routes.length > 0 ? (
              <View style={styles.metricsGrid}>
                <View style={styles.metricsCell}>
                  <MetricBar
                    label={t('routeEfficiency.bestLabel', 'Best Efficiency')}
                    value={toEfficiencyDisplay(bestEff)}
                    max={300}
                    color={SERIES_BEST}
                  />
                  <AppText style={styles.metricsCaption} tone="muted" variant="caption">
                    {`${fmtInt(toEfficiencyDisplay(bestEff))} ${efficiencyUnit}`}
                  </AppText>
                </View>
                <View style={styles.metricsCell}>
                  <MetricBar
                    label={t('routeEfficiency.avgLabel', 'Avg Efficiency')}
                    value={toEfficiencyDisplay(avgEff)}
                    max={300}
                    color={SERIES_AVG}
                  />
                  <AppText style={styles.metricsCaption} tone="muted" variant="caption">
                    {`${fmtInt(toEfficiencyDisplay(avgEff))} ${efficiencyUnit}`}
                  </AppText>
                </View>
                <View style={styles.metricsCell}>
                  <MetricBar
                    label={t('routeEfficiency.worstLabel', 'Worst Efficiency')}
                    value={toEfficiencyDisplay(worstEff)}
                    max={400}
                    color={SERIES_WORST}
                  />
                  <AppText style={styles.metricsCaption} tone="muted" variant="caption">
                    {`${fmtInt(toEfficiencyDisplay(worstEff))} ${efficiencyUnit}`}
                  </AppText>
                </View>
                <View style={styles.metricsCell}>
                  <MetricBar
                    label={t('routeEfficiency.mostDrivenLabel', 'Most Driven Route')}
                    value={routes[0]?.tripCount ?? 0}
                    max={Math.max(routes[0]?.tripCount ?? 1, 20)}
                    color={SERIES_TRIPS}
                  />
                  <AppText style={styles.metricsCaption} tone="muted" variant="caption">
                    {`${routes[0]?.tripCount ?? 0} ${t('routeEfficiency.trips', 'trips')}`}
                  </AppText>
                </View>
              </View>
            ) : (
              <EmptyState
                // no-action: transient empty state — surfaces when source data is
                // missing; no specific recovery action available.
                icon={<SemanticIcon decorative name="activity" size="lg" />}
                message={t('common.noData', 'No data available')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </View>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  cardCaption: {
    marginTop: 2,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardHeaderText: {
    flex: 1,
  },
  comparison: {
    gap: spacing.md,
  },
  comparisonBarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  comparisonFill: {
    borderRadius: 999,
    height: '100%',
  },
  comparisonGroup: {
    gap: spacing.xs,
  },
  comparisonGroupLabel: {
    fontSize: 11,
  },
  comparisonTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 10,
    overflow: 'hidden',
  },
  comparisonValue: {
    color: colors.textSecondary,
    minWidth: 36,
    textAlign: 'right',
  },
  effBarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  effLabel: {
    fontSize: 9,
  },
  effLabelsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  effNumber: {
    fontSize: 11,
  },
  effNumbers: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.md,
  },
  effSeg: {
    height: '100%',
  },
  effTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    flexDirection: 'row',
    height: 12,
    overflow: 'hidden',
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendLabel: {
    color: colors.textSecondary,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  metricBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  metricBarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  metricBarLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  metricBarValue: {
    fontVariant: ['tabular-nums'],
  },
  metricsCaption: {
    marginTop: spacing.xs,
  },
  metricsCell: {
    minWidth: 140,
    width: '47%',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricsPanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  metricsTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  metricsTitleIcon: {
    fontSize: 14,
  },
  metricsTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  optionText: {
    color: colors.textSecondary,
  },
  optionTextActive: {
    color: colors.accent,
  },
  page: {
    backgroundColor: colors.background,
  },
  pageActions: {
    flexShrink: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  pageErrorText: {
    color: colors.danger,
  },
  pageHeader: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    fontSize: 13,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  routeArrow: {
    color: colors.textMuted,
  },
  routeCardsStack: {
    gap: spacing.md,
  },
  routeEndpoint: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 13,
  },
  routeLine: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  sectionStack: {
    gap: spacing.lg,
  },
  summaryCell: {
    alignItems: 'center',
    minWidth: 120,
    width: '47%',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginTop: spacing.xs,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  summaryPanel: {
    padding: spacing.lg,
  },
  summaryValue: {
    fontSize: 24,
    lineHeight: 30,
  },
  summaryValuePrimary: {
    color: colors.textPrimary,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
