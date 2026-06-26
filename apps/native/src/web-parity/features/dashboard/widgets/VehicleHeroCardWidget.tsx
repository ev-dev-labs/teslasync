// Native parity port of web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx.
//
// `VehicleHeroCardWidget` is a dashboard widget that renders a hero summary of
// the active vehicle. It has two responsive layouts driven by `size`:
//   - compact (cols <= 1 && rows <= 1): a centred StatusBadge + animated battery
//     percentage + truncated vehicle name.
//   - full (everything else): a header (name + StatusBadge), a model/trim
//     subtitle, a responsive metrics grid (Battery / Range / Cabin, plus Outside
//     when wide), a charging banner when actively charging, and — when the widget
//     is tall but not wide — an extra Outside/Ideal row.
// When there is no vehicle it shows a "No vehicle data" empty state inside the
// shell.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3):
//   - vehicle resolution `vehicleId ? vehicles?.find(v => v.id === vehicleId) ??
//     vehicles?.[0] : vehicles?.[0]` and `id = vehicle?.id ?? 0` (L17-22).
//   - `useVehicleState(id)` destructured data:stateData/isLoading/isFetching/
//     isStale/isError/dataUpdatedAt/refetch (L23) and `state = stateData?.state`
//     (L24); the SI-floor comment (L25: ideal_range in METERS, inside/outside_temp
//     in °C).
//   - `useUnits()` `unitPrefs` + `distanceUnit = unitPrefs.distance` +
//     `tempUnit = unitPrefs.temperature` (L26-28).
//   - the layout flags `isCompact = size.cols <= 1 && size.rows <= 1`,
//     `isWide = size.cols >= 3`, `isTall = size.rows >= 2` (L30-32).
//   - the memoized `batteryColor` thresholds (L34-39: no state -> muted;
//     >50 emerald-400; >20 amber-400; else red-400) with `[state]` deps; the
//     memoized `range = state ? Math.round(convertDistanceFromSI(state.ideal_range
//     ?? 0, distanceUnit)) : null` (L41-44, deps [state, distanceUnit]); the
//     memoized `insideTemp`/`outsideTemp = X != null ? Math.round(convertTempFromSI
//     (X, tempUnit)) : null` (L46-54, deps [state, tempUnit]).
//   - the `WidgetShell` prop wiring (L57-66: title/icon undefined when compact;
//     loading=isLoading; updatedAt=dataUpdatedAt; isFetching/isStale/isError;
//     onRefresh=()=>refetch()) and the `vehicle ? <FadeIn>{compact?CompactView:
//     FullView}</FadeIn> : EmptyState` body (L67-104). Every prop forwarded to
//     CompactView (name=display_name||vin, batteryLevel, batteryColor, status=
//     state?.state ?? 'offline') and FullView (name/model/trim_badging/status/
//     batteryLevel/batteryColor/range/distanceUnit/insideTemp/outsideTemp/tempUnit/
//     isCharging=state?.is_charging ?? false/chargerPower=state?.charger_power ??
//     null/isWide/isTall/t) is forwarded verbatim.
//   - CompactView (L108-135): StatusBadge size="sm"; batteryLevel!=null renders the
//     AnimatedNumber `value=batteryLevel suffix="%"` (text-xl bold + batteryColor),
//     else a muted "—"; then the truncated name.
//   - FullView (L137-237): header (text-sm bold name truncate + StatusBadge sm
//     shrink-0); subtitle `model + (trim_badging ? ' '+trim : '')` (text-[11px]
//     muted -mt-1); the metrics grid with Battery (`batteryLevel!=null ?
//     `${batteryLevel}%` : '—'`, valueColor=batteryColor), Range (`range!=null ?
//     `${fmtInt(range)} ${distanceUnit}` : '—'`), Cabin (`insideTemp!=null ?
//     `${insideTemp}${tempUnit}` : '—'`) and, when wide, Outside; the charging
//     banner (isCharging) with the ⚡ + `widget.charging` label + `chargerPower!=
//     null && chargerPower>0` -> `fmtNumber(chargerPower,1) kW`; and the
//     `isTall && !isWide` extra grid (Outside + Ideal range). Every i18n key +
//     English default (widget.vehicleHeroCard/noVehicle/battery/range/cabin/outside/
//     charging/idealRange) and the literal '%'/'kW' units are kept verbatim.
//   - MetricCell (L239-262): icon (mt-0.5 muted) + label (text-[10px] muted
//     truncate) + value (text-sm semibold truncate, valueColor ?? text-primary).
//
// Real native parity deps reused (rule 5): `@/api/hooks/useVehicles`
// useVehicles + useVehicleState (L8) -> the already-ported web-parity hooks (real
// TanStack Query; the `/vehicles` + `/vehicles/{id}/state` paths are reached
// through them; the native Vehicle carries display_name/vin/model/trim_badging and
// VehicleState carries state/battery_level/ideal_range/inside_temp/outside_temp/
// is_charging/charger_power). `@/components/motion` FadeIn (L7) -> the converted
// web-parity motion barrel (opacity+translateY entrance honouring reduced motion).
// `@/components/data-display` DataFreshness -> the converted web-parity port (used
// by the local WidgetShell freshness chip).
//
// Web/DOM-only deps with no native parity surface are mapped native-safe +
// documented (rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local inline-English
//     fallback shim (namespace accepted + ignored), the same shim shape used by
//     the sibling widget ports.
//   - lucide-react `Car`/`Battery`/`Gauge`/`Thermometer` (L3) -> there is no
//     `react-native-svg` dependency, so each renders a decorative `<GlyphIcon>`
//     emoji stand-in (Car 🚗, Battery 🔋, Gauge 📊, Thermometer 🌡 — the same
//     mappings used by the TemplateGallery / QuickNav ports). Color intent is
//     preserved on the prop: the header/Range/Ideal Car+Gauge keep the web
//     `text-neon-cyan` via `colors.accent`; Cabin thermometer keeps `text-orange-
//     400` (#fb923c); Outside thermometer keeps `text-blue-400` (#60a5fa); the
//     Battery + empty-state Car inherit the muted token (web `text-[var(--text-
//     muted)]`). Emoji glyphs ignore the tint, but the intent is documented.
//   - `@/components/data-display/StatusBadge` (L4) -> reproduced locally as
//     `<StatusBadge>` because the sibling is not ported. Its `getStateDefinition
//     ('vehicle', status).badgeDot` lookup (web @/types/fsm) is inlined as a
//     vehicle-state -> badge-dot hex map (online #4ade80, driving #3b82f6,
//     charging #facc15, parked #06b6d4, updating #6366f1, asleep #a855f7, offline
//     #f87171, unknown #9ca3af — the exact Tailwind hex for the web `bg-*` classes
//     after theme+override resolution); the dark `border-gray-700`/`bg-gray-800`/
//     `text-[var(--text-secondary)]` chrome + `capitalize` are reproduced. Only
//     size="sm" is used by this widget; "md" is kept for contract parity.
//   - `@/components/data-display` AnimatedNumber (L5) -> reproduced locally
//     (raf 0->value ease-out-quad ramp over `duration`s, inlined safeNumber +
//     fmtNumber honouring decimals, prefix/suffix; web `tabular-nums` -> RN
//     `fontVariant: ['tabular-nums']`), the same reproduction the FleetStats port
//     uses; `className` -> `style`.
//   - `@/components/feedback` EmptyState (L6) -> reproduced locally as
//     `<LocalEmptyState>` (centred icon + muted message); the web `py-4` padding is
//     kept; the "no-action transient empty state" intent is preserved.
//   - `@/hooks/useUnits` useUnits (L9) -> a local shim exposing
//     `unitPrefs.{distance,temperature}`. There is no native settings/locale port
//     yet, so it resolves to the web defaults ('km' / '°C' — the
//     deriveDistance/deriveTemperature fallbacks), keeping everything SI on disk
//     and converting only at this display boundary.
//   - `@/lib/unitConversion` convertDistanceFromSI/convertTempFromSI (L10) ->
//     inlined verbatim (km -> m/1000, mi -> m/1609.344, ft -> m/0.3048; °C
//     identity, °F = c*9/5+32) with the local DistanceUnitPref/TemperatureUnitPref
//     types.
//   - `@/lib/numberFormat` fmtNumber/fmtInt (L11) -> inlined native-safe
//     equivalents (+ safeNumber dep): nullish/non-finite -> 0, en-US locale, the
//     per-call precision honoured (fmtInt = 0 dp; default 2 dp).
//   - `./WidgetShell` WidgetShell (L12) -> reproduced locally (sibling not ported,
//     same self-contained approach as the MotorPerformance port): loading ->
//     skeleton block, error -> centred danger text (surfaced, never hidden), title
//     + icon header, the freshness chip via the converted DataFreshness port
//     (compact/dot-only + absolute overlay when title-less), and the body. The web
//     pulse-on-data-change box-shadow glow has no native analog and is omitted; the
//     help-tooltip / pin-button / actions / noPadding / query header slots are
//     unused by this widget and not modeled.
//   - `./types` WidgetProps (L13) -> WidgetProps/WidgetSize/WidgetConfig reproduced
//     + exported.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> theme tokens so the
// light/dark cascade is preserved at the token boundary. The web `@xs:grid-cols-3/
// 4` container-query breakpoints have no React Native analog, so the metrics grid
// uses a flex-wrap row with each cell at flexBasis ~47% (the web base
// `grid-cols-2` narrow-width layout). The charging banner's animate-pulse and the
// header glyph tint are intent-only on native (documented above).

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { FadeIn } from '../../../components/motion';
import {
  useVehicles,
  useVehicleState,
  type VehicleState,
} from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt) ────────────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, en-US locale, the per-call precision arg is honoured.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ── Inlined `@/lib/unitConversion` converters ────────────────────────────────
type DistanceUnitPref = 'km' | 'mi' | 'ft';
type TemperatureUnitPref = '°C' | '°F';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

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

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// ── useUnits shim (web @/hooks/useUnits) ─────────────────────────────────────
// No native settings/locale port yet; the SI floor resolves to the web
// deriveDistance/deriveTemperature defaults ('km' / '°C'). The display-boundary
// conversion contract (read SI, convert at render) is preserved.
interface UnitPrefsShim {
  distance: DistanceUnitPref;
  temperature: TemperatureUnitPref;
}

function useUnits(): { unitPrefs: UnitPrefsShim } {
  return { unitPrefs: { distance: 'km', temperature: '°C' } };
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// ── lucide glyph stand-ins ───────────────────────────────────────────────────
const NEON_CYAN = colors.accent; // text-neon-cyan
const ORANGE_400 = '#fb923c'; // text-orange-400 (cabin thermometer)
const BLUE_400 = '#60a5fa'; // text-blue-400 (outside thermometer)

// Battery-level thresholds (web batteryColor, L34-39): Tailwind hex.
const EMERALD_400 = '#34d399'; // text-emerald-400 (> 50%)
const AMBER_400 = '#fbbf24'; // text-amber-400 (> 20%)
const RED_400 = '#f87171'; // text-red-400 (<= 20%)

// Charging banner (neon-green = #10b981) + emerald-300 accents.
const NEON_GREEN_05 = 'rgba(16, 185, 129, 0.05)'; // bg-neon-green/5
const NEON_GREEN_10 = 'rgba(16, 185, 129, 0.1)'; // border-neon-green/10
const NEON_GREEN_70 = 'rgba(16, 185, 129, 0.7)'; // text-neon-green/70
const EMERALD_300 = '#6ee7b7'; // text-emerald-300

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size + 2,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── Local `StatusBadge` (web @/components/data-display/StatusBadge) ───────────
// `getStateDefinition('vehicle', status).badgeDot` resolved to the exact Tailwind
// hex for each vehicle FSM state (theme + overrides); unknown states fall back to
// the neutral gray dot.
const VEHICLE_BADGE_DOT: Record<string, string> = {
  online: '#4ade80', // success theme: bg-green-400
  driving: '#3b82f6', // override: bg-blue-500
  charging: '#facc15', // override: bg-yellow-400
  parked: '#06b6d4', // override: bg-cyan-500
  updating: '#6366f1', // override: bg-indigo-500
  asleep: '#a855f7', // override: bg-purple-500
  offline: '#f87171', // danger theme: bg-red-400
};
const DEFAULT_BADGE_DOT = '#9ca3af'; // neutral: bg-gray-400

function vehicleBadgeDot(status: string): string {
  return VEHICLE_BADGE_DOT[status.toLowerCase()] ?? DEFAULT_BADGE_DOT;
}

function StatusBadge({
  status,
  size = 'md',
}: {
  status: string;
  size?: 'sm' | 'md';
}) {
  const dotColor = vehicleBadgeDot(status);
  const isSm = size === 'sm';
  return (
    <View
      style={[
        styles.badge,
        isSm ? styles.badgeSm : styles.badgeMd,
      ]}
    >
      <View
        style={[
          isSm ? styles.badgeDotSm : styles.badgeDotMd,
          { backgroundColor: dotColor },
        ]}
      />
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, isSm ? styles.badgeTextSm : styles.badgeTextMd]}
      >
        {status}
      </AppText>
    </View>
  );
}

// ── Local `AnimatedNumber` (web @/components/data-display/AnimatedNumber) ─────
interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
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
  }, [value, duration]);

  return (
    <AppText style={[styles.animatedNumber, style]}>
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export default function VehicleHeroCardWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } =
    useVehicleState(id);
  // The native `useVehicleState` result's `state` is `VehicleState | string |
  // null`; narrow once to `VehicleState | null` (the web call site is `any`) so a
  // bare offline status string reads object fields as the same `?? null`/`offline`
  // fallbacks the web produces.
  const rawState = stateData?.state;
  const state: VehicleState | null =
    rawState != null && typeof rawState === 'object' ? rawState : null;
  /* SI-floor: state.ideal_range in METERS, state.{inside,outside}_temp in °C. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const batteryColor = useMemo(() => {
    if (!state) return colors.textMuted;
    if (state.battery_level > 50) return EMERALD_400;
    if (state.battery_level > 20) return AMBER_400;
    return RED_400;
  }, [state]);

  const range = useMemo(
    () =>
      state
        ? Math.round(convertDistanceFromSI(state.ideal_range ?? 0, distanceUnit))
        : null,
    [state, distanceUnit],
  );

  const insideTemp = useMemo(
    () =>
      state?.inside_temp != null
        ? Math.round(convertTempFromSI(state.inside_temp, tempUnit))
        : null,
    [state, tempUnit],
  );

  const outsideTemp = useMemo(
    () =>
      state?.outside_temp != null
        ? Math.round(convertTempFromSI(state.outside_temp, tempUnit))
        : null,
    [state, tempUnit],
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleHeroCard', 'Vehicle')}
      icon={
        isCompact ? undefined : (
          <GlyphIcon glyph="🚗" color={NEON_CYAN} size={14} />
        )
      }
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {vehicle ? (
        <FadeIn>
          {isCompact ? (
            <CompactView
              name={vehicle.display_name || vehicle.vin}
              batteryLevel={state?.battery_level ?? null}
              batteryColor={batteryColor}
              status={state?.state ?? 'offline'}
            />
          ) : (
            <FullView
              name={vehicle.display_name || vehicle.vin}
              model={vehicle.model}
              trimBadging={vehicle.trim_badging}
              status={state?.state ?? 'offline'}
              batteryLevel={state?.battery_level ?? null}
              batteryColor={batteryColor}
              range={range}
              distanceUnit={distanceUnit}
              insideTemp={insideTemp}
              outsideTemp={outsideTemp}
              tempUnit={tempUnit}
              isCharging={state?.is_charging ?? false}
              chargerPower={state?.charger_power ?? null}
              isWide={isWide}
              isTall={isTall}
              t={t}
            />
          )}
        </FadeIn>
      ) : (
        <LocalEmptyState
          /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<GlyphIcon glyph="🚗" color={colors.textMuted} size={20} />}
          message={t('widget.noVehicle', 'No vehicle data')}
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: 1×1 ── */
function CompactView({
  name,
  batteryLevel,
  batteryColor,
  status,
}: {
  name: string;
  batteryLevel: number | null;
  batteryColor: string;
  status: string;
}) {
  return (
    <View style={styles.compactRoot}>
      <StatusBadge status={status} size="sm" />
      {batteryLevel != null ? (
        <AnimatedNumber
          value={batteryLevel}
          suffix="%"
          style={[styles.compactBattery, { color: batteryColor }]}
        />
      ) : (
        <AppText style={styles.compactBatteryDash}>—</AppText>
      )}
      <AppText numberOfLines={1} style={styles.compactName}>
        {name}
      </AppText>
    </View>
  );
}

/* ── Full: 2×1+ ── */
interface FullViewProps {
  name: string;
  model: string;
  trimBadging: string;
  status: string;
  batteryLevel: number | null;
  batteryColor: string;
  range: number | null;
  distanceUnit: string;
  insideTemp: number | null;
  outsideTemp: number | null;
  tempUnit: string;
  isCharging: boolean;
  chargerPower: number | null;
  isWide: boolean;
  isTall: boolean;
  t: (k: string, f: string) => string;
}

function FullView({
  name,
  model,
  trimBadging,
  status,
  batteryLevel,
  batteryColor,
  range,
  distanceUnit,
  insideTemp,
  outsideTemp,
  tempUnit,
  isCharging,
  chargerPower,
  isWide,
  isTall,
  t,
}: FullViewProps) {
  return (
    <View style={styles.fullRoot}>
      {/* Header: name + status badge */}
      <View style={styles.fullHeader}>
        <AppText numberOfLines={1} style={styles.fullName}>
          {name}
        </AppText>
        <StatusBadge status={status} size="sm" />
      </View>

      {/* Subtitle: model + trim */}
      <AppText numberOfLines={1} style={styles.fullSubtitle}>
        {model}
        {trimBadging ? ` ${trimBadging}` : ''}
      </AppText>

      {/* Metrics row — collapses to 2 cols on very narrow widget widths */}
      <View style={styles.metricsGrid}>
        <View style={styles.gridItem}>
          <MetricCell
            icon={<GlyphIcon glyph="🔋" color={colors.textMuted} size={12} />}
            label={t('widget.battery', 'Battery')}
            value={batteryLevel != null ? `${batteryLevel}%` : '—'}
            valueColor={batteryColor}
          />
        </View>
        <View style={styles.gridItem}>
          <MetricCell
            icon={<GlyphIcon glyph="📊" color={NEON_CYAN} size={12} />}
            label={t('widget.range', 'Range')}
            value={range != null ? `${fmtInt(range)} ${distanceUnit}` : '—'}
          />
        </View>
        <View style={styles.gridItem}>
          <MetricCell
            icon={<GlyphIcon glyph="🌡" color={ORANGE_400} size={12} />}
            label={t('widget.cabin', 'Cabin')}
            value={insideTemp != null ? `${insideTemp}${tempUnit}` : '—'}
          />
        </View>
        {isWide && (
          <View style={styles.gridItem}>
            <MetricCell
              icon={<GlyphIcon glyph="🌡" color={BLUE_400} size={12} />}
              label={t('widget.outside', 'Outside')}
              value={outsideTemp != null ? `${outsideTemp}${tempUnit}` : '—'}
            />
          </View>
        )}
      </View>

      {/* Charging banner — shown when actively charging */}
      {isCharging && (
        <View style={styles.chargingBanner}>
          <AppText style={styles.chargingBolt}>⚡</AppText>
          <AppText style={styles.chargingLabel}>
            {t('widget.charging', 'Charging')}
          </AppText>
          {chargerPower != null && chargerPower > 0 && (
            <AppText style={styles.chargingPower}>
              {fmtNumber(chargerPower, 1)} kW
            </AppText>
          )}
        </View>
      )}

      {/* Extra row when tall — outside temp + additional context */}
      {isTall && !isWide && (
        <View style={styles.tallGrid}>
          <View style={styles.gridItem}>
            <MetricCell
              icon={<GlyphIcon glyph="🌡" color={BLUE_400} size={12} />}
              label={t('widget.outside', 'Outside')}
              value={outsideTemp != null ? `${outsideTemp}${tempUnit}` : '—'}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCell
              icon={<GlyphIcon glyph="📊" color={NEON_CYAN} size={12} />}
              label={t('widget.idealRange', 'Ideal')}
              value={range != null ? `${fmtInt(range)} ${distanceUnit}` : '—'}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/* ── Metric cell ── */
function MetricCell({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.metricCell}>
      <View style={styles.metricIcon}>{icon}</View>
      <View style={styles.metricText}>
        <AppText numberOfLines={1} style={styles.metricLabel}>
          {label}
        </AppText>
        <AppText
          numberOfLines={1}
          style={[
            styles.metricValue,
            { color: valueColor ?? colors.textPrimary },
          ]}
        >
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  animatedNumber: {
    fontVariant: ['tabular-nums'],
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#1f2937', // dark:bg-gray-800
    borderColor: '#374151', // dark:border-gray-700
    borderRadius: 999, // rounded-full
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 0, // shrink-0
  },
  badgeDotMd: {
    borderRadius: 4,
    height: 8, // h-2
    width: 8, // w-2
  },
  badgeDotSm: {
    borderRadius: 3,
    height: 6, // h-1.5
    width: 6, // w-1.5
  },
  badgeMd: {
    columnGap: 6, // gap-1.5
    paddingHorizontal: 8, // px-2
    paddingVertical: 4, // py-1
  },
  badgeSm: {
    columnGap: 4, // gap-1
    paddingHorizontal: 6, // px-1.5
    paddingVertical: 2, // py-0.5
  },
  badgeText: {
    color: colors.textSecondary, // dark:text-[var(--text-secondary)]
    fontWeight: '500', // font-medium
    textTransform: 'capitalize',
  },
  badgeTextMd: {
    fontSize: 14, // text-sm
    lineHeight: 18,
  },
  badgeTextSm: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  chargingBanner: {
    alignItems: 'center',
    backgroundColor: NEON_GREEN_05, // bg-neon-green/5
    borderColor: NEON_GREEN_10, // border-neon-green/10
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    columnGap: 8, // gap-2
    flexDirection: 'row',
    paddingHorizontal: 8, // px-2
    paddingVertical: 6, // py-1.5
  },
  chargingBolt: {
    color: EMERALD_300, // text-emerald-300 (animate-pulse omitted on native)
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  chargingLabel: {
    color: EMERALD_300, // text-emerald-300
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  chargingPower: {
    color: NEON_GREEN_70, // text-neon-green/70
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginLeft: 'auto', // ml-auto
  },
  compactBattery: {
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    lineHeight: 28,
  },
  compactBatteryDash: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    lineHeight: 28,
  },
  compactName: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    lineHeight: 14,
    maxWidth: '100%', // max-w-full
    paddingHorizontal: 4, // px-1
  },
  compactRoot: {
    alignItems: 'center',
    flex: 1, // h-full
    justifyContent: 'center',
    rowGap: 6, // gap-1.5
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16, // py-4
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  fullHeader: {
    alignItems: 'center',
    columnGap: 8, // gap-2
    flexDirection: 'row',
  },
  fullName: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flexShrink: 1, // min-w-0 + truncate
    fontSize: 14, // text-sm
    fontWeight: '700', // font-bold
    lineHeight: 20,
  },
  fullRoot: {
    flex: 1, // h-full
    justifyContent: 'center',
    rowGap: 8, // gap-2
  },
  fullSubtitle: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 11, // text-[11px]
    lineHeight: 15,
    marginTop: -4, // -mt-1
  },
  gridItem: {
    flexBasis: '47%', // grid-cols-2 (web base; @xs col bumps have no RN analog)
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
  },
  metricCell: {
    alignItems: 'flex-start', // items-start
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
  },
  metricIcon: {
    flexShrink: 0, // shrink-0
    marginTop: 2, // mt-0.5
  },
  metricLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  metricText: {
    flex: 1, // min-w-0
  },
  metricValue: {
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  metricsGrid: {
    columnGap: 8, // gap-2
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8, // gap-2
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  tallGrid: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
    borderTopWidth: 1,
    columnGap: 8, // gap-2
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 4, // pt-1
    rowGap: 8, // gap-2
  },
});
