// Native parity port of
// web/src/features/dashboard/widgets/VehicleHeroWidget.tsx.
//
// The web widget is a thin dashboard orchestration tile. It resolves the active
// vehicle (vehicleId prop -> matching vehicle else first vehicle; else first
// vehicle), reads its id (?? 0), fetches the vehicle state (useVehicleState) and
// live SSE signals (useVehicleLive), derives display-unit converters from
// useUnits + useSettings (the API delivers SI: meters / m/s / °C), computes a
// firmwareVersion (live.version || live.swUpdateVersion ||
// state.software_version || '—'), and renders a <WidgetShell noPadding> wrapping
// a <VehicleHero> with the resolved vehicle/state/converters/units. WidgetShell
// shows a skeleton until the vehicle resolves (loading={!vehicle}) and surfaces
// query freshness (updatedAt / isFetching / isStale / isError + manual refresh).
//
// This native port preserves that contract 1:1 — the same useVehicles /
// useVehicleState(id) / useVehicleLive resolution, the same unit derivations and
// SI converters (convertDistanceFromSI / convertSpeedFromSI / convertTempFromSI),
// the same firmwareVersion fallback chain, the same WidgetShell loading/freshness
// behaviour, and the same VehicleHero visual contract (status header + gauges +
// charging panel + context-aware stat grid + action buttons + asleep panel) —
// using React Native primitives, the existing native AppText / GlassPanel /
// RadialGauge / design tokens, and the already-ported useVehicles /
// useVehicleState / useSettings / useVehicleLiveSignals hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - @/hooks/useUnits (web L3) + @/lib/unitConversion convertDistanceFromSI /
//     convertSpeedFromSI / convertTempFromSI (web L4-8): the consumed subset
//     (unitPrefs.distance/speed/temperature + locale, derived from useSettings
//     exactly as the web hook does) and the pure SI converters are inlined; no
//     unit math beyond the web's own METERS_PER_KM / METERS_PER_MILE /
//     SECONDS_PER_HOUR / Celsius->Fahrenheit factors is introduced.
//   - @/hooks/useSettings (web L2): native has no app-level useSettings; the
//     consumed isFahrenheit (unit_of_temp === 'F') is derived from the ported
//     api/hooks/useSettings query.
//   - @/hooks/useVehicleLive (web L9): the web hook opens an SSE subscription and
//     merges live signals. Native has no SSE/EventSource runtime; this reproduces
//     a native-safe useVehicleLive that hydrates the consumed subset
//     (version + swUpdateVersion, parsed from Version / SoftwareUpdateVersion) via
//     the already-ported useVehicleLiveSignals query. The continuous SSE merge is
//     a documented native no-op (initial hydration preserved).
//   - ../components/VehicleHero (web L10): not yet ported, reproduced inline as a
//     native <VehicleHero> (status badge + freshness, model/vin line, context
//     gauges, charging detail panel, context-aware stat grid via buildStatCards,
//     action buttons, asleep GlassPanel) preserving every branch + i18n key.
//   - ./WidgetShell (web L11): reproduced as a native <WidgetShell> (skeleton,
//     error body, pulse-on-update, inline DataFreshness, noPadding support).
//   - ./types WidgetProps (web L12): the consumed subset mirrored locally.
//   - lucide-react / react-router-dom / @/components/ui Button / StatusBadge /
//     FreshnessIndicator / Skeleton (VehicleHero deps): icons -> emoji glyph
//     stand-ins; react-router Link -> an onNavigate bridge (default no-op);
//     Button/StatusBadge/FreshnessIndicator/Skeleton -> native reproductions.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../components/charts/RadialGauge';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';
import {useVehicleLiveSignals} from '../../../api/hooks/useTelemetry';
import type {Vehicle, VehicleState} from '../../../api/types';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (VehicleHero web L4-6)                */
/* ------------------------------------------------------------------ */

const ICON_THERMOMETER = '\uD83C\uDF21\uFE0F'; // 🌡️ (Thermometer)
const ICON_LOCK = '\uD83D\uDD12'; // 🔒 (Lock)
const ICON_UNLOCK = '\uD83D\uDD13'; // 🔓 (Unlock)
const ICON_SHIELD = '\uD83D\uDEE1\uFE0F'; // 🛡️ (Shield)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_ACTIVITY = '\uD83D\uDCC8'; // 📈 (Activity)
const ICON_NAVIGATION = '\uD83E\uDDED'; // 🧭 (Navigation)
const ICON_GAUGE = '\uD83C\uDF9B\uFE0F'; // 🎛️ (Gauge)
const ICON_CLOCK = '\uD83D\uDD50'; // 🕐 (Clock)
const ICON_EYE = '\uD83D\uDC41\uFE0F'; // 👁️ (Eye)
const ICON_MAP_PIN = '\uD83D\uDCCD'; // 📍 (MapPin)
const ICON_BATTERY_CHARGING = '\uD83D\uDD0B'; // 🔋 (BatteryCharging)
const ICON_MONITOR = '\uD83D\uDDA5\uFE0F'; // 🖥️ (Monitor)

const PULSE_GLOW = '#22c55e';
const EM_DASH = '\u2014'; // '—'

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime)             */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size?: WidgetSize;
  config?: Record<string, unknown>;
  /**
   * Native bridge for the web react-router <Link>s VehicleHero renders
   * (/vehicles/:id, /commands, /live, /digital-twin). React Native has no DOM
   * history; without a handler a press is an explicit no-op.
   */
  onNavigate?: (to: string) => void;
}

/* ------------------------------------------------------------------ */
/*  native-safe number formatters (web @/lib/numberFormat)             */
/* ------------------------------------------------------------------ */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Port of web fmtNumber — locale-aware (en-US fallback), min=max fractions. */
function fmtNumber(value: unknown, decimals = 2, locale?: string): string {
  const n = safeNumber(value);
  const lc = locale && locale.trim() ? locale : 'en-US';
  try {
    return n.toLocaleString(lc, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

/** Port of web fmtInt — fmtNumber at 0 decimals. */
function fmtInt(value: unknown, locale?: string): string {
  return fmtNumber(value, 0, locale);
}

/* ------------------------------------------------------------------ */
/*  SI converters (web @/lib/unitConversion) + useUnits derivation     */
/*  (web @/hooks/useUnits + @/hooks/useSettings, consumed subset)       */
/* ------------------------------------------------------------------ */

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';

// web @/lib/unitConversion factors (NIST exact).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_LOCALE = 'en-US';

/** web @/lib/unitConversion convertDistanceFromSI — SI metres -> km | mi. */
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
  }
}

/** web @/lib/unitConversion convertSpeedFromSI — SI m/s -> km/h | mph. */
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

/** web @/lib/unitConversion convertTempFromSI — SI °C -> °C | °F. */
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

interface NativeUnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  locale: string;
}

/** web @/hooks/useUnits deriveDistance — 'mi' stays 'mi', else 'km'. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

/** web @/hooks/useUnits deriveSpeed — 'mi' -> 'mph', else 'km/h'. */
function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

/** web @/hooks/useUnits deriveTemperature — 'F' -> '°F', else '°C'. */
function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

/** web @/hooks/useUnits deriveLocale — non-empty string else en-US. */
function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

function useUnits(): {unitPrefs: NativeUnitPrefs} {
  const {data: settings} = useSettings();

  const distance = deriveDistance(settings?.unit_of_length);
  const speed = deriveSpeed(settings?.unit_of_length);
  const temperature = deriveTemperature(settings?.unit_of_temp);
  const locale = deriveLocale(settings?.locale);

  const unitPrefs = useMemo<NativeUnitPrefs>(
    () => ({distance, speed, temperature, locale}),
    [distance, speed, temperature, locale],
  );

  return useMemo(() => ({unitPrefs}), [unitPrefs]);
}

/** web @/hooks/useSettings isFahrenheit (unit_of_temp === 'F'). */
function useIsFahrenheit(): boolean {
  const {data: settings} = useSettings();
  return settings?.unit_of_temp === 'F';
}

/* ------------------------------------------------------------------ */
/*  native-safe formatTime (web @/hooks/useDateFormat formatTime)      */
/* ------------------------------------------------------------------ */

function formatTime(date: Date, locale?: string): string {
  try {
    return date.toLocaleTimeString(locale || [], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
}

/* ------------------------------------------------------------------ */
/*  native-safe useVehicleLive (web @/hooks/useVehicleLive — SSE)       */
/*  The web hook hydrates from useVehicleLiveSignals then merges live    */
/*  SSE updates. Native has no EventSource: the SSE merge is a no-op and  */
/*  the consumed subset (version, swUpdateVersion) is hydrated from the   */
/*  already-ported live-signals query (/signals/{id}/live).               */
/* ------------------------------------------------------------------ */

interface NativeVehicleLiveState {
  version: string;
  swUpdateVersion: string;
}

const EMPTY_LIVE_STATE: NativeVehicleLiveState = {
  version: '',
  swUpdateVersion: '',
};

/** Flatten a signal that may be a bare value or a `{ value }` envelope. */
function flattenSignalString(
  signals: Record<string, unknown>,
  key: string,
): string {
  const raw = signals[key];
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const inner = (raw as {value: unknown}).value;
    return typeof inner === 'string' ? inner : '';
  }
  return typeof raw === 'string' ? raw : '';
}

function useVehicleLive(vehicleId?: number): {state: NativeVehicleLiveState} {
  const {data} = useVehicleLiveSignals(vehicleId);

  const state = useMemo<NativeVehicleLiveState>(() => {
    const signals = (data?.signals ?? {}) as Record<string, unknown>;
    if (Object.keys(signals).length === 0) {
      return EMPTY_LIVE_STATE;
    }
    return {
      version: flattenSignalString(signals, 'Version'),
      swUpdateVersion: flattenSignalString(signals, 'SoftwareUpdateVersion'),
    };
  }, [data]);

  return {state};
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  error: colors.danger,
  fetching: colors.accent,
  fresh: colors.success,
  stale: colors.warning,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  error: '\u2715', // ✕ WifiOff
  fetching: '\u21BB', // ↻ RefreshCw
  fresh: '\u25CF', // ● Wifi
  stale: '\u25CF', // ● Wifi
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.dataFreshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.dataFreshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.dataFreshnessText, {color}]}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  loading,
  error,
  children,
  noPadding,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <AppText style={styles.headerTitle}>{title}</AppText>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={!noPadding ? styles.body : null}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native StatusBadge (web @/components/data-display/StatusBadge)      */
/* ------------------------------------------------------------------ */

// Dot colour per vehicle FSM state (web getStateDefinition('vehicle', status)
// .badgeDot — mirrored from web-parity/lib/fsm.ts vehicleStates).
const VEHICLE_STATE_DOT: Record<string, string> = {
  unknown: '#6b7280',
  online: '#22c55e',
  asleep: '#a855f7',
  driving: '#3b82f6',
  charging: '#f59e0b',
  offline: '#ef4444',
};

function StatusBadge({status}: {status: string}) {
  const dotColor = VEHICLE_STATE_DOT[status] ?? VEHICLE_STATE_DOT.unknown;
  return (
    <View style={styles.statusBadge}>
      <View style={[styles.statusDot, {backgroundColor: dotColor}]} />
      <AppText style={styles.statusLabel} variant="caption">
        {status}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native FreshnessIndicator (web @/components/data-display)           */
/* ------------------------------------------------------------------ */

type DatumFreshness = 'fresh' | 'stale' | 'offline' | 'unknown';

const DATUM_DOT_COLOR: Record<DatumFreshness, string> = {
  fresh: '#22c55e',
  stale: '#f59e0b',
  offline: '#ef4444',
  unknown: colors.border,
};

function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

function datumStatus(
  age: number | null,
  staleThreshold: number,
  offlineThreshold: number,
): DatumFreshness {
  if (age === null) {
    return 'unknown';
  }
  if (age < staleThreshold) {
    return 'fresh';
  }
  if (age < offlineThreshold) {
    return 'stale';
  }
  return 'offline';
}

function formatAge(age: number | null): string {
  if (age === null) {
    return EM_DASH;
  }
  if (age < 10) {
    return 'just now';
  }
  if (age < 60) {
    return `${age}s ago`;
  }
  if (age < 3600) {
    return `${Math.floor(age / 60)}m ago`;
  }
  return `${Math.floor(age / 3600)}h ago`;
}

function FreshnessIndicator({
  timestamp,
  staleThreshold = 120,
  offlineThreshold = 600,
}: {
  timestamp: string | null | undefined;
  staleThreshold?: number;
  offlineThreshold?: number;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(prev => prev + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const age = computeAge(timestamp);
  const status = datumStatus(age, staleThreshold, offlineThreshold);
  const label = formatAge(age);

  return (
    <View style={styles.datumFreshness}>
      <View style={[styles.datumDot, {backgroundColor: DATUM_DOT_COLOR[status]}]} />
      <AppText style={styles.datumLabel} variant="caption">
        {label}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native HeroActionButton (web @/components/ui/Button + Link bridge)  */
/* ------------------------------------------------------------------ */

interface HeroActionButtonProps {
  label: string;
  glyph: string;
  to: string;
  onNavigate?: (to: string) => void;
  variant?: 'secondary' | 'primary';
}

function HeroActionButton({
  label,
  glyph,
  to,
  onNavigate,
  variant = 'secondary',
}: HeroActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onNavigate?.(to)}
      style={({pressed}) => [
        styles.heroButton,
        variant === 'primary' ? styles.heroButtonPrimary : null,
        pressed ? styles.heroButtonPressed : null,
      ]}>
      <AppText style={styles.heroButtonGlyph}>{glyph}</AppText>
      <AppText
        style={
          variant === 'primary'
            ? styles.heroButtonTextPrimary
            : styles.heroButtonText
        }
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  context-aware stat cards (VehicleHero web L186-232)                 */
/* ------------------------------------------------------------------ */

interface StatItem {
  glyph: string;
  label: string;
  value: string;
  color: string;
}

interface ConverterBag {
  toDistanceDisplay: (meters: number) => number;
  toSpeedDisplay: (mps: number) => number;
  toTemperatureDisplay: (celsius: number) => number;
  distanceUnit: string;
  speedUnit: string;
  tempUnit: string;
  locale: string;
}

function buildStatCards(
  s: VehicleState,
  firmware: string,
  u: ConverterBag,
  t: NativeTFunction,
): StatItem[] {
  const isDriving = s.state === 'driving' || s.speed > 0;
  const isCharging = s.is_charging;
  const cards: StatItem[] = [];

  if (isDriving) {
    cards.push(
      {
        glyph: ICON_GAUGE,
        label: 'Speed',
        value: `${fmtNumber(u.toSpeedDisplay(s.speed), 0, u.locale)} ${u.speedUnit}`,
        color: '#a855f7',
      },
      {
        glyph: ICON_ZAP,
        label: 'Power',
        value: `${fmtNumber(s.power, 2, u.locale)} kW`,
        color: s.power > 0 ? '#f59e0b' : s.power < 0 ? '#10b981' : '#374151',
      },
      {
        glyph: ICON_NAVIGATION,
        label: 'Odometer',
        value: `${fmtInt(u.toDistanceDisplay(s.odometer), u.locale)} ${u.distanceUnit}`,
        color: '#a855f7',
      },
      {
        glyph: ICON_ACTIVITY,
        label: 'Ideal Range',
        value: `${fmtNumber(u.toDistanceDisplay(s.ideal_range), 0, u.locale)} ${u.distanceUnit}`,
        color: '#00f0ff',
      },
    );
  } else if (isCharging) {
    cards.push(
      {
        glyph: ICON_ZAP,
        label: 'Charge Rate',
        value: `${fmtInt(u.toDistanceDisplay(s.charge_rate ?? 0), u.locale)} ${u.distanceUnit}/h`,
        color: '#10b981',
      },
      {
        glyph: ICON_CLOCK,
        label: 'Time to Full',
        value:
          s.time_to_full_charge > 0
            ? `${fmtNumber(s.time_to_full_charge, 1, u.locale)}h`
            : EM_DASH,
        color: '#f59e0b',
      },
      {
        glyph: ICON_ACTIVITY,
        label: 'Ideal Range',
        value: `${fmtNumber(u.toDistanceDisplay(s.ideal_range), 0, u.locale)} ${u.distanceUnit}`,
        color: '#00f0ff',
      },
      {
        glyph: ICON_NAVIGATION,
        label: 'Odometer',
        value: `${fmtInt(u.toDistanceDisplay(s.odometer), u.locale)} ${u.distanceUnit}`,
        color: '#a855f7',
      },
    );
  } else {
    cards.push(
      {
        glyph: ICON_THERMOMETER,
        label: 'Inside',
        value:
          s.inside_temp != null
            ? `${fmtNumber(u.toTemperatureDisplay(s.inside_temp), 1, u.locale)}${u.tempUnit}`
            : EM_DASH,
        color: '#f97316',
      },
      {
        glyph: ICON_THERMOMETER,
        label: 'Outside',
        value:
          s.outside_temp != null
            ? `${fmtNumber(u.toTemperatureDisplay(s.outside_temp), 1, u.locale)}${u.tempUnit}`
            : EM_DASH,
        color: '#3b82f6',
      },
      {
        glyph: ICON_NAVIGATION,
        label: 'Odometer',
        value: `${fmtInt(u.toDistanceDisplay(s.odometer), u.locale)} ${u.distanceUnit}`,
        color: '#a855f7',
      },
      {
        glyph: ICON_ACTIVITY,
        label: 'Ideal Range',
        value: `${fmtNumber(u.toDistanceDisplay(s.ideal_range), 0, u.locale)} ${u.distanceUnit}`,
        color: '#00f0ff',
      },
    );
  }

  // Always-visible cards (web L223-229).
  cards.push(
    {
      glyph: s.is_locked ? ICON_LOCK : ICON_UNLOCK,
      label: t('common.status', 'Status'),
      value: s.is_locked
        ? t('common.locked', 'Locked')
        : t('common.unlocked', 'Unlocked'),
      color: s.is_locked ? '#10b981' : '#f59e0b',
    },
    {
      glyph: ICON_SHIELD,
      label: t('common.sentry', 'Sentry'),
      value: s.sentry_mode
        ? t('common.active', 'Active')
        : t('common.off', 'Off'),
      color: s.sentry_mode ? '#ef4444' : '#374151',
    },
    {
      glyph: ICON_GAUGE,
      label: 'Firmware',
      value: firmware,
      color: '#6366f1',
    },
    {
      glyph: ICON_ZAP,
      label: 'Power',
      value: `${fmtNumber(s.power, 2, u.locale)} kW`,
      color: s.power > 0 ? '#f59e0b' : s.power < 0 ? '#10b981' : '#374151',
    },
  );

  return cards;
}

/* ------------------------------------------------------------------ */
/*  native VehicleHero (web ../components/VehicleHero)                  */
/* ------------------------------------------------------------------ */

interface VehicleHeroProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  firmwareVersion: string;
  toDistanceDisplay: (meters: number) => number;
  toSpeedDisplay: (mps: number) => number;
  toTemperatureDisplay: (celsius: number) => number;
  isFahrenheit: boolean;
  distanceUnit: string;
  speedUnit: string;
  tempUnit: string;
  locale: string;
  lastFetchedAt?: number;
  onNavigate?: (to: string) => void;
}

function VehicleHero({
  vehicle,
  state,
  firmwareVersion,
  toDistanceDisplay,
  toSpeedDisplay,
  toTemperatureDisplay,
  isFahrenheit,
  distanceUnit,
  speedUnit,
  tempUnit,
  locale,
  lastFetchedAt,
  onNavigate,
}: VehicleHeroProps) {
  const t = useNativeTranslation();
  const status = state?.state ?? 'offline';

  return (
    <View style={styles.heroRoot}>
      {/* Vehicle name + status */}
      <View style={styles.nameRow}>
        <AppText style={styles.heroName} variant="title" weight="bold">
          {vehicle.display_name || vehicle.vin}
        </AppText>
        <StatusBadge status={status} />
        <FreshnessIndicator
          timestamp={
            lastFetchedAt
              ? new Date(lastFetchedAt).toISOString()
              : vehicle.updated_at
          }
        />
      </View>
      <AppText style={styles.subText} tone="secondary">
        {vehicle.model} {vehicle.trim_badging} ·{' '}
        <AppText style={styles.vinMono} tone="secondary">
          {vehicle.vin}
        </AppText>
      </AppText>

      {state ? (
        <View style={styles.heroBody}>
          {/* Context-aware radial gauges */}
          <View style={styles.gaugesRow}>
            <RadialGauge
              color={state.battery_level > 50 ? '#10b981' : '#f59e0b'}
              label={t('hero.battery', 'Battery')}
              max={100}
              size={70}
              unit="%"
              value={state.battery_level}
            />
            <RadialGauge
              color="#00f0ff"
              label={t('hero.range', 'Range')}
              max={600}
              size={70}
              unit={distanceUnit}
              value={Math.round(toDistanceDisplay(state.rated_range))}
            />
            {status === 'driving' || state.speed > 0 ? (
              <RadialGauge
                color="#a855f7"
                label={t('hero.speed', 'Speed')}
                max={250}
                size={70}
                unit={speedUnit}
                value={Math.round(toSpeedDisplay(state.speed))}
              />
            ) : null}
            {state.is_charging ? (
              <RadialGauge
                color="#10b981"
                label={t('hero.power', 'Power')}
                max={250}
                size={70}
                unit="kW"
                value={Math.round(state.charger_power ?? 0)}
              />
            ) : null}
            <RadialGauge
              color="#f97316"
              label={t('hero.inside', 'Inside')}
              max={isFahrenheit ? 122 : 50}
              size={70}
              unit={tempUnit}
              value={Math.round(toTemperatureDisplay(state.inside_temp))}
            />
            <RadialGauge
              color="#3b82f6"
              label={t('hero.outside', 'Outside')}
              max={isFahrenheit ? 122 : 50}
              size={70}
              unit={tempUnit}
              value={Math.round(toTemperatureDisplay(state.outside_temp))}
            />
          </View>

          {/* Charging details — only when charging */}
          {state.is_charging ? (
            <View style={styles.chargingBox}>
              <View style={styles.chargingHeader}>
                <AppText style={styles.chargingHeaderGlyph}>
                  {ICON_BATTERY_CHARGING}
                </AppText>
                <AppText style={styles.chargingTitle} weight="semibold">
                  {t('hero.charging', 'Charging')}
                </AppText>
              </View>
              <View style={styles.chargingGrid}>
                <View style={styles.chargingCol}>
                  <AppText style={styles.chargingLabel} tone="secondary">
                    {t('hero.chargePower', 'Power')}
                  </AppText>
                  <AppText style={styles.chargingValueAccent} weight="bold">
                    {fmtNumber(state.charger_power, 2, locale)} kW
                  </AppText>
                </View>
                <View style={styles.chargingCol}>
                  <AppText style={styles.chargingLabel} tone="secondary">
                    {t('hero.chargeRate', 'Rate')}
                  </AppText>
                  <AppText style={styles.chargingValue} weight="bold">
                    {fmtInt(toDistanceDisplay(state.charge_rate ?? 0), locale)}{' '}
                    {distanceUnit}/h
                  </AppText>
                </View>
                <View style={styles.chargingCol}>
                  <AppText style={styles.chargingLabel} tone="secondary">
                    {t('hero.timeToFull', 'Time to Full')}
                  </AppText>
                  <AppText style={styles.chargingValue} weight="bold">
                    {state.time_to_full_charge > 0
                      ? `${fmtNumber(state.time_to_full_charge, 1, locale)}h`
                      : EM_DASH}
                  </AppText>
                  {state.time_to_full_charge > 0 ? (
                    <AppText style={styles.chargingSub} tone="secondary">
                      {t('hero.doneAt', 'Done')} ~
                      {formatTime(
                        new Date(
                          Date.now() + state.time_to_full_charge * 3_600_000,
                        ),
                        locale,
                      )}
                    </AppText>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          {/* Context-aware stat grid */}
          <View style={styles.statGrid}>
            {buildStatCards(
              state,
              firmwareVersion,
              {
                toDistanceDisplay,
                toSpeedDisplay,
                toTemperatureDisplay,
                distanceUnit,
                speedUnit,
                tempUnit,
                locale,
              },
              t,
            ).map(item => (
              <View key={item.label} style={styles.statCard}>
                <AppText style={[styles.statIconGlyph, {color: item.color}]}>
                  {item.glyph}
                </AppText>
                <View style={styles.statTextWrap}>
                  <AppText style={styles.statLabel} tone="secondary">
                    {item.label}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={styles.statValue}
                    weight="semibold">
                    {item.value}
                  </AppText>
                </View>
              </View>
            ))}
          </View>

          {/* Quick action buttons */}
          <View style={styles.actionsRow}>
            <HeroActionButton
              glyph={ICON_EYE}
              label={t('hero.details', 'Details')}
              onNavigate={onNavigate}
              to={`/vehicles/${vehicle.id}`}
            />
            <HeroActionButton
              glyph={ICON_ZAP}
              label={t('hero.commands', 'Commands')}
              onNavigate={onNavigate}
              to="/commands"
            />
            <HeroActionButton
              glyph={ICON_MAP_PIN}
              label={t('hero.liveMap', 'Live Map')}
              onNavigate={onNavigate}
              to="/live"
            />
            <HeroActionButton
              glyph={ICON_MONITOR}
              label={t('hero.digitalTwin', 'Digital Twin')}
              onNavigate={onNavigate}
              to="/digital-twin"
            />
          </View>
        </View>
      ) : (
        <GlassPanel style={styles.asleepPanel}>
          <View style={styles.skeletonBar} />
          <AppText style={styles.asleepMessage} tone="muted">
            {t('hero.asleep', 'Vehicle asleep — wake to see live data')}
          </AppText>
          <View style={styles.asleepButtonWrap}>
            <HeroActionButton
              glyph={ICON_ZAP}
              label={t('hero.wakeUp', 'Wake Up')}
              onNavigate={onNavigate}
              to="/commands"
              variant="primary"
            />
          </View>
        </GlassPanel>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  VehicleHeroWidget (web L15-60)                                     */
/* ------------------------------------------------------------------ */

export default function VehicleHeroWidget({
  vehicleId,
  onNavigate,
}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const vehicle = vehicleId
    ? (vehicles?.find(v => v.id === vehicleId) ?? vehicles?.[0])
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  const {
    data: stateData,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  const {state: live} = useVehicleLive(vehicle?.id);
  /* State values arrive in SI units: range/odometer in meters, speed in m/s,
   * and temperatures in °C. Wrap SI-aware converters so VehicleHero receives
   * display-unit values without changing its component contract. */
  const {unitPrefs} = useUnits();
  const isFahrenheit = useIsFahrenheit();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const toDistanceDisplay = (meters: number) =>
    convertDistanceFromSI(meters, unitPrefs.distance);
  const toSpeedDisplay = (mps: number) =>
    convertSpeedFromSI(mps, unitPrefs.speed);
  const toTemperatureDisplay = (celsius: number) =>
    convertTempFromSI(celsius, unitPrefs.temperature);

  // Native useVehicleState types `state` as a `VehicleState | string` union;
  // the web file treats it as `VehicleState | null`, so resolve it once via the
  // same cast the web render applies when passing the prop.
  const vehicleState = (stateData?.state ?? null) as VehicleState | null;

  const firmwareVersion =
    live.version ||
    live.swUpdateVersion ||
    vehicleState?.software_version ||
    EM_DASH;

  return (
    <WidgetShell
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={!vehicle}
      noPadding
      onRefresh={() => refetch()}
      updatedAt={dataUpdatedAt}>
      {vehicle ? (
        <VehicleHero
          distanceUnit={distanceUnit}
          firmwareVersion={firmwareVersion}
          isFahrenheit={isFahrenheit}
          lastFetchedAt={dataUpdatedAt}
          locale={unitPrefs.locale}
          onNavigate={onNavigate}
          speedUnit={speedUnit}
          state={vehicleState}
          tempUnit={tempUnit}
          toDistanceDisplay={toDistanceDisplay}
          toSpeedDisplay={toSpeedDisplay}
          toTemperatureDisplay={toTemperatureDisplay}
          vehicle={vehicle as unknown as Vehicle}
        />
      ) : null}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    rowGap: spacing.sm,
  },
  asleepButtonWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  asleepMessage: {
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  asleepPanel: {
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: spacing.md + 4,
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  chargingBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  chargingCol: {
    alignItems: 'center',
    flex: 1,
    minWidth: 90,
  },
  chargingGrid: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.sm,
  },
  chargingHeader: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  chargingHeaderGlyph: {
    color: '#34d399',
    fontSize: 14,
  },
  chargingLabel: {
    fontSize: 11,
  },
  chargingSub: {
    fontSize: 10,
    marginTop: 2,
  },
  chargingTitle: {
    color: '#6ee7b7',
    fontSize: 13,
  },
  chargingValue: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  chargingValueAccent: {
    color: '#6ee7b7',
    fontSize: 13,
  },
  datumDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  datumFreshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  datumLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  dataFreshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  dataFreshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  dataFreshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  gaugesRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    rowGap: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heroBody: {
    marginTop: spacing.lg,
  },
  heroButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    columnGap: spacing.xs,
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  heroButtonGlyph: {
    fontSize: 13,
  },
  heroButtonPressed: {
    opacity: 0.7,
  },
  heroButtonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  heroButtonText: {
    color: colors.textPrimary,
  },
  heroButtonTextPrimary: {
    color: colors.background,
  },
  heroName: {
    color: colors.textPrimary,
  },
  heroRoot: {
    padding: spacing.md + 4,
  },
  nameRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.xs,
    rowGap: spacing.xs,
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  skeletonBar: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 32,
    width: '60%',
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    columnGap: spacing.sm,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    padding: 10,
  },
  statGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  statIconGlyph: {
    fontSize: 14,
  },
  statLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statTextWrap: {
    flexShrink: 1,
    minWidth: 0,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  statusBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  subText: {
    fontSize: 13,
  },
  vinMono: {
    fontFamily: 'monospace',
  },
});
