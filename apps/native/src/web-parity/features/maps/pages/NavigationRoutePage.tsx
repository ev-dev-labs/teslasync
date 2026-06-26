// Native parity port of web/src/features/maps/pages/NavigationRoutePage.tsx.
//
// Navigation & Route page for the selected vehicle. Backed by three location
// queries plus the charging-telemetry latest query:
//   - GET /api/v1/vehicles                              (the vehicle list, used
//     for the header VehicleSelect + the vehiclesLoading/vehiclesError state).
//   - GET /api/v1/location-snapshots/latest?vehicle_id= (the latest snapshot:
//     position/GPS, heading, navigation route, presence flags).
//   - GET /api/v1/location-snapshots?vehicle_id=&limit=200 (the history used by
//     the charts, the recent-destinations list and the location-history table).
//   - GET /api/v1/charging-telemetry/latest?vehicle_id= (useChargingTelemetryLatest
//     -> expected_energy_pct_at_arrival for the "Energy at Arrival" metric).
//
// Every web behavior, state name, API path, unit-handling rule and i18n key is
// preserved; the web DOM / Tailwind / Recharts / lucide stack is replaced with
// React Native primitives + the native parity component library, following the
// DriveScorePage / TripPlannerPage precedents:
//
//   - `@/components/layout` PageContainer (title/subtitle/loading/error/actions)
//     has no native parity component, so a local ScrollView screen scaffold
//     reproduces the header (title + subtitle), the `actions` row (VehicleSelect +
//     LiveIndicator + Refresh Button) and wraps the body in the native
//     ErrorBoundary (== PageContainer's PageErrorBoundary). Grid -> native
//     flex-wrap rows.
//   - `@/hooks/useSelectedVehicle` -> the inline /vehicles useQuery + a
//     first-vehicle default + a header NativeSelect (== the web VehicleSelect),
//     exposing the same `vehicleId` (number | null) the web hook returned; the
//     same query also feeds `vehiclesLoading` / `vehiclesError`.
//   - `@/components/ui` GlassPanel / Badge / Button reuse the native parity
//     GlassPanel / Button + a local native Badge (success/neutral/warning/danger/
//     info, sm/md/lg, optional dot). DataTable -> a local native NativeDataTable
//     (header row + rows in a horizontal ScrollView, the same controlled
//     sortKey/sortDir/onSort, internal pagination at the web default page size 25).
//   - `@/components/data-display` MetricCard / LiveIndicator / TimeStamp -> a local
//     native MetricCard (wrapping the native parity StatCard) + a local compact
//     LiveIndicator (four-state chip from useLiveConnection) + a local TimeStamp.
//   - `@/components/feedback` Skeleton / EmptyState / AlertBanner /
//     LiveStaleDataBanner -> a local reduced-motion Skeleton, the native parity
//     EmptyState (icon-only web variants get a short title), a local tinted
//     AlertBanner, and a faithful LiveStaleDataBanner (renders null until the live
//     pipe is disconnected for >2min — native live status is 'unknown', so it is
//     inert, documented in the sidecar).
//   - `@/components/motion` FadeIn -> a reduced-motion-aware FadeIn honouring the
//     per-section delay.
//   - `@/components/charts` AreaChart / LineChart / Recharts axes -> a local native
//     NativeSeriesChart (proportional View bars in a horizontal ScrollView with a
//     legend + x labels). The dual-axis speed/distance AreaChart degrades to a
//     per-series-normalized grouped bar chart (each series keeps its own scale, the
//     web's dual independent Y axes intent); the 0/1 step presence LineChart
//     degrades to a fixed [0,1]-domain chart with Yes/No y ticks. The Recharts
//     hover tooltip / gradients / ResponsiveContainer are SVG-only and unavailable
//     on native (documented).
//   - `@/lib/cn` (clsx + tailwind-merge) is dropped; conditional classNames become
//     StyleSheet arrays + computed colour literals.
//   - react-i18next useTranslation -> a local t(key, fallbackOrVars?, vars?) shim
//     mirroring i18next's flexible signature so every key + English copy +
//     `{{cardinal}}/{{degrees}}/{{unit}}` interpolation + the `{defaultValue}` form
//     are preserved verbatim.
//   - `@/hooks/usePageTitle` (document.title) -> native no-op shim.
//   - `@/hooks/useUnits` (formatDuration + unitPrefs) + `@/lib/unitConversion`
//     convertSpeedFromSI / convertDistanceFromSI -> native shims mirroring the web
//     out-of-box defaults (distance 'km', speed 'km/h', duration 'h' precision 0);
//     the API already returns SI and conversion happens only at the display
//     boundary, exactly as the web hooks do.
//   - `@/lib/dateFormat` formatDateTime + `@/lib/numberFormat` fmtNumber +
//     `@/lib/errorMessage` getErrorMessage + `@/lib/signalCatalog` normalizeGpsState
//     + `@/lib/colors` CHART_COLORS -> inlined native-safe equivalents (ported
//     verbatim where pure logic).
//   - lucide-react icons are decorative; rendered as colour-coded emoji glyphs
//     (the visible labels carry the meaning).

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
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {
  useChargingTelemetryLatest,
  type LocationSnapshot,
} from '../../../api/hooks/useVehicles';
import {StatCard} from '../../../components/data-display/StatCard';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {Button} from '../../../components/ui/Button';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number> & {
  defaultValue?: string;
};
type NativeTFunction = (
  key: string,
  fallbackOrVars?: string | TranslationVars,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars?: TranslationVars): string {
  if (vars == null) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

function useNativeTranslation(): NativeTFunction {
  return (key, fallbackOrVars, vars) => {
    if (typeof fallbackOrVars === 'string') {
      return interpolate(fallbackOrVars, vars);
    }
    if (fallbackOrVars != null && typeof fallbackOrVars === 'object') {
      const fallback =
        typeof fallbackOrVars.defaultValue === 'string'
          ? fallbackOrVars.defaultValue
          : key;
      return interpolate(fallback, fallbackOrVars);
    }
    return key;
  };
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat` fmtNumber) ───────────── */

const DEFAULT_GLOBAL_PRECISION = 2;
const FALLBACK = '\u2014'; // — em dash, the web empty-display default.
const CHECK = '\u2713'; // ✓
const DEGREE = '\u00B0'; // °

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatNumberIntl(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  try {
    return value.toLocaleString(locale, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });
  }
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  return formatNumberIntl(
    safeNumber(v),
    locale,
    decimals ?? DEFAULT_GLOBAL_PRECISION,
  );
}

/* ─── native-safe date helper (web `@/lib/dateFormat` formatDateTime) ───────── */

// Mirrors web formatDateTime: "Jun 26, 2026, 06:28 AM"; "—" for nullish/invalid.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return FALLBACK;
  }
}

/* ─── getErrorMessage (web `@/lib/errorMessage`, ported verbatim) ───────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ─── unit shims (web `@/hooks/useUnits` + `@/lib/unitConversion`) ──────────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;

// Mirrors web `convertSpeedFromSI` (SI m/s -> display unit).
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
    case 'km/h':
    default:
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
  }
}

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

// Mirrors web useUnits().formatDuration with the out-of-box duration pref 'h'
// (precision 0): convert SI seconds -> hours, format whole hours, append " h".
function formatDurationHours(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds)) {
    return FALLBACK;
  }
  return `${formatNumberIntl(seconds / SECONDS_PER_HOUR, 'en-US', 0)} h`;
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref; speed: SpeedUnitPref};
  formatDuration: (seconds: number | null | undefined) => string;
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults: distance 'km', speed 'km/h', duration 'h'. The
// API returns SI; conversion happens here at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(
    () => ({
      unitPrefs: {distance: 'km', speed: 'km/h'},
      formatDuration: formatDurationHours,
    }),
    [],
  );
}

/* ─── normalizeGpsState (web `@/lib/signalCatalog`, ported verbatim) ────────── */

type GpsFixState = 'locked' | 'unlocked' | 'unknown';

function normalizeGpsState(raw: string | null | undefined): GpsFixState {
  if (raw == null) {
    return 'unknown';
  }
  const v = String(raw).trim().toLowerCase();
  if (!v) {
    return 'unknown';
  }
  if (
    v === 'true' ||
    v === '1' ||
    v === 'yes' ||
    v === 'gpsvalid' ||
    v === 'fix2d' ||
    v === 'fix3d' ||
    v === 'normal' ||
    v === 'good' ||
    v === 'strong' ||
    v === 'ok' ||
    v === 'valid'
  ) {
    return 'locked';
  }
  if (
    v === 'false' ||
    v === '0' ||
    v === 'no' ||
    v === 'gpsinvalid' ||
    v === 'nofix' ||
    v === 'invalid' ||
    v === 'none'
  ) {
    return 'unlocked';
  }
  return 'unknown';
}

/* ─── CHART_COLORS (web `@/lib/colors` — CB-safe Okabe-Ito default) ─────────── */

const CHART_COLORS = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#4B4B4B', // neutral grey
] as const;

/* ─── decorative lucide glyph stand-ins (labels carry the meaning) ─────────── */

const GLYPH = {
  navigation: '\uD83E\uDDED', // 🧭
  pin: '\uD83D\uDCCD', // 📍
  home: '\uD83C\uDFE0', // 🏠
  briefcase: '\uD83D\uDCBC', // 💼
  satellite: '\uD83D\uDEF0\uFE0F', // 🛰️
  compass: '\uD83E\uDDED', // 🧭
  gauge: '\uD83C\uDF9B\uFE0F', // 🎛️
  clock: '\u23F1\uFE0F', // ⏱️
  battery: '\uD83D\uDD0B', // 🔋
  route: '\uD83D\uDEE3\uFE0F', // 🛣️
  zap: '\u26A1', // ⚡
  alertTriangle: '\u26A0\uFE0F', // ⚠️
  refresh: '\uD83D\uDD04', // 🔄
  trendingUp: '\uD83D\uDCC8', // 📈
  trafficCone: '\uD83D\uDEA7', // 🚧
  alertCircle: '\u26A0\uFE0F', // ⚠️
} as const;

/* ─── web colour literals preserved for visual intent ──────────────────────── */

const EMERALD_400 = '#4ade80'; // located_at_home highlight
const BLUE_400 = '#60a5fa'; // located_at_work highlight
const AMBER_400 = '#fbbf24';
const CYAN_400 = '#22d3ee';
const RED_400 = '#f87171';
const NEON_CYAN = '#00f0ff';

/* ─── reduced-motion + FadeIn (web `@/components/motion` FadeIn) ────────────── */

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

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delay * 1000,
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

/* ─── Skeleton (web `@/components/feedback` Skeleton) ───────────────────────── */

const SKELETON_COLOR = 'rgba(148, 163, 184, 0.18)';

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
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  return pulse;
}

function SkeletonBar({height}: {height: number}) {
  const reduceMotion = useReduceMotion();
  const pulse = useLoopingPulse(reduceMotion);
  const animatedStyle = reduceMotion
    ? null
    : {
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.45, 0.85],
        }),
      };
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.skeletonBar, {height}, animatedStyle]}
    />
  );
}

// Mirrors web `<Skeleton lines={n} />` (stacked text bars) and
// `<Skeleton height={h} />` (a single block).
function Skeleton({lines, height}: {lines?: number; height?: number}) {
  if (typeof height === 'number') {
    return <SkeletonBar height={height} />;
  }
  const count = lines ?? 3;
  return (
    <View style={styles.skeletonStack}>
      {Array.from({length: count}).map((_, index) => (
        <SkeletonBar height={14} key={index} />
      ))}
    </View>
  );
}

Skeleton.displayName = 'Skeleton';

/* ─── Badge (web `@/components/ui` Badge) ───────────────────────────────────── */

type BadgeVariant = 'success' | 'neutral' | 'warning' | 'danger' | 'info';
type BadgeSize = 'sm' | 'md' | 'lg';

const BADGE_PALETTE: Record<
  BadgeVariant,
  {bg: string; border: string; text: string; dot: string}
> = {
  danger: {
    bg: 'rgba(248, 113, 113, 0.12)',
    border: 'rgba(248, 113, 113, 0.32)',
    text: '#f87171',
    dot: '#f87171',
  },
  info: {
    bg: 'rgba(34, 211, 238, 0.12)',
    border: 'rgba(34, 211, 238, 0.32)',
    text: '#22d3ee',
    dot: '#22d3ee',
  },
  neutral: {
    bg: 'rgba(148, 163, 184, 0.12)',
    border: 'rgba(148, 163, 184, 0.28)',
    text: 'rgba(148, 163, 184, 0.92)',
    dot: 'rgba(148, 163, 184, 0.92)',
  },
  success: {
    bg: 'rgba(74, 222, 128, 0.12)',
    border: 'rgba(74, 222, 128, 0.32)',
    text: '#4ade80',
    dot: '#4ade80',
  },
  warning: {
    bg: 'rgba(251, 191, 36, 0.12)',
    border: 'rgba(251, 191, 36, 0.32)',
    text: '#fbbf24',
    dot: '#fbbf24',
  },
};

function Badge({
  variant = 'info',
  size = 'sm',
  dot = false,
  children,
  style,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = BADGE_PALETTE[variant];
  const sizeStyle =
    size === 'lg'
      ? styles.badgeLg
      : size === 'md'
        ? styles.badgeMd
        : styles.badgeSm;
  const textSizeStyle =
    size === 'lg'
      ? styles.badgeTextLg
      : size === 'md'
        ? styles.badgeTextMd
        : styles.badgeTextSm;
  return (
    <View
      style={[
        styles.badge,
        sizeStyle,
        {backgroundColor: palette.bg, borderColor: palette.border},
        style,
      ]}>
      {dot ? (
        <View
          pointerEvents="none"
          style={[styles.badgeDot, {backgroundColor: palette.dot}]}
        />
      ) : null}
      <AppText style={[textSizeStyle, {color: palette.text}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

/* ─── useLiveConnection + LiveIndicator (web `@/components/data-display`) ────── */

type LiveStatus = 'connected' | 'reconnecting' | 'disconnected' | 'unknown';

interface LiveConnection {
  status: LiveStatus;
  lastMessageAt: number | null;
}

// The web hook reflects the SSE wire health. The native parity layer has no SSE
// pipeline wired into this page, so the honest native-safe default is 'unknown'
// (the same state the web hook surfaces before the first message).
function useLiveConnection(): LiveConnection {
  return {status: 'unknown', lastMessageAt: null};
}

const LIVE_PALETTE: Record<LiveStatus, {bg: string; text: string; dot: string}> =
  {
    connected: {
      bg: 'rgba(16, 185, 129, 0.1)',
      text: '#6ee7b7',
      dot: '#4ade80',
    },
    reconnecting: {
      bg: 'rgba(245, 158, 11, 0.1)',
      text: '#fcd34d',
      dot: '#fbbf24',
    },
    disconnected: {
      bg: 'rgba(244, 63, 94, 0.1)',
      text: '#fda4af',
      dot: '#fb7185',
    },
    unknown: {
      bg: 'rgba(255, 255, 255, 0.03)',
      text: colors.textMuted,
      dot: colors.textMuted,
    },
  };

// `variant="compact"` == a colored chip with a status dot + label (no timestamp).
function LiveIndicator({t}: {t: NativeTFunction}) {
  const {status} = useLiveConnection();
  const palette = LIVE_PALETTE[status];
  const label =
    status === 'connected'
      ? t('live.connected', 'Live')
      : status === 'reconnecting'
        ? t('live.reconnecting', 'Reconnecting\u2026')
        : status === 'disconnected'
          ? t('live.disconnected', 'Offline')
          : t('live.unknown', 'Unknown');
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.liveChip, {backgroundColor: palette.bg}]}>
      <View
        pointerEvents="none"
        style={[styles.liveDot, {backgroundColor: palette.dot}]}
      />
      <AppText style={[styles.liveLabel, {color: palette.text}]}>{label}</AppText>
    </View>
  );
}

LiveIndicator.displayName = 'LiveIndicator';

/* ─── AlertBanner (web `@/components/feedback` AlertBanner) ─────────────────── */

type AlertVariant = 'danger' | 'info' | 'warning' | 'success';

const ALERT_PALETTE: Record<
  AlertVariant,
  {bg: string; border: string; text: string}
> = {
  danger: {
    bg: 'rgba(248, 113, 113, 0.1)',
    border: 'rgba(248, 113, 113, 0.32)',
    text: '#fda4af',
  },
  info: {
    bg: 'rgba(34, 211, 238, 0.1)',
    border: 'rgba(34, 211, 238, 0.3)',
    text: '#a5f3fc',
  },
  success: {
    bg: 'rgba(74, 222, 128, 0.1)',
    border: 'rgba(74, 222, 128, 0.3)',
    text: '#bbf7d0',
  },
  warning: {
    bg: 'rgba(251, 191, 36, 0.1)',
    border: 'rgba(251, 191, 36, 0.3)',
    text: '#fde68a',
  },
};

function AlertBanner({
  variant = 'info',
  glyph,
  title,
  children,
  style,
}: {
  variant?: AlertVariant;
  glyph?: string;
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = ALERT_PALETTE[variant];
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.alertBanner,
        {backgroundColor: palette.bg, borderColor: palette.border},
        style,
      ]}>
      {glyph ? (
        <AppText style={[styles.alertGlyph, {color: palette.text}]}>
          {glyph}
        </AppText>
      ) : null}
      <View style={styles.alertBody}>
        {title ? (
          <AppText style={[styles.alertTitle, {color: palette.text}]} weight="semibold">
            {title}
          </AppText>
        ) : null}
        <AppText style={[styles.alertText, {color: palette.text}]}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

AlertBanner.displayName = 'AlertBanner';

/* ─── LiveStaleDataBanner (web `@/components/feedback`) ─────────────────────── */

const STALE_BANNER_THRESHOLD_MS = 2 * 60_000;

// Faithful port: shows a warning banner once the live pipe has been
// `disconnected` for >2min. Native live status is constant 'unknown', so this
// stays inert (returns null) — the same result the web shows on a healthy wire.
function LiveStaleDataBanner({t}: {t: NativeTFunction}) {
  const {status} = useLiveConnection();
  const disconnectedSinceRef = useRef<number | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === 'disconnected') {
      if (disconnectedSinceRef.current == null) {
        disconnectedSinceRef.current = Date.now();
      }
      const elapsed = Date.now() - disconnectedSinceRef.current;
      if (elapsed >= STALE_BANNER_THRESHOLD_MS) {
        setShow(true);
        return;
      }
      const timer = setTimeout(
        () => setShow(true),
        STALE_BANNER_THRESHOLD_MS - elapsed + 50,
      );
      return () => clearTimeout(timer);
    }
    disconnectedSinceRef.current = null;
    setShow(false);
    return undefined;
  }, [status]);

  if (!show) {
    return null;
  }

  return (
    <AlertBanner
      glyph={GLYPH.alertCircle}
      style={styles.sectionGap}
      title={t('live.staleBanner.title', 'Live data unavailable')}
      variant="warning">
      {t(
        'live.staleBanner.message',
        'The live data connection has been offline for more than 2 minutes. Values on this page may be stale until the connection is restored.',
      )}
    </AlertBanner>
  );
}

LiveStaleDataBanner.displayName = 'LiveStaleDataBanner';

/* ─── TimeStamp (web `@/components/data-display` TimeStamp) ─────────────────── */

function TimeStamp({value}: {value: string | Date | null | undefined}) {
  return (
    <AppText numberOfLines={1} style={styles.timeStamp} tone="muted">
      {formatDateTime(value)}
    </AppText>
  );
}

TimeStamp.displayName = 'TimeStamp';

/* ─── PanelTitle (web inline `<span class="font-semibold"><Icon/>…</span>`) ─── */

function PanelTitle({
  glyph,
  glyphColor,
  children,
  large,
  right,
}: {
  glyph: string;
  glyphColor?: string;
  children: string;
  large?: boolean;
  right?: ReactNode;
}) {
  return (
    <View style={styles.panelTitleRow}>
      <View style={styles.panelTitleLeft}>
        <AppText style={[styles.panelGlyph, glyphColor ? {color: glyphColor} : null]}>
          {glyph}
        </AppText>
        <AppText style={large ? styles.panelTitleLg : styles.panelTitle} weight="semibold">
          {children}
        </AppText>
      </View>
      {right ?? null}
    </View>
  );
}

PanelTitle.displayName = 'PanelTitle';

/* ─── MetricCard (web `@/components/data-display` MetricCard) ───────────────── */

type MetricColor = 'cyan' | 'purple' | 'green' | 'amber';

const METRIC_GLYPH_COLOR: Record<MetricColor, string> = {
  amber: '#fbbf24',
  cyan: '#22d3ee',
  green: '#4ade80',
  purple: '#c084fc',
};

// The web MetricCard {label,value,icon,color} maps onto the native parity
// StatCard, with the web NeonColor driving the colour of the decorative glyph.
function MetricCard({
  label,
  value,
  glyph,
  color,
}: {
  label: string;
  value: string;
  glyph: string;
  color: MetricColor;
}) {
  return (
    <StatCard
      icon={
        <AppText style={[styles.metricGlyph, {color: METRIC_GLYPH_COLOR[color]}]}>
          {glyph}
        </AppText>
      }
      label={label}
      style={styles.metricCard}
      value={value}
    />
  );
}

MetricCard.displayName = 'MetricCard';

/* ─── Pagination (web `@/components/ui` DataTable pager) ────────────────────── */

function Pagination({
  page,
  totalPages,
  onPageChange,
  t,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  t: NativeTFunction;
}) {
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;
  return (
    <View style={styles.pagination}>
      <Pressable
        accessibilityLabel={t('common.pagination.prev', 'Previous page')}
        accessibilityRole="button"
        accessibilityState={{disabled: !canPrev}}
        disabled={!canPrev}
        onPress={() => onPageChange(page - 1)}
        style={({pressed}) => [
          styles.pageButton,
          !canPrev && styles.pageButtonDisabled,
          pressed && canPrev && styles.pressed,
        ]}>
        <AppText tone={canPrev ? 'primary' : 'muted'}>{'\u2039'}</AppText>
      </Pressable>
      <AppText style={styles.pageLabel} tone="muted" variant="caption">
        {t('common.pagination.pageOf', 'Page {{page}} of {{total}}', {
          page: page + 1,
          total: totalPages,
        })}
      </AppText>
      <Pressable
        accessibilityLabel={t('common.pagination.next', 'Next page')}
        accessibilityRole="button"
        accessibilityState={{disabled: !canNext}}
        disabled={!canNext}
        onPress={() => onPageChange(page + 1)}
        style={({pressed}) => [
          styles.pageButton,
          !canNext && styles.pageButtonDisabled,
          pressed && canNext && styles.pressed,
        ]}>
        <AppText tone={canNext ? 'primary' : 'muted'}>{'\u203A'}</AppText>
      </Pressable>
    </View>
  );
}

Pagination.displayName = 'Pagination';

/* ─── NativeSelect (web `@/components/forms` VehicleSelect picker) ──────────── */

interface NativeSelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={styles.select}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : FALLBACK}
        </AppText>
        <AppText style={styles.selectChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectList}>
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                  pressed && styles.pressed,
                ]}>
                <AppText numberOfLines={1} tone={isSelected ? 'accent' : 'primary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

/* ─── NativeDataTable (web `@/components/ui` DataTable) ─────────────────────── */

type RowKey = string | number;

interface NativeColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

const DATA_TABLE_PAGE_SIZE = 25; // web DataTable defaultPageSize

function NativeDataTable<T>({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  accessibilityLabel,
  t,
}: {
  columns: NativeColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => RowKey;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  accessibilityLabel: string;
  t: NativeTFunction;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(data.length / DATA_TABLE_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * DATA_TABLE_PAGE_SIZE;
  const pageRows = data.slice(start, start + DATA_TABLE_PAGE_SIZE);

  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.tableRoot}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.tableHeaderRow}>
            {columns.map(col => {
              const active = sortKey === col.key;
              const cell = (
                <View style={styles.tableHeaderCell}>
                  <AppText
                    numberOfLines={1}
                    style={styles.tableHeaderText}
                    tone="muted"
                    variant="caption">
                    {col.header}
                  </AppText>
                  {col.sortable && active ? (
                    <AppText style={styles.tableSortArrow} tone="muted" variant="caption">
                      {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
                    </AppText>
                  ) : null}
                </View>
              );
              if (col.sortable && onSort) {
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{selected: active}}
                    key={col.key}
                    onPress={() => onSort(col.key)}
                    style={({pressed}) => [pressed && styles.pressed]}>
                    {cell}
                  </Pressable>
                );
              }
              return <View key={col.key}>{cell}</View>;
            })}
          </View>
          {pageRows.map(row => (
            <View key={String(keyExtractor(row))} style={styles.tableRow}>
              {columns.map(col => (
                <View key={col.key} style={styles.tableCell}>
                  {col.render(row)}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {totalPages > 1 ? (
        <Pagination
          onPageChange={setPage}
          page={clampedPage}
          t={t}
          totalPages={totalPages}
        />
      ) : null}
    </View>
  );
}

NativeDataTable.displayName = 'NativeDataTable';

/* ─── NativeSeriesChart (web `@/components/charts` Area/Line charts) ────────── */

interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

type ChartRow = Record<string, string | number | undefined>;

const CHART_BAR_WIDTH = 12;
const CHART_BAR_GAP = 4;

function toChartNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function NativeSeriesChart({
  data,
  xKey,
  series,
  height,
  accessibilityLabel,
  perSeriesScale,
  fixedDomain,
  yTicks,
  xTickFormatter,
}: {
  data: ReadonlyArray<ChartRow>;
  xKey: string;
  series: ReadonlyArray<ChartSeries>;
  height: number;
  accessibilityLabel: string;
  perSeriesScale?: boolean;
  fixedDomain?: {min: number; max: number};
  yTicks?: ReadonlyArray<string>;
  xTickFormatter?: (value: string) => string;
}) {
  if (data.length === 0) {
    return null;
  }

  // Per-series scale keeps the dual-axis intent (each series auto-scaled to its
  // own max). A fixed domain pins all series to a shared [min,max] (presence 0/1).
  const scaleFor = (seriesKey: string): {lo: number; hi: number} => {
    if (perSeriesScale) {
      const max = data.reduce((m, r) => Math.max(m, toChartNumber(r[seriesKey])), 0);
      return {lo: 0, hi: max > 0 ? max : 1};
    }
    const lo = fixedDomain?.min ?? 0;
    const dataMax = data.reduce(
      (m, r) => Math.max(m, ...series.map(s => toChartNumber(r[s.key]))),
      0,
    );
    const hi = fixedDomain?.max ?? (dataMax > 0 ? dataMax : 1);
    return {lo, hi};
  };

  const columnWidth = Math.max(
    44,
    series.length * CHART_BAR_WIDTH + (series.length - 1) * CHART_BAR_GAP + 16,
  );

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={styles.chartRoot}>
      <View style={styles.chartFrame}>
        {yTicks && yTicks.length > 0 ? (
          <View style={[styles.chartYAxis, {height}]}>
            {yTicks.map((tick, index) => (
              <AppText
                key={`${tick}-${index}`}
                numberOfLines={1}
                style={styles.chartAxisLabel}
                tone="muted"
                variant="caption">
                {tick}
              </AppText>
            ))}
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.chartScrollContent}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {data.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.chartColumn, {width: columnWidth}]}>
              <View style={[styles.chartTrack, {height}]}>
                <View style={styles.chartGroup}>
                  {series.map(s => {
                    const {lo, hi} = scaleFor(s.key);
                    const span = hi - lo > 0 ? hi - lo : 1;
                    const value = toChartNumber(row[s.key]);
                    const ratio = (value - lo) / span;
                    const pct =
                      value > lo ? Math.max(Math.min(ratio, 1) * 100, 3) : 0;
                    return (
                      <View
                        key={s.key}
                        pointerEvents="none"
                        style={[
                          styles.chartBar,
                          {
                            backgroundColor: s.color,
                            height: `${pct}%` as DimensionValue,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              </View>
              <AppText
                numberOfLines={1}
                style={styles.chartXLabel}
                tone="muted"
                variant="caption">
                {xTickFormatter
                  ? xTickFormatter(String(row[xKey] ?? ''))
                  : String(row[xKey] ?? '')}
              </AppText>
            </View>
          ))}
        </ScrollView>
      </View>
      <View style={styles.chartLegend}>
        {series.map(s => (
          <View key={s.key} style={styles.chartLegendItem}>
            <View
              pointerEvents="none"
              style={[styles.chartLegendDot, {backgroundColor: s.color}]}
            />
            <AppText tone="muted" variant="caption">
              {s.label}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

NativeSeriesChart.displayName = 'NativeSeriesChart';

/* ─── Types (web local interfaces) ─────────────────────────────────────────── */

// LocationSnapshot is imported from the native parity useVehicles hook (it is the
// verbatim port of the web page's local LocationSnapshot interface).

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

interface Waypoint {
  name: string;
  type: 'supercharger' | 'destination' | 'waypoint';
  distance: number;
}

/* ─── Helper: heading label (web `headingToCardinal`, ported verbatim) ─────── */

function headingToCardinal(deg: number | null | undefined): string {
  if (deg == null) {
    return FALLBACK;
  }
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8] ?? FALLBACK;
}

/* ─── Helper: buildWaypoints (web module helper, ported verbatim) ──────────── */

function buildWaypoints(latest: LocationSnapshot): Waypoint[] {
  const destName = latest.destination_name;
  if (!destName) {
    return [];
  }
  return [
    {
      name: destName,
      type: 'destination',
      distance: latest.miles_to_arrival ?? 0,
    },
  ];
}

/* ─── LocationStatusCard (web sub-component) ────────────────────────────────── */

function LocationStatusCard({
  glyph,
  label,
  value,
  active,
}: {
  glyph: string;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <GlassPanel
      glow={active ? 'green' : 'none'}
      hover={active}
      style={[styles.statusCard, active && styles.statusCardActive]}>
      <View
        style={[
          styles.statusIcon,
          active ? styles.statusIconActive : styles.statusIconInactive,
        ]}>
        <AppText style={[styles.statusGlyph, active ? styles.statusGlyphActive : null]}>
          {glyph}
        </AppText>
      </View>
      <View style={styles.statusBody}>
        <AppText style={styles.statusLabel} tone="muted" variant="caption">
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.statusValue} weight="semibold">
          {value}
        </AppText>
      </View>
      <Badge size="sm" variant={active ? 'success' : 'neutral'}>
        {active ? CHECK : FALLBACK}
      </Badge>
    </GlassPanel>
  );
}

LocationStatusCard.displayName = 'LocationStatusCard';

/* ─── TrafficDelayBadge (web sub-component) ─────────────────────────────────── */

function TrafficDelayBadge({
  seconds,
  t,
}: {
  seconds: number;
  t: NativeTFunction;
}) {
  const {formatDuration} = useUnits();
  const variant: 'success' | 'warning' | 'danger' =
    seconds < 300 ? 'success' : seconds <= 900 ? 'warning' : 'danger';
  return (
    <Badge dot size="sm" variant={variant}>
      {`${formatDuration(seconds)} ${t('nav.delay', 'delay')}`}
    </Badge>
  );
}

TrafficDelayBadge.displayName = 'TrafficDelayBadge';

/* ════════════════════════════════════════════════════════════════════════════
 *  Main Page
 * ════════════════════════════════════════════════════════════════════════════ */

export default function NavigationRoutePage() {
  const t = useNativeTranslation();
  usePageTitle(t('nav.pageTitle', 'Navigation & Route'));
  /* SI-floor display.
     /location-snapshots emits speed_mph (m/s SI alias) and miles_to_arrival
     (meters SI) — the legacy field names are kept for backward compat but
     values are SI canonical. */
  const {unitPrefs, formatDuration} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  /* ---- vehicle selector — header VehiclePicker is the source of truth ---- */
  const {
    data: vehiclesData,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const vehicles = vehiclesData ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (selectedVehicleId == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [selectedVehicleId, firstVehicleId]);
  const vehicleId = selectedVehicleId ?? firstVehicleId;

  /* ---- latest snapshot ---- */
  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
    refetch: refetchLatest,
  } = useQuery<LocationSnapshot>({
    queryKey: ['location-latest', vehicleId],
    queryFn: () =>
      request<LocationSnapshot>(
        `/location-snapshots/latest?vehicle_id=${vehicleId}`,
      ),
    enabled: vehicleId !== null,
    refetchInterval: 15_000,
  });

  /* ---- history ---- */
  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery<LocationSnapshot[]>({
    queryKey: ['location-history', vehicleId],
    queryFn: () =>
      request<LocationSnapshot[]>(
        `/location-snapshots?vehicle_id=${vehicleId}&limit=200`,
      ),
    enabled: vehicleId !== null,
  });

  /* ---- charging telemetry (for expected energy at arrival) ---- */
  const {data: chargingTelemetry} = useChargingTelemetryLatest(
    vehicleId ?? 0,
    15_000,
  );

  /* ---- derived ---- */
  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = vehiclesLoading || latestLoading;
  const hasActiveRoute = latest?.destination_name != null;
  const lat = latest?.latitude ?? null;
  const lon = latest?.longitude ?? null;
  const hasValidLocation =
    lat != null &&
    lon != null &&
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    (lat !== 0 || lon !== 0);

  const waypoints = useMemo(
    () => (latest ? buildWaypoints(latest) : []),
    [latest],
  );

  const chartData = useMemo(
    () =>
      [...(history ?? [])]
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        .map(s => ({
          time: formatDateTime(s.created_at),
          /* speed_mph is m/s SI; convert to user pref for chart axis. */
          speed: convertSpeedFromSI(s.speed_mph ?? 0, speedUnit),
          /* miles_to_arrival is meters SI; convert to user pref. */
          miles: convertDistanceFromSI(s.miles_to_arrival ?? 0, distanceUnit),
        })),
    [history, speedUnit, distanceUnit],
  );

  /* ---- avg speed (display units) ---- */
  const avgSpeed = useMemo(() => {
    if (!history?.length) {
      return 0;
    }
    /* speed_mph is m/s SI; average in SI then convert at the boundary. */
    const speedsMps = history
      .map(s => s.speed_mph)
      .filter((v): v is number => v != null && v > 0);
    if (!speedsMps.length) {
      return 0;
    }
    const avgMps = speedsMps.reduce((a, b) => a + b, 0) / speedsMps.length;
    return convertSpeedFromSI(avgMps, speedUnit);
  }, [history, speedUnit]);

  /* ---- recent destinations (unique, from history with active routes) ---- */
  const recentDestinations = useMemo(() => {
    if (!history?.length) {
      return [];
    }
    const seen = new Set<string>();
    const result: {
      time: string;
      destination: string;
      distance: number;
      eta: number;
    }[] = [];
    for (const s of history) {
      const name = s.destination_name;
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      result.push({
        time: formatDateTime(s.created_at),
        destination: name,
        /* miles_to_arrival is meters SI; convert to user pref. */
        distance: convertDistanceFromSI(s.miles_to_arrival ?? 0, distanceUnit),
        eta: s.minutes_to_arrival ?? 0,
      });
    }
    return result.slice(0, 20);
  }, [history, distanceUnit]);

  /* ---- presence chart (home / work over time) ---- */
  const presenceChartData = useMemo(() => {
    if (!history?.length) {
      return [];
    }
    return [...history]
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      .map(s => ({
        time: formatDateTime(s.created_at),
        home: s.located_at_home ? 1 : 0,
        work: s.located_at_work ? 1 : 0,
        homelink: s.homelink_nearby ? 1 : 0,
      }));
  }, [history]);

  /* ---- destination table columns ---- */
  const destColumns: NativeColumn<(typeof recentDestinations)[number]>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('nav.col.time', 'Time'),
        render: row => (
          <AppText numberOfLines={1} style={styles.cellMuted} tone="muted" variant="caption">
            {row.time}
          </AppText>
        ),
      },
      {
        key: 'destination',
        header: t('nav.col.destination', 'Destination'),
        render: row => <AppText style={styles.cellPrimary}>{row.destination}</AppText>,
      },
      {
        key: 'distance',
        header: t('nav.col.distance', 'Distance'),
        render: row => (
          <AppText style={styles.cellMuted} tone="muted" variant="caption">
            {`${fmtNumber(row.distance, 1)} ${distanceUnit}`}
          </AppText>
        ),
      },
      {
        key: 'eta',
        header: t('nav.col.eta', 'ETA'),
        render: row => (
          <AppText style={styles.cellMuted} tone="muted" variant="caption">
            {`${fmtNumber(row.eta, 0)} min`}
          </AppText>
        ),
      },
    ],
    [t, distanceUnit],
  );

  /* ---- table columns ---- */
  const historyColumns: NativeColumn<LocationSnapshot>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('nav.col.time', 'Time'),
        sortable: true,
        render: row => <TimeStamp value={row.created_at} />,
      },
      {
        key: 'latitude',
        header: t('nav.col.lat', 'Lat'),
        sortable: true,
        render: row => (
          <AppText style={styles.cellMono}>
            {row.latitude != null && row.latitude !== 0
              ? fmtNumber(row.latitude, 6)
              : FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'longitude',
        header: t('nav.col.lon', 'Lon'),
        sortable: true,
        render: row => (
          <AppText style={styles.cellMono}>
            {row.longitude != null && row.longitude !== 0
              ? fmtNumber(row.longitude, 6)
              : FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'located_at_home',
        header: t('nav.col.home', 'Home'),
        sortable: true,
        render: row => (
          <AppText style={row.located_at_home ? styles.cellGreen : styles.cellMuted}>
            {row.located_at_home === true
              ? 'Yes'
              : row.located_at_home === false
                ? 'No'
                : FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'located_at_work',
        header: t('nav.col.work', 'Work'),
        sortable: true,
        render: row => (
          <AppText style={row.located_at_work ? styles.cellBlue : styles.cellMuted}>
            {row.located_at_work === true
              ? 'Yes'
              : row.located_at_work === false
                ? 'No'
                : FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'destination_name',
        header: t('nav.col.destination', 'Destination'),
        sortable: true,
        render: row => (
          <AppText numberOfLines={1} style={styles.cellDestination}>
            {row.destination_name ?? FALLBACK}
          </AppText>
        ),
      },
    ],
    [t],
  );

  /* ---- waypoint columns ---- */
  const waypointColumns: NativeColumn<Waypoint>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('nav.wp.name', 'Name'),
        render: row => (
          <View style={styles.waypointName}>
            <AppText
              style={[
                styles.waypointGlyph,
                {
                  color:
                    row.type === 'supercharger'
                      ? RED_400
                      : row.type === 'destination'
                        ? NEON_CYAN
                        : AMBER_400,
                },
              ]}>
              {row.type === 'supercharger'
                ? GLYPH.zap
                : row.type === 'destination'
                  ? GLYPH.pin
                  : GLYPH.route}
            </AppText>
            <AppText style={styles.cellPrimary}>{row.name}</AppText>
          </View>
        ),
      },
      {
        key: 'type',
        header: t('nav.wp.type', 'Type'),
        render: row => (
          <Badge
            size="sm"
            variant={
              row.type === 'supercharger'
                ? 'danger'
                : row.type === 'destination'
                  ? 'info'
                  : 'neutral'
            }>
            {row.type}
          </Badge>
        ),
      },
      {
        key: 'distance',
        header: t('nav.wp.distance', 'Distance'),
        render: row => (
          <AppText style={styles.cellMono} tone="muted">
            {/* row.distance is meters SI from buildWaypoints; convert to user pref. */}
            {`${fmtNumber(convertDistanceFromSI(row.distance, distanceUnit), 1)} ${distanceUnit}`}
          </AppText>
        ),
      },
    ],
    [t, distanceUnit],
  );

  /* ---- sort state ---- */
  const [sortKey, setSortKey] = useState('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey],
  );

  const sortedHistory = useMemo(() => {
    const data = [...(history ?? [])];
    const accessor = (row: LocationSnapshot, key: string): number | string => {
      switch (key) {
        case 'time':
          return row.created_at;
        case 'latitude':
          return row.latitude ?? 0;
        case 'longitude':
          return row.longitude ?? 0;
        case 'located_at_home':
          return row.located_at_home ? 1 : 0;
        case 'located_at_work':
          return row.located_at_work ? 1 : 0;
        case 'destination_name':
          return row.destination_name ?? '';
        default:
          return '';
      }
    };
    data.sort((a, b) => {
      const aV = accessor(a, sortKey);
      const bV = accessor(b, sortKey);
      const cmp = aV < bV ? -1 : aV > bV ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [history, sortKey, sortDir]);

  /* ---- refresh handler ---- */
  const handleRefresh = useCallback(() => {
    void refetchLatest();
    void refetchHistory();
  }, [refetchLatest, refetchHistory]);

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    label: v.display_name || v.vin || `#${v.id}`,
    value: String(v.id),
  }));

  const gpsFix = normalizeGpsState(latest?.gps_state);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="maps-navigation-route">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('nav.pageTitle', 'Navigation & Route')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t('nav.subtitle', 'Live location tracking and navigation status')}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedVehicleId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
          />
          <LiveIndicator t={t} />
          <Button
            icon={<AppText style={styles.buttonGlyph}>{GLYPH.refresh}</AppText>}
            onPress={handleRefresh}
            size="sm"
            variant="ghost">
            {t('nav.refresh', 'Refresh')}
          </Button>
        </View>
      </View>

      <ErrorBoundary name="navigation-route-page">
        <View style={styles.stack}>
          <LiveStaleDataBanner t={t} />

          {anyError ? (
            <AlertBanner glyph={GLYPH.alertCircle} style={styles.sectionGap} variant="danger">
              {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
            </AlertBanner>
          ) : null}

          {isLoading && !latest ? (
            <View style={styles.loading}>
              <Skeleton lines={4} />
            </View>
          ) : null}

          {vehicleId !== null ? (
            <FadeIn style={styles.stack}>
              {/* ─────── Navigation Status Panel ─────── */}
              <GlassPanel
                glow={hasActiveRoute ? 'cyan' : 'none'}
                hover={hasActiveRoute}
                style={styles.panel}>
                <PanelTitle
                  glyph={GLYPH.navigation}
                  large
                  right={
                    <Badge
                      dot
                      size="md"
                      variant={hasActiveRoute ? 'success' : 'neutral'}>
                      {hasActiveRoute
                        ? t('nav.active', 'Active')
                        : t('nav.inactive', 'Inactive')}
                    </Badge>
                  }>
                  {t('nav.status', 'Navigation Status')}
                </PanelTitle>

                <View style={styles.routeUpdatedRow}>
                  <AppText style={styles.routeUpdatedGlyph} tone="muted" variant="caption">
                    {GLYPH.refresh}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {`${t('nav.routeLastUpdated', 'Route last updated')}: `}
                  </AppText>
                  <AppText style={styles.routeUpdatedValue} tone="secondary" variant="caption">
                    {latest?.route_last_updated
                      ? formatDateTime(latest.route_last_updated)
                      : FALLBACK}
                  </AppText>
                </View>

                {latestLoading ? (
                  <Skeleton lines={4} />
                ) : latest && hasActiveRoute ? (
                  <View style={styles.navGrid}>
                    <View style={styles.navGridItem}>
                      <AppText style={styles.navGridLabel} tone="muted" variant="caption">
                        {t('nav.destination', 'Destination')}
                      </AppText>
                      <AppText style={styles.navGridValue} weight="semibold">
                        {latest.destination_name ?? FALLBACK}
                      </AppText>
                    </View>
                    <View style={styles.navGridItem}>
                      <AppText style={styles.navGridLabel} tone="muted" variant="caption">
                        {t('nav.eta', 'ETA')}
                      </AppText>
                      <AppText style={styles.navGridValue} weight="semibold">
                        {`${fmtNumber(latest.minutes_to_arrival ?? 0, 0)} ${t('nav.minutes', 'min')}`}
                      </AppText>
                    </View>
                    <View style={styles.navGridItem}>
                      <AppText style={styles.navGridLabel} tone="muted" variant="caption">
                        {t('nav.distanceRemaining', 'Distance Remaining')}
                      </AppText>
                      <AppText style={styles.navGridValue} weight="semibold">
                        {/* miles_to_arrival is meters SI; convert to user pref. */}
                        {`${fmtNumber(convertDistanceFromSI(latest.miles_to_arrival ?? 0, distanceUnit), 1)} ${distanceUnit}`}
                      </AppText>
                    </View>
                    <View style={styles.navGridItem}>
                      <AppText style={styles.navGridLabel} tone="muted" variant="caption">
                        {t('nav.trafficDelay', 'Traffic Delay')}
                      </AppText>
                      <TrafficDelayBadge
                        seconds={latest.route_traffic_delay_s ?? 0}
                        t={t}
                      />
                    </View>
                  </View>
                ) : (
                  <EmptyState
                    message={t(
                      'nav.noActiveNav',
                      'No active navigation. Start a route in your vehicle to see details here.',
                    )}
                    title={t('nav.status', 'Navigation Status')}
                  />
                )}
              </GlassPanel>

              {/* ─────── GPS Warning Banner ─────── */}
              {!hasValidLocation && latest ? (
              <AlertBanner style={styles.sectionGap} variant="info">
                  {t(
                    'nav.noGps',
                    'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.',
                  )}
                </AlertBanner>
              ) : null}

              {/* ─────── Location Status Cards ─────── */}
              <FadeIn delay={0.1}>
                <View style={styles.cardGrid}>
                  <LocationStatusCard
                    active={hasValidLocation}
                    glyph={GLYPH.pin}
                    label={t('nav.currentLocation', 'Current Location')}
                    value={
                      hasValidLocation
                        ? `${fmtNumber(lat!, 4)}, ${fmtNumber(lon!, 4)}`
                        : t('nav.locationUnavailable', 'Location unavailable')
                    }
                  />
                  <LocationStatusCard
                    active={gpsFix === 'locked'}
                    glyph={GLYPH.satellite}
                    label={t('nav.gpsFixQuality', 'GPS Fix Quality')}
                    value={t(`nav.gpsState.${gpsFix}`, {defaultValue: gpsFix})}
                  />
                  <LocationStatusCard
                    active={latest?.heading != null}
                    glyph={GLYPH.compass}
                    label={t('nav.heading', 'Heading')}
                    value={
                      latest?.heading != null
                        ? t('nav.headingValue', {
                            defaultValue: `{{cardinal}} ({{degrees}}${DEGREE})`,
                            cardinal: headingToCardinal(latest.heading),
                            degrees: Math.round(latest.heading),
                          })
                        : t('nav.unknown', 'Unknown')
                    }
                  />
                  <LocationStatusCard
                    active={latest?.located_at_home === true}
                    glyph={GLYPH.home}
                    label={t('nav.homeStatus', 'Home Status')}
                    value={
                      latest?.located_at_home === true
                        ? t('nav.atHome', 'At Home')
                        : latest?.located_at_home === false
                          ? latest?.homelink_nearby
                            ? t('nav.homelinkNearby', 'HomeLink Nearby')
                            : t('nav.awayFromHome', 'Away')
                          : t('nav.unknown', 'Unknown')
                    }
                  />
                  <LocationStatusCard
                    active={latest?.located_at_work === true}
                    glyph={GLYPH.briefcase}
                    label={t('nav.workStatus', 'Work Status')}
                    value={
                      latest?.located_at_work === true
                        ? t('nav.atWork', 'At Work')
                        : latest?.located_at_work === false
                          ? t('nav.notAtWork', 'Away')
                          : t('nav.unknown', 'Unknown')
                    }
                  />
                </View>
              </FadeIn>

              {/* ─────── Route Metrics ─────── */}
              <FadeIn delay={0.15}>
                <View style={styles.cardGrid}>
                  <MetricCard
                    color="cyan"
                    glyph={GLYPH.route}
                    label={t('nav.metric.distance', 'Distance')}
                    value={
                      hasActiveRoute
                        ? `${fmtNumber(convertDistanceFromSI(latest?.miles_to_arrival ?? 0, distanceUnit), 1)} ${distanceUnit}`
                        : FALLBACK
                    }
                  />
                  <MetricCard
                    color="purple"
                    glyph={GLYPH.clock}
                    label={t('nav.metric.eta', 'ETA')}
                    value={
                      hasActiveRoute
                        ? `${fmtNumber(latest?.minutes_to_arrival ?? 0, 0)} min`
                        : FALLBACK
                    }
                  />
                  <MetricCard
                    color="green"
                    glyph={GLYPH.battery}
                    label={t('nav.metric.trafficDelay', 'Traffic Delay')}
                    value={
                      hasActiveRoute
                        ? formatDuration(latest?.route_traffic_delay_s ?? 0)
                        : FALLBACK
                    }
                  />
                  <MetricCard
                    color="amber"
                    glyph={GLYPH.gauge}
                    label={t('nav.metric.avgSpeed', 'Avg Speed')}
                    value={`${fmtNumber(avgSpeed, 1)} ${speedUnit}`}
                  />
                  <MetricCard
                    color="green"
                    glyph={GLYPH.battery}
                    label={t('nav.metric.energyAtArrival', 'Energy at Arrival')}
                    value={
                      chargingTelemetry?.expected_energy_pct_at_arrival != null
                        ? `${fmtNumber(chargingTelemetry.expected_energy_pct_at_arrival, 0)}%`
                        : FALLBACK
                    }
                  />
                </View>
              </FadeIn>

              {/* ─────── Speed / Elevation Profile Chart ─────── */}
              <FadeIn delay={0.2}>
                <GlassPanel style={styles.panel}>
                  <PanelTitle glyph={GLYPH.gauge}>
                    {t('nav.speedProfile', 'Speed Profile')}
                  </PanelTitle>
                  {historyLoading ? (
                    <Skeleton height={260} />
                  ) : chartData.length === 0 ? (
                    <EmptyState
                      message={t(
                        'nav.noHistory',
                        'No location history available for this vehicle.',
                      )}
                      title={t('nav.speedProfile', 'Speed Profile')}
                    />
                  ) : (
                    <NativeSeriesChart
                      accessibilityLabel={t('nav.speedProfile', 'Speed Profile')}
                      data={chartData}
                      height={260}
                      perSeriesScale
                      series={[
                        {
                          color: CHART_COLORS[0],
                          key: 'speed',
                          label: t('nav.legendSpeedV2', {
                            defaultValue: 'Speed ({{unit}})',
                            unit: speedUnit,
                          }),
                        },
                        {
                          color: CHART_COLORS[1],
                          key: 'miles',
                          label: t('nav.legendDistanceToArrivalV2', {
                            defaultValue: 'Distance to Arrival ({{unit}})',
                            unit: distanceUnit,
                          }),
                        },
                      ]}
                      xKey="time"
                      xTickFormatter={v => v.split(',').pop()?.trim() ?? v}
                    />
                  )}
                </GlassPanel>
              </FadeIn>

              {/* ─────── Waypoints / Supercharger List ─────── */}
              <FadeIn delay={0.25}>
                {hasActiveRoute ? (
                  <GlassPanel style={styles.panel}>
                    <PanelTitle glyph={GLYPH.zap}>
                      {t('nav.waypoints', 'Route Waypoints')}
                    </PanelTitle>
                    {waypoints.length > 0 ? (
                      <NativeDataTable
                        accessibilityLabel={t('nav.waypoints', 'Route Waypoints')}
                        columns={waypointColumns}
                        data={waypoints}
                        keyExtractor={wp => `${wp.name}-${wp.distance}`}
                        t={t}
                      />
                    ) : (
                      <EmptyState
                        message={t('common.noData', 'No data available')}
                        title={t('nav.waypoints', 'Route Waypoints')}
                      />
                    )}
                  </GlassPanel>
                ) : (
                  <EmptyState
                    message={t('navigation.noRoute', 'No active route selected')}
                    title={t('nav.waypoints', 'Route Waypoints')}
                  />
                )}
              </FadeIn>

              {/* ─────── Route Traffic Delay ─────── */}
              <FadeIn delay={0.22}>
                <GlassPanel style={styles.panel}>
                  <PanelTitle glyph={GLYPH.trafficCone} glyphColor={AMBER_400}>
                    {t('nav.trafficDelay', 'Route Traffic Delay')}
                  </PanelTitle>
                  {latestLoading ? (
                    <Skeleton height={64} />
                  ) : (
                    <View style={styles.trafficRow}>
                      <AppText
                        style={[
                          styles.trafficValue,
                          {
                            color:
                              (latest?.route_traffic_delay_s ?? 0) === 0
                                ? EMERALD_400
                                : (latest?.route_traffic_delay_s ?? 0) <= 300
                                  ? AMBER_400
                                  : RED_400,
                          },
                        ]}
                        weight="bold">
                        {formatDuration(latest?.route_traffic_delay_s ?? 0)}
                      </AppText>
                      <TrafficDelayBadge
                        seconds={latest?.route_traffic_delay_s ?? 0}
                        t={t}
                      />
                    </View>
                  )}
                </GlassPanel>
              </FadeIn>

              {/* ─────── Recent Destinations ─────── */}
              <FadeIn delay={0.25}>
                <GlassPanel style={styles.panel}>
                  <PanelTitle glyph={GLYPH.clock} glyphColor={CYAN_400}>
                    {t('nav.recentDestinations', 'Recent Destinations')}
                  </PanelTitle>
                  {historyLoading ? (
                    <Skeleton lines={6} />
                  ) : recentDestinations.length === 0 ? (
                    <EmptyState
                      message={t('nav.noDestinations', 'No destination history available.')}
                      title={t('nav.recentDestinations', 'Recent Destinations')}
                    />
                  ) : (
                    <NativeDataTable
                      accessibilityLabel={t('nav.recentDestinations', 'Recent Destinations')}
                      columns={destColumns}
                      data={recentDestinations}
                      keyExtractor={row => `${row.time}-${row.destination}`}
                      t={t}
                    />
                  )}
                </GlassPanel>
              </FadeIn>

              {/* ─────── Home / Work Presence Chart ─────── */}
              <FadeIn delay={0.28}>
                <GlassPanel style={styles.panel}>
                  <PanelTitle glyph={GLYPH.trendingUp} glyphColor={CYAN_400}>
                    {t('nav.presenceChart', 'Home / Work Presence')}
                  </PanelTitle>
                  {historyLoading ? (
                    <Skeleton height={300} />
                  ) : presenceChartData.length === 0 ? (
                    <EmptyState
                      message={t('nav.noPresence', 'No presence history available.')}
                      title={t('nav.presenceChart', 'Home / Work Presence')}
                    />
                  ) : (
                    <NativeSeriesChart
                      accessibilityLabel={t('nav.presenceChart', 'Home / Work Presence')}
                      data={presenceChartData}
                      fixedDomain={{max: 1, min: 0}}
                      height={300}
                      series={[
                        {
                          color: CHART_COLORS[1],
                          key: 'home',
                          label: t('nav.atHome', 'At Home'),
                        },
                        {
                          color: CHART_COLORS[3],
                          key: 'work',
                          label: t('nav.atWork', 'At Work'),
                        },
                        {
                          color: CHART_COLORS[4],
                          key: 'homelink',
                          label: t('nav.homelinkNearby', 'HomeLink'),
                        },
                      ]}
                      xKey="time"
                      yTicks={['Yes', 'No']}
                    />
                  )}
                </GlassPanel>
              </FadeIn>

              {/* ─────── Location History Table ─────── */}
              <FadeIn delay={0.3}>
                <GlassPanel style={styles.panelLast}>
                  <PanelTitle glyph={GLYPH.compass}>
                    {t('nav.locationHistory', 'Location History')}
                  </PanelTitle>
                  {historyLoading ? (
                    <Skeleton lines={8} />
                  ) : !sortedHistory.length ? (
                    <EmptyState
                      message={t('nav.noSnapshots', 'No location snapshots recorded yet.')}
                      title={t('nav.locationHistory', 'Location History')}
                    />
                  ) : (
                    <NativeDataTable
                      accessibilityLabel={t('nav.locationHistory', 'Location History')}
                      columns={historyColumns}
                      data={sortedHistory}
                      keyExtractor={row => row.id}
                      onSort={handleSort}
                      sortDir={sortDir}
                      sortKey={sortKey}
                      t={t}
                    />
                  )}
                </GlassPanel>
              </FadeIn>
            </FadeIn>
          ) : null}
        </View>
      </ErrorBoundary>
    </ScrollView>
  );
}

const SUCCESS_BORDER = 'rgba(52, 211, 153, 0.4)';
const SUBTLE_BORDER = 'rgba(255, 255, 255, 0.06)';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  alertBanner: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertBody: {
    flex: 1,
    gap: 2,
  },
  alertGlyph: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 1,
  },
  alertText: {
    fontSize: 13,
    lineHeight: 18,
  },
  alertTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
  },
  badgeDot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  badgeLg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  badgeMd: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeTextLg: {
    fontSize: 14,
  },
  badgeTextMd: {
    fontSize: 12,
  },
  badgeTextSm: {
    fontSize: 11,
  },
  buttonGlyph: {
    fontSize: 13,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cellBlue: {
    color: BLUE_400,
    fontSize: 13,
  },
  cellDestination: {
    color: colors.textPrimary,
    fontSize: 13,
    maxWidth: 150,
  },
  cellGreen: {
    color: EMERALD_400,
    fontSize: 13,
  },
  cellMono: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  cellMuted: {
    fontSize: 12,
  },
  cellPrimary: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  chartAxisLabel: {
    textAlign: 'right',
  },
  chartBar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    minHeight: 2,
    width: CHART_BAR_WIDTH,
  },
  chartColumn: {
    alignItems: 'center',
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chartGroup: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: CHART_BAR_GAP,
    height: '100%',
  },
  chartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  chartLegendDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  chartLegendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chartRoot: {
    gap: spacing.xs,
  },
  chartScrollContent: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xs,
  },
  chartTrack: {
    justifyContent: 'flex-end',
  },
  chartXLabel: {
    marginTop: spacing.xs,
    maxWidth: 60,
    textAlign: 'center',
  },
  chartYAxis: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: 2,
    width: 30,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerCopy: {
    flexGrow: 1,
    gap: 2,
    minWidth: 180,
  },
  liveChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  liveDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  liveLabel: {
    fontSize: 12,
  },
  loading: {
    paddingVertical: spacing.md,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  metricGlyph: {
    fontSize: 18,
  },
  navGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  navGridItem: {
    flexBasis: '44%',
    flexGrow: 1,
    gap: 4,
    minWidth: 140,
  },
  navGridLabel: {
    marginBottom: 2,
  },
  navGridValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  pageButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 36,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageLabel: {
    marginHorizontal: spacing.sm,
  },
  pageSubtitle: {
    marginTop: 2,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  panel: {
    gap: spacing.md,
    marginBottom: 0,
    padding: spacing.lg,
  },
  panelGlyph: {
    fontSize: 16,
  },
  panelLast: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelTitle: {
    fontSize: 14,
  },
  panelTitleLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  panelTitleLg: {
    fontSize: 18,
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  routeUpdatedGlyph: {
    fontSize: 12,
  },
  routeUpdatedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  routeUpdatedValue: {
    marginLeft: 2,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sectionGap: {
    marginBottom: spacing.xs,
  },
  select: {
    minWidth: 150,
    position: 'relative',
    zIndex: 10,
  },
  selectChevron: {
    fontSize: 12,
    marginLeft: spacing.xs,
  },
  selectList: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  selectOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    fontSize: 14,
    maxWidth: 180,
  },
  skeletonBar: {
    backgroundColor: SKELETON_COLOR,
    borderRadius: 6,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  stack: {
    gap: spacing.md,
  },
  statusBody: {
    flexShrink: 1,
    gap: 2,
    minWidth: 0,
  },
  statusCard: {
    alignItems: 'center',
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.md,
    minWidth: 150,
    padding: spacing.md,
  },
  statusCardActive: {
    borderColor: SUCCESS_BORDER,
  },
  statusGlyph: {
    fontSize: 18,
  },
  statusGlyphActive: {
    color: colors.success,
  },
  statusIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  statusIconActive: {
    backgroundColor: colors.successSurface,
  },
  statusIconInactive: {
    backgroundColor: colors.surfaceRaised,
  },
  statusLabel: {
    marginBottom: 2,
  },
  statusValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  tableCell: {
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tableHeaderCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minWidth: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tableHeaderRow: {
    borderBottomColor: SUBTLE_BORDER,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  tableHeaderText: {
    fontWeight: '600',
  },
  tableRoot: {
    gap: spacing.sm,
  },
  tableRow: {
    borderBottomColor: SUBTLE_BORDER,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  tableSortArrow: {
    marginLeft: 2,
  },
  timeStamp: {
    fontSize: 12,
  },
  trafficRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  trafficValue: {
    fontSize: 28,
    lineHeight: 34,
  },
  waypointGlyph: {
    fontSize: 14,
  },
  waypointName: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
