// Native parity port of
// web/src/features/dashboard/components/VehicleHero.tsx.
//
// The web component is the dashboard "vehicle hero" panel: a header (vehicle
// name + StatusBadge + FreshnessIndicator), a model/trim/VIN subtitle, and then
// — only when a live `state` exists — a row of context-aware RadialGauges
// (battery, range, optional speed, optional charge power, inside + outside
// temp), an optional charging-details panel, a context-aware 2/4-column stat
// grid built by `buildStatCards`, and a row of quick-action navigation buttons
// (Details / Commands / Live Map / Digital Twin). When `state` is null it falls
// back to a GlassPanel "Vehicle asleep" card with a Skeleton bar and a "Wake Up"
// button. It is reproduced here with React Native primitives, preserving the
// `VehicleHeroProps` contract, every prop name, the `status` derivation, the
// driving/charging/temperature branch logic in `buildStatCards`, all hardcoded
// vs. `t()`-localized labels, the unit converters, the API navigation paths, and
// the explicit per-element hex colors:
//
//   - react-router-dom `Link to={...}` wrappers around the action/Wake-Up
//     `<Button>`s become a Button `onPress` that calls an additive, optional
//     `onNavigate(path)` prop, preserving the four `/vehicles/{id}`, `/commands`,
//     `/live`, `/digital-twin` paths verbatim (Breadcrumbs/AutomationListPage
//     onNavigate precedent). The existing required props are untouched.
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t(key, fallback) shim
//     returns the English fallback verbatim (AddWidgetButton/LayoutManager
//     precedent), so every `hero.*` / `common.*` key + copy is preserved.
//   - `@/hooks/useDateFormat` `formatTime` (settings locale + tz aware) becomes a
//     local `formatTime` using `Date#toLocaleTimeString([], {hour, minute})` with
//     the same `'—'` invalid-date fallback as the web `@/lib/dateFormat`.
//   - `@/lib/numberFormat` `fmtNumber`/`fmtInt` are inlined as local helpers with
//     the same semantics (locale-aware `toLocaleString`, global default precision
//     2, `fmtInt` = 0 decimals).
//   - `@/components/ui` `GlassPanel`, `Button` and `@/components/charts`
//     `RadialGauge` are the already-ported native parity components.
//   - `@/components/data-display` `StatusBadge` (web reads its dot color from the
//     `vehicle` FSM `getStateDefinition(...).badgeDot`) and `FreshnessIndicator`
//     (a dot + relative-age label that re-renders every 10s), and
//     `@/components/feedback` `Skeleton`, have no shared native parity module, so
//     they are reproduced locally (the AutomationListPage StatusBadge/SkeletonBar
//     inline precedent). The badgeDot Tailwind classes are resolved to literal
//     hex via the `VARIANT_THEME` + vehicle overrides; the FreshnessIndicator
//     `neon-green/amber/red` dots resolve to #10b981/#f59e0b/#ef4444 and the
//     `animate-pulse` on "fresh" becomes a reduced-motion-aware Animated loop.
//   - lucide-react icons (Thermometer, Lock, Unlock, Shield, Zap, Activity,
//     Navigation, Gauge, Clock, Eye, MapPin, BatteryCharging, Monitor) have no
//     native icon dependency; per the LayoutManager/VampireDrainPage glyph
//     precedent they become decorative Unicode glyphs in AppText tinted with the
//     web `style={{color}}` value (importantForAccessibility="no"; the adjacent
//     label carries the meaning).
//   - The web `bg-gradient-to-br from-neon-cyan/[0.02] … to-neon-purple/[0.02]`
//     overlay (a ~2%-opacity decorative wash) has no core-RN linear-gradient
//     primitive (no gradient dependency here) and is dropped — documented in the
//     sidecar. The `overflow-hidden`/`h-full` root maps to a flex:1 View with
//     `overflow: 'hidden'`.
//   - Tailwind utility classes become RN StyleSheet records; the web's explicit
//     hex colors (gauge + stat-card + charging-panel tints) are preserved as
//     literals, and `--text-secondary`/`--text-muted` map to the text tokens.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors } from '../../../../theme/tokens';
import { RadialGauge } from '../../../components/charts/RadialGauge';
import { Button } from '../../../components/ui/Button';
import { GlassPanel } from '../../../components/ui/GlassPanel';

/* ─── domain types (web `../types`) ────────────────────────────────────────── */

export interface Vehicle {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  model: string;
  trim_badging: string;
  exterior_color: string;
  wheel_type: string;
  state: string;
  healthy: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehicleState {
  vehicle_id: number;
  state: string;
  latitude: number;
  longitude: number;
  speed: number;
  power: number;
  battery_level: number;
  rated_range: number;
  ideal_range: number;
  odometer: number;
  inside_temp: number;
  outside_temp: number;
  is_climate_on: boolean;
  is_charging: boolean;
  charger_power: number;
  charge_rate: number;
  time_to_full_charge: number;
  is_locked: boolean;
  sentry_mode: boolean;
  software_version: string;
}

/* ─── i18n fallback shim (react-i18next useTranslation) ────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── reduced-motion (web CSS `animate-pulse` honors prefers-reduced-motion) ── */

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

/* ─── number + time formatters (web @/lib/numberFormat, @/lib/dateFormat) ───── */

const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// web `@/lib/dateFormat` formatTime: locale-aware HH:MM with an em-dash fallback
// for nullish/invalid dates.
function formatTime(value: Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ─── decorative lucide glyphs (importantForAccessibility="no") ────────────── */

const GLYPH_THERMOMETER = '\uD83C\uDF21'; // lucide Thermometer 🌡
const GLYPH_LOCK = '\uD83D\uDD12'; // lucide Lock 🔒
const GLYPH_UNLOCK = '\uD83D\uDD13'; // lucide Unlock 🔓
const GLYPH_SHIELD = '\uD83D\uDEE1'; // lucide Shield 🛡
const GLYPH_ZAP = '\u26A1'; // lucide Zap ⚡
const GLYPH_ACTIVITY = '\uD83D\uDCC8'; // lucide Activity 📈
const GLYPH_NAVIGATION = '\uD83E\uDDED'; // lucide Navigation 🧭
const GLYPH_GAUGE = '\u23F1'; // lucide Gauge ⏱
const GLYPH_CLOCK = '\u23F0'; // lucide Clock ⏰
const GLYPH_EYE = '\uD83D\uDC41'; // lucide Eye 👁
const GLYPH_MAP_PIN = '\uD83D\uDCCD'; // lucide MapPin 📍
const GLYPH_BATTERY_CHARGING = '\uD83D\uDD0B'; // lucide BatteryCharging 🔋
const GLYPH_MONITOR = '\uD83D\uDDA5'; // lucide Monitor 🖥

/* ─── StatusBadge (web @/components/data-display/StatusBadge) ───────────────── */

// Vehicle FSM badgeDot Tailwind classes resolved to literal hex (VARIANT_THEME +
// per-state overrides from web/src/types/fsm/vehicle.ts).
const STATUS_DOT: Record<string, string> = {
  online: '#4ade80', // success -> green-400
  driving: '#3b82f6', // override blue-500
  charging: '#facc15', // override yellow-400
  parked: '#06b6d4', // override cyan-500
  updating: '#6366f1', // override indigo-500
  asleep: '#a855f7', // override purple-500
  offline: '#f87171', // danger -> red-400
};
const STATUS_DOT_DEFAULT = '#9ca3af'; // neutral -> gray-400

const BADGE_BORDER = '#374151'; // dark:border-gray-700
const BADGE_BG = '#1f2937'; // dark:bg-gray-800

type BadgeSize = 'sm' | 'md';

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function StatusBadge({
  status,
  size = 'md',
}: {
  status: string;
  size?: BadgeSize;
}) {
  const dotColor = STATUS_DOT[status] ?? STATUS_DOT_DEFAULT;
  const isSm = size === 'sm';
  return (
    <View
      style={[styles.badge, isSm ? styles.badgeSm : styles.badgeMd]}
      testID="vehicle-hero-status-badge"
    >
      <View
        style={[
          styles.badgeDot,
          isSm ? styles.badgeDotSm : styles.badgeDotMd,
          { backgroundColor: dotColor },
        ]}
      />
      <AppText
        style={[
          styles.badgeText,
          isSm ? styles.badgeTextSm : styles.badgeTextMd,
        ]}
      >
        {capitalize(status)}
      </AppText>
    </View>
  );
}

StatusBadge.displayName = 'StatusBadge';

/* ─── FreshnessIndicator (web @/components/data-display) ────────────────────── */

type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'unknown';

const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#10b981', // neon-green
  stale: '#f59e0b', // neon-amber
  offline: '#ef4444', // neon-red
  unknown: '#151621', // --surface-2
};

function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

function getFreshnessStatus(
  age: number | null,
  staleThreshold: number,
  offlineThreshold: number,
): FreshnessStatus {
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
    return '—';
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
  showLabel = true,
  size = 'sm',
}: {
  timestamp: string | null | undefined;
  staleThreshold?: number;
  offlineThreshold?: number;
  showLabel?: boolean;
  size?: BadgeSize;
}) {
  const [, setTick] = useState(0);
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  // Re-render every 10 seconds to keep relative time fresh.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const age = computeAge(timestamp);
  const status = getFreshnessStatus(age, staleThreshold, offlineThreshold);
  const label = formatAge(age);
  const isFresh = status === 'fresh';

  useEffect(() => {
    if (!isFresh || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.4,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isFresh, pulse, reduceMotion]);

  const isSm = size === 'sm';
  return (
    <View style={styles.freshness}>
      <Animated.View
        style={[
          isSm ? styles.badgeDotSm : styles.badgeDotMd,
          styles.freshnessDot,
          { backgroundColor: FRESHNESS_DOT[status], opacity: pulse },
        ]}
      />
      {showLabel ? (
        <AppText
          style={[
            styles.freshnessLabel,
            isSm ? styles.freshnessLabelSm : styles.freshnessLabelMd,
          ]}
        >
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

FreshnessIndicator.displayName = 'FreshnessIndicator';

/* ─── Skeleton (web @/components/feedback/Skeleton) ─────────────────────────── */

function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.45,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return <Animated.View style={[styles.skeleton, style, { opacity: pulse }]} />;
}

/* ─── VehicleHero ──────────────────────────────────────────────────────────── */

export interface VehicleHeroProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  firmwareVersion: string;
  toDistanceDisplay: (km: number) => number;
  toSpeedDisplay: (kmh: number) => number;
  toTemperatureDisplay: (c: number) => number;
  isFahrenheit: boolean;
  distanceUnit: string;
  speedUnit: string;
  tempUnit: string;
  /** TanStack Query dataUpdatedAt (ms epoch) — overrides vehicle.updated_at for freshness */
  lastFetchedAt?: number;
  /** Native navigation callback (web `<Link to>`); preserves the four paths. */
  onNavigate?: (path: string) => void;
}

export function VehicleHero({
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
  lastFetchedAt,
  onNavigate,
}: VehicleHeroProps) {
  const t = useNativeTranslationFallback();
  const status = (state?.state ?? 'offline') as string;
  const go = useCallback(
    (path: string) => () => onNavigate?.(path),
    [onNavigate],
  );

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {/* Vehicle name + status */}
        <View style={styles.headerRow}>
          <AppText style={styles.vehicleName}>
            {vehicle.display_name || vehicle.vin}
          </AppText>
          <StatusBadge size="md" status={status} />
          <FreshnessIndicator
            timestamp={
              lastFetchedAt
                ? new Date(lastFetchedAt).toISOString()
                : vehicle.updated_at
            }
          />
        </View>
        <AppText style={styles.subtitle}>
          {vehicle.model} {vehicle.trim_badging} ·{' '}
          <AppText style={styles.subtitleVin}>{vehicle.vin}</AppText>
        </AppText>

        {state ? (
          <View style={styles.liveBlock}>
            {/* Context-aware radial gauges */}
            <View style={styles.gaugeRow}>
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
              <View style={styles.chargingPanel}>
                <View style={styles.chargingHeader}>
                  <AppText
                    importantForAccessibility="no"
                    style={styles.chargingHeaderGlyph}
                  >
                    {GLYPH_BATTERY_CHARGING}
                  </AppText>
                  <AppText style={styles.chargingHeaderLabel}>
                    {t('hero.charging', 'Charging')}
                  </AppText>
                </View>
                <View style={styles.chargingGrid}>
                  <View style={styles.chargingCell}>
                    <AppText style={styles.chargingCellLabel}>
                      {t('hero.chargePower', 'Power')}
                    </AppText>
                    <AppText style={styles.chargingCellEmphasis}>
                      {fmtNumber(state.charger_power)} kW
                    </AppText>
                  </View>
                  <View style={styles.chargingCell}>
                    <AppText style={styles.chargingCellLabel}>
                      {t('hero.chargeRate', 'Rate')}
                    </AppText>
                    <AppText style={styles.chargingCellValue}>
                      {fmtInt(toDistanceDisplay(state.charge_rate ?? 0))}{' '}
                      {distanceUnit}/h
                    </AppText>
                  </View>
                  <View style={styles.chargingCell}>
                    <AppText style={styles.chargingCellLabel}>
                      {t('hero.timeToFull', 'Time to Full')}
                    </AppText>
                    <AppText style={styles.chargingCellValue}>
                      {state.time_to_full_charge > 0
                        ? `${fmtNumber(state.time_to_full_charge, 1)}h`
                        : '—'}
                    </AppText>
                    {state.time_to_full_charge > 0 ? (
                      <AppText style={styles.chargingCellSub}>
                        {t('hero.doneAt', 'Done')} ~
                        {formatTime(
                          new Date(
                            Date.now() + state.time_to_full_charge * 3_600_000,
                          ),
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
                vehicle,
                state,
                firmwareVersion,
                {
                  toDistanceDisplay,
                  toSpeedDisplay,
                  toTemperatureDisplay,
                  distanceUnit,
                  speedUnit,
                  tempUnit,
                },
                t,
              ).map(item => (
                <View key={item.label} style={styles.statCard}>
                  <AppText
                    importantForAccessibility="no"
                    style={[styles.statGlyph, { color: item.color }]}
                  >
                    {item.glyph}
                  </AppText>
                  <View style={styles.statText}>
                    <AppText numberOfLines={1} style={styles.statLabel}>
                      {item.label}
                    </AppText>
                    <AppText numberOfLines={1} style={styles.statValue}>
                      {item.value}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>

            {/* Quick action buttons */}
            <View style={styles.actionRow}>
              <Button
                icon={<ActionGlyph glyph={GLYPH_EYE} />}
                onPress={go(`/vehicles/${vehicle.id}`)}
                size="sm"
                variant="secondary"
              >
                {t('hero.details', 'Details')}
              </Button>
              <Button
                icon={<ActionGlyph glyph={GLYPH_ZAP} />}
                onPress={go('/commands')}
                size="sm"
                variant="secondary"
              >
                {t('hero.commands', 'Commands')}
              </Button>
              <Button
                icon={<ActionGlyph glyph={GLYPH_MAP_PIN} />}
                onPress={go('/live')}
                size="sm"
                variant="secondary"
              >
                {t('hero.liveMap', 'Live Map')}
              </Button>
              <Button
                icon={<ActionGlyph glyph={GLYPH_MONITOR} />}
                onPress={go('/digital-twin')}
                size="sm"
                variant="secondary"
              >
                {t('hero.digitalTwin', 'Digital Twin')}
              </Button>
            </View>
          </View>
        ) : (
          <GlassPanel padding="md" style={styles.asleepPanel}>
            <Skeleton style={styles.asleepSkeleton} />
            <AppText style={styles.asleepText}>
              {t('hero.asleep', 'Vehicle asleep — wake to see live data')}
            </AppText>
            <Button
              onPress={go('/commands')}
              size="sm"
              style={styles.wakeButton}
              variant="primary"
            >
              {t('hero.wakeUp', 'Wake Up')}
            </Button>
          </GlassPanel>
        )}
      </View>
    </View>
  );
}

VehicleHero.displayName = 'VehicleHero';

export default VehicleHero;

/* ─── ActionGlyph (decorative leading glyph inside a Button) ────────────────── */

function ActionGlyph({ glyph }: { glyph: string }) {
  return (
    <AppText importantForAccessibility="no" style={styles.actionGlyph}>
      {glyph}
    </AppText>
  );
}

/* ─── buildStatCards (web buildStatCards) ──────────────────────────────────── */

interface StatItem {
  glyph: string;
  label: string;
  value: string;
  color: string;
}

function buildStatCards(
  _vehicle: Vehicle,
  s: VehicleState,
  firmware: string,
  u: {
    toDistanceDisplay: (v: number) => number;
    toSpeedDisplay: (v: number) => number;
    toTemperatureDisplay: (v: number) => number;
    distanceUnit: string;
    speedUnit: string;
    tempUnit: string;
  },
  t: (key: string, fallback: string) => string,
): StatItem[] {
  const isDriving = s.state === 'driving' || s.speed > 0;
  const isCharging = s.is_charging;
  const cards: StatItem[] = [];

  if (isDriving) {
    cards.push(
      {
        glyph: GLYPH_GAUGE,
        label: 'Speed',
        value: `${fmtNumber(u.toSpeedDisplay(s.speed), 0)} ${u.speedUnit}`,
        color: '#a855f7',
      },
      {
        glyph: GLYPH_ZAP,
        label: 'Power',
        value: `${fmtNumber(s.power)} kW`,
        color: s.power > 0 ? '#f59e0b' : s.power < 0 ? '#10b981' : '#374151',
      },
      {
        glyph: GLYPH_NAVIGATION,
        label: 'Odometer',
        value: `${fmtInt(u.toDistanceDisplay(s.odometer))} ${u.distanceUnit}`,
        color: '#a855f7',
      },
      {
        glyph: GLYPH_ACTIVITY,
        label: 'Ideal Range',
        value: `${fmtNumber(u.toDistanceDisplay(s.ideal_range), 0)} ${
          u.distanceUnit
        }`,
        color: '#00f0ff',
      },
    );
  } else if (isCharging) {
    cards.push(
      {
        glyph: GLYPH_ZAP,
        label: 'Charge Rate',
        value: `${fmtInt(u.toDistanceDisplay(s.charge_rate ?? 0))} ${
          u.distanceUnit
        }/h`,
        color: '#10b981',
      },
      {
        glyph: GLYPH_CLOCK,
        label: 'Time to Full',
        value:
          s.time_to_full_charge > 0
            ? `${fmtNumber(s.time_to_full_charge, 1)}h`
            : '—',
        color: '#f59e0b',
      },
      {
        glyph: GLYPH_ACTIVITY,
        label: 'Ideal Range',
        value: `${fmtNumber(u.toDistanceDisplay(s.ideal_range), 0)} ${
          u.distanceUnit
        }`,
        color: '#00f0ff',
      },
      {
        glyph: GLYPH_NAVIGATION,
        label: 'Odometer',
        value: `${fmtInt(u.toDistanceDisplay(s.odometer))} ${u.distanceUnit}`,
        color: '#a855f7',
      },
    );
  } else {
    cards.push(
      {
        glyph: GLYPH_THERMOMETER,
        label: 'Inside',
        value:
          s.inside_temp != null
            ? `${fmtNumber(u.toTemperatureDisplay(s.inside_temp), 1)}${
                u.tempUnit
              }`
            : '—',
        color: '#f97316',
      },
      {
        glyph: GLYPH_THERMOMETER,
        label: 'Outside',
        value:
          s.outside_temp != null
            ? `${fmtNumber(u.toTemperatureDisplay(s.outside_temp), 1)}${
                u.tempUnit
              }`
            : '—',
        color: '#3b82f6',
      },
      {
        glyph: GLYPH_NAVIGATION,
        label: 'Odometer',
        value: `${fmtInt(u.toDistanceDisplay(s.odometer))} ${u.distanceUnit}`,
        color: '#a855f7',
      },
      {
        glyph: GLYPH_ACTIVITY,
        label: 'Ideal Range',
        value: `${fmtNumber(u.toDistanceDisplay(s.ideal_range), 0)} ${
          u.distanceUnit
        }`,
        color: '#00f0ff',
      },
    );
  }

  // Always-visible cards
  cards.push(
    {
      glyph: s.is_locked ? GLYPH_LOCK : GLYPH_UNLOCK,
      label: t('common.status', 'Status'),
      value: s.is_locked
        ? t('common.locked', 'Locked')
        : t('common.unlocked', 'Unlocked'),
      color: s.is_locked ? '#10b981' : '#f59e0b',
    },
    {
      glyph: GLYPH_SHIELD,
      label: t('common.sentry', 'Sentry'),
      value: s.sentry_mode
        ? t('common.active', 'Active')
        : t('common.off', 'Off'),
      color: s.sentry_mode ? '#ef4444' : '#374151',
    },
    {
      glyph: GLYPH_GAUGE,
      label: 'Firmware',
      value: firmware,
      color: '#6366f1',
    },
    {
      glyph: GLYPH_ZAP,
      label: 'Power',
      value: `${fmtNumber(s.power)} kW`,
      color: s.power > 0 ? '#f59e0b' : s.power < 0 ? '#10b981' : '#374151',
    },
  );

  return cards;
}

/* ─── styles ───────────────────────────────────────────────────────────────── */

const TEXT_SECONDARY = colors.textSecondary;
const TEXT_MUTED = colors.textMuted;

const styles = StyleSheet.create({
  actionGlyph: {
    color: '#f3f4f6',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  asleepPanel: {
    alignItems: 'center',
    marginTop: 24,
  },
  asleepSkeleton: {
    alignSelf: 'stretch',
    height: 32,
  },
  asleepText: {
    color: TEXT_MUTED,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: BADGE_BG,
    borderColor: BADGE_BORDER,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
  },
  badgeDot: {
    borderRadius: 999,
  },
  badgeDotMd: {
    height: 8,
    width: 8,
  },
  badgeDotSm: {
    height: 6,
    width: 6,
  },
  badgeMd: {
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeSm: {
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: TEXT_SECONDARY,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  badgeTextMd: {
    fontSize: 14,
  },
  badgeTextSm: {
    fontSize: 12,
  },
  chargingCell: {
    alignItems: 'center',
    flexBasis: '28%',
    flexGrow: 1,
  },
  chargingCellEmphasis: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '700',
  },
  chargingCellLabel: {
    color: TEXT_SECONDARY,
    fontSize: 12,
  },
  chargingCellSub: {
    color: TEXT_SECONDARY,
    fontSize: 10,
  },
  chargingCellValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  chargingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-around',
  },
  chargingHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  chargingHeaderGlyph: {
    color: '#10b981',
    fontSize: 16,
  },
  chargingHeaderLabel: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '500',
  },
  chargingPanel: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 12,
  },
  content: {
    padding: 16,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  freshnessDot: {
    borderRadius: 999,
  },
  freshnessLabel: {
    color: TEXT_MUTED,
  },
  freshnessLabelMd: {
    fontSize: 12,
  },
  freshnessLabelSm: {
    fontSize: 10,
  },
  gaugeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 24,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 4,
  },
  liveBlock: {
    marginTop: 24,
  },
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: 8,
    padding: 10,
  },
  statGlyph: {
    fontSize: 16,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statLabel: {
    color: TEXT_SECONDARY,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statText: {
    flexShrink: 1,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    color: TEXT_SECONDARY,
    fontSize: 14,
  },
  subtitleVin: {
    fontFamily: 'monospace',
  },
  vehicleName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  wakeButton: {
    marginTop: 12,
  },
});
