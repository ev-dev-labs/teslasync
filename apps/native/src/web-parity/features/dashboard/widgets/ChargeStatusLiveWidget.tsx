import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx.
//
// The web widget is the dashboard "Charge Status" live tile. It resolves a
// vehicle id (`vehicleId` prop, else the first vehicle from `useVehicles()`),
// polls `useVehicleState(id, {refetchInterval: 5_000})` (GET
// /api/v1/vehicles/{id}/state — preserved verbatim by the already-ported native
// useVehicles hook) plus the latest charging session via
// `useChargingSessionsPaginated(id > 0 ? id : null, {limit: 1})` (GET
// /api/v1/charging?... — preserved verbatim by the ported useCharging hook), and
// renders, inside a `WidgetShell`, one of four layouts driven by the live
// `state.is_charging` flag and the tile size:
//   - 1x1 compact + charging  -> CompactChargingView (pulsing battery glyph, an
//     animated kW number, battery %).
//   - 1x1 compact + idle       -> CompactIdleView (plug glyph, battery %,
//     "Not Charging").
//   - larger + charging        -> FullChargingView (status header with a green
//     "Charging" badge + battery %, a big animated kW power number, a 2x2 metric
//     grid of Voltage / Current / Time Left / Added, and — when >=2 rows tall —
//     an extra Rate / Battery row).
//   - larger + idle            -> IdleView (plug glyph, "Not Charging", battery
//     %, and an optional "Last Session" +kWh card).
//   - no state                 -> EmptyState ("No charge data").
//
// Every state name (`vehicles`, `id`, `stateData`, `stateLoading`, `isFetching`,
// `isStale`, `isError`, `dataUpdatedAt`, `refetch`, `sessions`,
// `sessionsLoading`, `unitPrefs`, `toDistanceDisplay`, `distanceUnit`, `state`,
// `latestSession`, `isLoading`, `isCompact`, `isTall`, `metrics`), the
// `vehicleId ?? vehicles?.[0]?.id ?? 0` resolution, the `5_000` refetch interval,
// the `id > 0 ? id : null` session gate, the `metrics` useMemo + its exact
// `[state, latestSession]` dependency array, the `state?.x ?? 0` null-safe
// derivations (power / energyAdded / timeToFull / chargeRate / batteryLevel) with
// `voltage`/`amps` hard-pinned to null, the `formatTime` helper (h/m formatting,
// "—" zero placeholder), the `size.cols <= 1 && size.rows <= 1` compact + the
// `size.rows >= 2` tall thresholds, the SI->display unit conversion at the render
// boundary, and every `widget.*` i18n key with its English fallback are
// preserved. Browser-only pieces are mapped to native-safe equivalents
// (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the APIUsageWidget /
//     BatteryDegradationTrendWidget ports), so every key + copy is preserved.
//   - lucide-react `Zap, BatteryCharging, Plug, Timer, Gauge` have no native icon
//     dependency; per the APIUsageWidget / Spinner glyph precedent each becomes a
//     decorative Unicode glyph in an `AppText`/`Animated.Text` with
//     `importantForAccessibility="no"` (Zap '\u26A1', BatteryCharging '\u{1F50B}',
//     Plug '\u{1F50C}', Timer '\u23F1', Gauge '\u25F4'). The shell/badge/labels
//     carry the accessible meaning. `h-3.5/h-4/h-5/h-6/h-3` (14/16/20/24/12px)
//     map to fontSize; `text-neon-green`/`text-emerald-300` map to the success
//     token and `text-[var(--text-*)]` to the matching text tokens. The
//     `animate-pulse` on the charging battery glyph becomes a reduced-motion-aware
//     looping opacity pulse (Spinner/StatCard precedent).
//   - `@/components/data-display` `AnimatedNumber` is reimplemented as a native
//     `WidgetAnimatedNumber` that animates 0 -> value over 1s with the same
//     ease-out-quad curve (Animated.Value + listener, reduced-motion aware) and
//     formats with the inlined `fmtNumber` + suffix, mirroring the web component.
//   - `@/components/ui` `Badge variant="success" size="sm"` -> an inlined
//     `WidgetBadge` chip (success surface/border + success text, rounded-full,
//     tight padding).
//   - `@/components/feedback` `EmptyState` -> an inlined `WidgetEmptyState`
//     (centered glyph icon + muted message), and the web `WidgetShell` (a
//     transparent flex container with Skeleton loading + QueryError + a
//     DataFreshness header) -> an inlined native `WidgetShell` on a GlassPanel
//     (Spinner loading, danger-text error, optional uppercase title row + a
//     compact freshness dot/refresh control) — identical to the APIUsageWidget
//     port.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` (`convertDistanceFromSI`,
//     `convertEnergyFromSI`) -> inlined native equivalents: a `useUnits()` shim
//     returning the out-of-box `{distance: 'km'}` preference (the API already
//     returns SI; conversion happens at display) and the pure SI->display
//     converters mirroring the web module. `@/lib/numberFormat` `fmtNumber` is
//     inlined as a native-safe formatter (locale toLocaleString, precision-2 /
//     en-US defaults).
//   - `./types` `WidgetProps` -> a local interface mirroring it
//     (WidgetSize {cols, rows}).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useChargingSessionsPaginated,
  type ApiChargingSession,
} from '../../../api/hooks/useCharging';
import {
  useVehicles,
  useVehicleState,
  type VehicleState,
} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type EnergyUnitPref = 'Wh' | 'kWh';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

// Mirrors web `convertDistanceFromSI` (SI meters -> display unit).
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'km':
    default:
      return meters / METERS_PER_KM;
  }
}

// Mirrors web `convertEnergyFromSI` (SI watt-hours -> display unit).
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'kWh':
      return wh / 1000;
    case 'Wh':
    default:
      return wh;
  }
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
}

// The native parity layer has no settings store wired in here, so the hook
// mirrors the web out-of-box default: distance 'km'. The API already returns SI;
// conversion happens at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {distance: 'km'}}), []);
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_ZAP = '\u26A1'; // lucide Zap
const ICON_BATTERY_CHARGING = '\u{1F50B}'; // lucide BatteryCharging
const ICON_PLUG = '\u{1F50C}'; // lucide Plug
const ICON_TIMER = '\u23F1'; // lucide Timer
const ICON_GAUGE = '\u25F4'; // lucide Gauge
const GLYPH_REFRESH = '\u21BB';
const EM_DASH = '\u2014';

/* ─── reduced-motion helper (Spinner/StatCard precedent) ───────────────────── */

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

function useLoopingPulse(reduceMotion: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return pulse;
}

/* ─── glyph primitives ─────────────────────────────────────────────────────── */

function GlyphLegacyUnused({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
  );
}

// lucide BatteryCharging with the web `animate-pulse` -> a reduced-motion-aware
// looping opacity pulse on the green battery glyph.
function ChargingPulseGlyph({style}: {style?: StyleProp<TextStyle>}) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.5],
        }),
      };

  return (
    <Animated.Text
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no-hide-descendants"
      style={[style, animatedStyle]}>
      {ICON_BATTERY_CHARGING}
    </Animated.Text>
  );
}

/* ─── inlined AnimatedNumber (web @/components/data-display AnimatedNumber) ──── */

interface WidgetAnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

// Animates 0 -> value over 1s with the same ease-out-quad curve as the web
// component, then formats with fmtNumber + suffix. Honours reduced motion by
// jumping straight to the final value.
function WidgetAnimatedNumber({
  value,
  decimals = 0,
  suffix,
  style,
}: WidgetAnimatedNumberProps) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const listenerId = anim.addListener(state => setDisplay(state.value));
    return () => anim.removeListener(listenerId);
  }, [anim]);

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(value);
      setDisplay(value);
      return;
    }

    anim.setValue(0);
    setDisplay(0);
    const animation = Animated.timing(anim, {
      duration: 1000,
      easing: Easing.out(Easing.quad),
      toValue: value,
      useNativeDriver: false,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [anim, value, reduceMotion]);

  return (
    <AppText allowFontScaling={false} style={style}>
      {`${fmtNumber(display, decimals)}${suffix ?? ''}`}
    </AppText>
  );
}

/* ─── inlined Badge (web @/components/ui Badge variant="success" size="sm") ──── */

function WidgetBadge({children}: {children: string}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText}>{children}</AppText>
    </View>
  );
}

/* ─── inlined EmptyState (web @/components/feedback EmptyState) ─────────────── */

function WidgetEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />;

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function ChargeStatusLiveWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id, {refetchInterval: 5_000});
  const {data: sessions, isLoading: sessionsLoading} =
    useChargingSessionsPaginated(id > 0 ? id : null, {limit: 1});

  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  // The web reads `stateData?.state` as `any`; the native hook strictly types it
  // as `VehicleState | string | null`. Narrow to the object form for field
  // access while keeping the raw value for the render gate so a string state
  // still falls through to the idle layout exactly like the web.
  const rawState = stateData?.state;
  const state: VehicleState | undefined =
    rawState != null && typeof rawState === 'object' ? rawState : undefined;
  const latestSession: ApiChargingSession | undefined = (sessions ?? [])[0];
  const isLoading = stateLoading || sessionsLoading;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;

  // Derive charging metrics from live state + latest session
  const metrics = useMemo(() => {
    const power = state?.charger_power ?? 0;
    const voltage: number | null = null;
    const amps: number | null = null;
    const energyAdded = latestSession?.total_energy_added_wh ?? 0;
    const timeToFull = state?.time_to_full_charge ?? 0;
    const chargeRate = state?.charge_rate ?? 0;
    const batteryLevel = state?.battery_level ?? 0;

    return {power, voltage, amps, energyAdded, timeToFull, chargeRate, batteryLevel};
  }, [state, latestSession]);

  const formatTime = (hours: number): string => {
    if (hours <= 0) {
      return EM_DASH;
    }
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h === 0) {
      return `${m}m`;
    }
    if (m === 0) {
      return `${h}h`;
    }
    return `${h}h ${m}m`;
  };

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <Glyph glyph={ICON_ZAP} style={styles.titleIcon} />
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.chargeStatusLive', 'Charge Status')}
      updatedAt={dataUpdatedAt}>
      {rawState ? (
        state?.is_charging ? (
          isCompact ? (
            <CompactChargingView
              batteryLevel={metrics.batteryLevel}
              power={metrics.power}
            />
          ) : (
            <FullChargingView
              distanceUnit={distanceUnit}
              formatTime={formatTime}
              isTall={isTall}
              metrics={metrics}
              t={t}
              toDistanceDisplay={toDistanceDisplay}
            />
          )
        ) : isCompact ? (
          <CompactIdleView batteryLevel={metrics.batteryLevel} t={t} />
        ) : (
          <IdleView latestSession={latestSession} metrics={metrics} t={t} />
        )
      ) : (
        <WidgetEmptyState
          icon={<Glyph glyph={ICON_ZAP} style={styles.emptyIcon} />}
          message={t('widget.noChargeData', 'No charge data')}
        />
      )}
    </WidgetShell>
  );
}

ChargeStatusLiveWidget.displayName = 'ChargeStatusLiveWidget';

/* ── Compact: charging ── */
function CompactChargingView({
  power,
  batteryLevel,
}: {
  power: number;
  batteryLevel: number;
}) {
  return (
    <View style={styles.compactCenter}>
      <ChargingPulseGlyph style={styles.compactChargingIcon} />
      <WidgetAnimatedNumber
        decimals={1}
        style={styles.compactPowerValue}
        suffix=" kW"
        value={power}
      />
      <AppText style={styles.compactPct}>{`${batteryLevel}%`}</AppText>
    </View>
  );
}

/* ── Compact: idle ── */
function CompactIdleView({
  batteryLevel,
  t,
}: {
  batteryLevel: number;
  t: NativeTFunction;
}) {
  return (
    <View style={styles.compactCenter}>
      <Glyph glyph={ICON_PLUG} style={styles.compactIdleIcon} />
      <AppText style={styles.compactIdlePct}>{`${batteryLevel}%`}</AppText>
      <AppText style={styles.compactIdleLabel}>
        {t('widget.notCharging', 'Not Charging')}
      </AppText>
    </View>
  );
}

/* ── Full: actively charging ── */
interface FullChargingViewProps {
  metrics: {
    power: number;
    voltage: number | null;
    amps: number | null;
    energyAdded: number;
    timeToFull: number;
    chargeRate: number;
    batteryLevel: number;
  };
  isTall: boolean;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  formatTime: (h: number) => string;
  t: NativeTFunction;
}

function FullChargingView({
  metrics,
  isTall,
  toDistanceDisplay,
  distanceUnit,
  formatTime,
  t,
}: FullChargingViewProps) {
  const {power, voltage, amps, energyAdded, timeToFull, chargeRate, batteryLevel} =
    metrics;

  return (
    <View style={styles.fullContainer}>
      {/* Status header */}
      <View style={styles.fullHeader}>
        <View style={styles.fullHeaderLeft}>
          <ChargingPulseGlyph style={styles.headerBatteryIcon} />
          <WidgetBadge>{t('widget.charging', 'Charging')}</WidgetBadge>
        </View>
        <AppText style={styles.batteryPctSecondary}>{`${batteryLevel}%`}</AppText>
      </View>

      {/* Primary metric: power */}
      <View style={styles.fullPowerWrap}>
        <WidgetAnimatedNumber
          decimals={1}
          style={styles.fullPowerValue}
          suffix=" kW"
          value={power}
        />
      </View>

      {/* Secondary metrics grid */}
      <View style={styles.metricGrid}>
        <MetricCell
          icon={<Glyph glyph={ICON_GAUGE} style={styles.metricIcon} />}
          label={t('widget.voltage', 'Voltage')}
          value={voltage != null ? `${fmtNumber(voltage, 0)} V` : EM_DASH}
        />
        <MetricCell
          icon={<Glyph glyph={ICON_ZAP} style={styles.metricIcon} />}
          label={t('widget.amps', 'Current')}
          value={amps != null ? `${fmtNumber(amps, 0)} A` : EM_DASH}
        />
        <MetricCell
          icon={<Glyph glyph={ICON_TIMER} style={styles.metricIcon} />}
          label={t('widget.timeRemaining', 'Time Left')}
          value={formatTime(timeToFull)}
        />
        <MetricCell
          icon={<Glyph glyph={ICON_ZAP} style={styles.metricIcon} />}
          label={t('widget.energyAdded', 'Added')}
          value={`${fmtNumber(convertEnergyFromSI(energyAdded, 'kWh'), 1)} kWh`}
        />
      </View>

      {/* Extra row when tall */}
      {isTall && (
        <View style={styles.tallRow}>
          <MetricCell
            icon={<Glyph glyph={ICON_GAUGE} style={styles.metricIcon} />}
            label={t('widget.chargeRate', 'Rate')}
            value={`${fmtNumber(toDistanceDisplay(chargeRate), 0)} ${distanceUnit}/h`}
          />
          <MetricCell
            icon={
              <Glyph glyph={ICON_BATTERY_CHARGING} style={styles.metricIcon} />
            }
            label={t('widget.batteryLevel', 'Battery')}
            value={`${batteryLevel}%`}
          />
        </View>
      )}
    </View>
  );
}

/* ── Full: not charging ── */
interface IdleViewProps {
  metrics: {
    power: number;
    energyAdded: number;
    batteryLevel: number;
  };
  latestSession: {total_energy_added_wh: number} | undefined;
  t: NativeTFunction;
}

function IdleView({metrics, latestSession, t}: IdleViewProps) {
  return (
    <View style={styles.idleContainer}>
      <Glyph glyph={ICON_PLUG} style={styles.idlePlugIcon} />
      <View style={styles.idleTextCenter}>
        <AppText style={styles.idleTitle}>
          {t('widget.notCharging', 'Not Charging')}
        </AppText>
        <AppText style={styles.idlePct}>{`${metrics.batteryLevel}%`}</AppText>
      </View>
      {latestSession && (
        <View style={styles.lastSessionCard}>
          <AppText style={styles.lastSessionLabel}>
            {t('widget.lastSession', 'Last Session')}
          </AppText>
          <AppText style={styles.lastSessionValue}>
            {`+${fmtNumber(
              convertEnergyFromSI(latestSession.total_energy_added_wh, 'kWh'),
              1,
            )} kWh`}
          </AppText>
        </View>
      )}
    </View>
  );
}

/* ── Tiny metric cell ── */
function MetricCell({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricCell}>
      <View style={styles.metricIconWrap}>{icon}</View>
      <View style={styles.metricBody}>
        <AppText numberOfLines={1} style={styles.metricLabel}>
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.metricValue}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  batteryPctSecondary: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compactCenter: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  compactChargingIcon: {
    color: colors.success,
    fontSize: 20,
    lineHeight: 24,
  },
  compactIdleIcon: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  compactIdleLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  compactIdlePct: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  compactPct: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  compactPowerValue: {
    color: colors.success,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  fullContainer: {
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
  fullHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fullHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fullPowerValue: {
    color: colors.success,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  fullPowerWrap: {
    alignItems: 'center',
  },
  headerBatteryIcon: {
    color: colors.success,
    fontSize: 16,
    lineHeight: 20,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  idleContainer: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
  idlePct: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    textAlign: 'center',
  },
  idlePlugIcon: {
    color: colors.textMuted,
    fontSize: 24,
    lineHeight: 28,
  },
  idleTextCenter: {
    alignItems: 'center',
  },
  idleTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
    textAlign: 'center',
  },
  lastSessionCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
    width: '100%',
  },
  lastSessionLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 2,
    textAlign: 'center',
  },
  lastSessionValue: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    textAlign: 'center',
  },
  metricBody: {
    flex: 1,
    minWidth: 0,
  },
  metricCell: {
    alignItems: 'flex-start',
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 6,
    minWidth: 0,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricIcon: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  metricIconWrap: {
    flexShrink: 0,
    marginTop: 2,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  tallRow: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  titleIcon: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
