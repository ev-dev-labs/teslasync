// Native parity port of
// web/src/features/dashboard/widgets/WatchSummaryWidget.tsx.
//
// The web module is the dashboard "Watch Summary" widget. It reads two
// per-vehicle watch sources for the selected (or first) vehicle — the watch
// summary (GET /api/v1/watch/summary?vehicle_id=) and the minimal complication
// (GET /api/v1/watch/complication?vehicle_id=) — and renders one of two layouts
// driven by the grid `size.cols`:
//   • Compact (cols <= 1): a watch-face RadialGauge of the battery level
//     (coloured green/amber/red by getBatteryColor, or a muted #374151 when the
//     level is unknown), an optional vehicle StatusBadge, an optional range
//     line ("{range} {unit}") and an optional "⚡ Charging" pulse line.
//   • Standard (cols >= 2): a WidgetBigNumber battery hero with a state badge,
//     then a 2-column detail grid — Range (animated value + distance unit),
//     Lock status (Lock/Unlock glyph + Locked/Unlocked badge), Cabin temp
//     (animated value + temperature unit) and Last Seen (a TimeStamp). Each
//     detail renders "—" when its source value is null.
// Backend range is SI-floored km (range_km); the widget multiplies by 1000 to
// meters and converts to the user's distance preference at the display boundary,
// and cabin temp is SI Celsius converted to the user's temperature preference,
// exactly like the source.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Watch/Lock/Unlock -> the app SemanticIcon glyph vocabulary
//     rendered as colour-tinted AppText glyphs (GlyphIcon): Watch -> 'clock'
//     (closest smartwatch/time semantic; the header/empty slots carry the web
//     muted tint as lucide inherits no colour of its own), Lock -> 'locked'
//     (web text-neon-green -> theme success), Unlock -> 'unlocked' (web
//     text-amber-400 -> theme warning).
//   • @/components/charts RadialGauge -> the native RadialGauge parity port
//     (../../../components/charts/RadialGauge), same value/max/label/unit/color/
//     size/decimals contract.
//   • @/components/data-display StatusBadge -> a local native StatusBadge that
//     resolves the web getStateDefinition('vehicle', status).badgeDot colour per
//     vehicle FSM state (success/danger variant defaults + per-state overrides,
//     muted grey for unknown) and capitalizes the raw status, size sm/md.
//   • @/components/data-display AnimatedNumber -> a local rAF count-up
//     (ease-out-quad 1-(1-p)^2 from 0 to value over `duration`s) rendering
//     fmtNumber(display, decimals) with tabular-nums; honours the OS
//     reduce-motion setting (jump to the final value), matching sibling ports.
//   • @/components/data-display TimeStamp -> a local TimeStamp: format 'auto'
//     honours settings.time_format_default (relative default), rendering the
//     primary relative ("2h ago", falling back to an absolute date past 7d) or
//     absolute ("Apr 4, 2026, 2:30 AM") form. The web hover tooltip showing the
//     alternate format has no native analog and is dropped (see sidecar).
//   • @/components/ui Badge -> a local native pill (success/warning/danger/
//     neutral) backed by the theme surface/foreground tokens.
//   • @/components/feedback EmptyState -> the already-ported native parity
//     EmptyState (icon + message + native `style` in place of `className`).
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/updatedAt/isFetching/
//     isStale/isError/onRefresh/children): a Skeleton while loading, a header row
//     (icon + uppercase title + freshness/refresh chip) when titled, else an
//     overlay freshness chip, then the body.
//   • ./shared WidgetBigNumber -> the already-ported shared native WidgetBigNumber
//     (animated value + unit + label + state badge), imported directly.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • @/hooks/useUnits useUnits + @/lib/unitConversion convertDistanceFromSI/
//     convertTempFromSI -> a settings-derived useUnits() (unitPrefs.distance /
//     unitPrefs.temperature / unitPrefs.locale) and inlined SI converters
//     (km/mi/ft, °C/°F) identical to the web lib constants. @/lib/numberFormat
//     fmtNumber -> inlined locale-aware fixed-decimal helper (min === max
//     fraction digits; non-finite -> 0; bad locale -> en-US), threaded with the
//     settings locale.
//   • @/api/hooks/useWatch useWatchSummary/useWatchComplication -> the already
//     ported native hooks (same names / return shapes / field names).
//   • DOM <div>/<span> + Tailwind classes + animate-pulse -> React Native
//     View/AppText with StyleSheet tokens; text-[var(--text-muted/secondary/
//     primary)] -> tone muted/secondary/primary; text-emerald-300 charging line
//     -> a literal emerald (#6ee7b7) with no pulse animation. The DataFreshness
//     header indicator is computed once at render (no 30s interval) to avoid a
//     dangling timer under --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

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
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {
  useWatchComplication,
  useWatchSummary,
} from '../../../api/hooks/useWatch';
import {useSettings} from '../../../api/hooks/useSettings';
import {WidgetBigNumber} from './shared/WidgetBigNumber';

// web @/lib/unitConversion distance constants (km / mi / ft branches).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const DEFAULT_LOCALE = 'en-US';

// web compact "color" fallback when battery level is unknown (kept verbatim).
const GAUGE_UNKNOWN_COLOR = '#374151';
// web text-emerald-300 charging line (no native pulse analog).
const EMERALD_300 = '#6ee7b7';

// web getBatteryColor — green > 50, amber > 20, else red (kept verbatim).
function getBatteryColor(level: number): string {
  if (level > 50) return '#10b981';
  if (level > 20) return '#f59e0b';
  return '#ef4444';
}

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

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

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber ───────────────────────────────── */

// web @/lib/numberFormat safeNumber: nullish/NaN/Infinity collapse to 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

/* ─── inlined @/lib/unitConversion + @/hooks/useUnits ────────────────────── */

type DistanceUnit = 'km' | 'mi' | 'ft';
type TemperatureUnit = '°C' | '°F';

// web @/lib/unitConversion convertDistanceFromSI: pure SI meters -> display unit.
function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// web @/lib/unitConversion convertTempFromSI: SI Celsius -> display unit.
function convertTempFromSI(celsius: number, to: TemperatureUnit): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

interface UnitPrefs {
  distance: DistanceUnit;
  temperature: TemperatureUnit;
  locale: string;
}

// web useUnits derive* helpers: unit_of_length 'mi' -> 'mi' else 'km';
// unit_of_temp 'F' -> '°F' else '°C'; empty locale -> 'en-US'.
function deriveDistance(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnit {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// Native bridge mirroring the web useUnits() surface this widget reads
// (unitPrefs.distance / unitPrefs.temperature / unitPrefs.locale), derived from
// the native useSettings() query.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  return {
    unitPrefs: {
      distance: deriveDistance(settings?.unit_of_length),
      temperature: deriveTemperature(settings?.unit_of_temp),
      locale: deriveLocale(settings?.locale),
    },
  };
}

/* ─── inlined @/lib/dateFormat + TimeStamp helpers ───────────────────────── */

type DateInput = string | number | Date | null | undefined;

// web @/lib/dateFormat formatDate: "Apr 4, 2026"; "—" for missing/invalid. The
// web useDateFormat also binds an IANA timezone; RN ships no ported useTimezone,
// so the device zone is used (KioskOverlay/ChargePlansWidget precedent) while
// the locale is threaded from useSettings().
function libFormatDate(value: DateInput, locale: string): string {
  if (value == null) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// web @/lib/dateFormat formatDateTime: "Apr 4, 2026, 2:30 AM"; "—" for
// missing/invalid.
function libFormatDateTime(value: DateInput, locale: string): string {
  if (value == null) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// web @/lib/dateFormat formatRelative: "just now"/"{n}m ago"/"{n}h ago"/"{n}d
// ago" under 7 days, else the absolute formatDate; "—" for missing/invalid.
function libFormatRelative(value: DateInput, locale: string): string {
  if (value == null) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return libFormatDate(value, locale);
}

// web @/hooks/useTimeFormatPreference: reads settings.time_format_default,
// defaulting to 'relative' until loaded or when the value isn't a known mode.
function useTimeFormatPreference(): 'relative' | 'absolute' {
  const {data: settings} = useSettings();
  return settings?.time_format_default === 'absolute' ? 'absolute' : 'relative';
}

// web @/components/data-display TimeStamp (format 'auto'): renders the primary
// relative/absolute body chosen by the user's preference. The web hover tooltip
// showing the alternate format has no native analog and is dropped.
function TimeStamp({
  value,
  style,
}: {
  value: DateInput;
  style?: StyleProp<TextStyle>;
}) {
  const pref = useTimeFormatPreference();
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);

  if (value == null) {
    return (
      <AppText numberOfLines={1} style={style} tone="secondary">
        —
      </AppText>
    );
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return (
      <AppText numberOfLines={1} style={style} tone="secondary">
        —
      </AppText>
    );
  }

  const primary =
    pref === 'relative'
      ? libFormatRelative(date, locale)
      : libFormatDateTime(date, locale);

  return (
    <AppText numberOfLines={1} style={style} tone="secondary">
      {primary}
    </AppText>
  );
}

/* ─── reduce-motion-aware count-up (web @/components/data-display) ────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        // Reduce-motion query is best-effort; default to animating.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// web AnimatedNumber: a requestAnimationFrame loop eases (ease-out quad,
// 1-(1-p)^2) from 0 to `value` over `duration` seconds, rendering
// fmtNumber(display, decimals) with tabular-nums. Reduced motion jumps straight
// to the final value (same final output).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  locale,
  style,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  locale: string;
  style?: StyleProp<TextStyle>;
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
    <AppText style={[styles.tabularNums, style]}>
      {fmtNumber(display, decimals, locale)}
    </AppText>
  );
}

/* ─── tinted glyph icon (web lucide-react Watch/Lock/Unlock) ─────────────── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── @/components/ui Badge (pill, size="sm") ────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
};

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── @/components/data-display StatusBadge (vehicle FSM pill) ────────────── */

// web StatusBadge resolves its dot colour through
// getStateDefinition('vehicle', status).badgeDot — the vehicle FSM theme variant
// default plus per-state overrides:
//   online   -> success variant default bg-green-400
//   driving  -> override bg-blue-500
//   charging -> override bg-yellow-400
//   parked   -> override bg-cyan-500
//   updating -> override bg-indigo-500
//   asleep   -> override bg-purple-500
//   offline  -> danger variant default bg-red-400
// Unknown states fall back to the neutral DEFAULT_STATE bg-gray-400.
const STATE_DOT_COLOR: Record<string, string> = {
  online: '#4ade80',
  driving: '#3b82f6',
  charging: '#facc15',
  parked: '#06b6d4',
  updating: '#6366f1',
  asleep: '#a855f7',
  offline: '#f87171',
};
const FALLBACK_DOT_COLOR = '#9ca3af';

function StatusBadge({
  status,
  size = 'md',
}: {
  status: string;
  size?: 'sm' | 'md';
}) {
  const isSm = size === 'sm';
  const dotColor = STATE_DOT_COLOR[status] ?? FALLBACK_DOT_COLOR;
  return (
    <View
      accessibilityLabel={status}
      accessibilityRole="text"
      accessible
      style={[styles.statusBadge, isSm ? styles.statusBadgeSm : styles.statusBadgeMd]}>
      <View
        style={[
          styles.statusDot,
          isSm ? styles.statusDotSm : styles.statusDotMd,
          {backgroundColor: dotColor},
        ]}
      />
      <AppText
        numberOfLines={1}
        style={[
          isSm ? styles.statusTextSm : styles.statusTextMd,
          styles.statusTextCapitalize,
        ]}
        tone="secondary">
        {status}
      </AppText>
    </View>
  );
}

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      {compact ? null : (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

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
    return <Skeleton height={120} rounded style={styles.shellSkeleton} />;
  }

  if (error) {
    return (
      <View style={styles.shellError} testID="widget-error">
        <AppText style={styles.shellErrorText} tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── WatchSummaryWidget ──────────────────────────────────────────────────── */

export default function WatchSummaryWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {
    data: summary,
    isLoading: summaryLoading,
    isFetching: summaryFetching,
    isStale: summaryStale,
    isError: summaryError,
    dataUpdatedAt: summaryUpdatedAt,
    refetch: refetchSummary,
  } = useWatchSummary(vehicleId);

  const {data: complication, isLoading: compLoading} =
    useWatchComplication(vehicleId);

  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;
  const locale = unitPrefs.locale;
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const isCompact = size.cols <= 1;
  const isLoading = summaryLoading || compLoading;

  const batteryLevel = summary?.battery_level ?? null;
  const rangeKm = summary?.range_km ?? null;
  const state = summary?.state ?? null;
  const isLocked = summary?.is_locked ?? null;
  const insideTempC = summary?.inside_temp_c ?? null;
  const lastUpdated = summary?.last_updated ?? null;

  const displayRange = useMemo(() => {
    if (rangeKm == null) return null;
    return toDistanceDisplay(rangeKm * 1000);
  }, [rangeKm, toDistanceDisplay]);

  const displayTemp = useMemo(() => {
    if (insideTempC == null) return null;
    return toTemperatureDisplay(insideTempC);
  }, [insideTempC, toTemperatureDisplay]);

  const color = useMemo(
    () =>
      batteryLevel != null ? getBatteryColor(batteryLevel) : GAUGE_UNKNOWN_COLOR,
    [batteryLevel],
  );

  const hasData = summary != null;

  // Compact (1×2): Watch-face circular display
  if (isCompact) {
    return (
      <WidgetShell
        isError={summaryError}
        isFetching={summaryFetching}
        isStale={summaryStale}
        loading={isLoading}
        onRefresh={() => refetchSummary()}
        updatedAt={summaryUpdatedAt}>
        {hasData ? (
          <View style={styles.compact}>
            <View style={styles.gaugeWrap}>
              <RadialGauge
                color={color}
                decimals={0}
                label=""
                max={100}
                size={80}
                unit="%"
                value={batteryLevel ?? 0}
              />
            </View>
            {state ? <StatusBadge size="sm" status={state} /> : null}
            {displayRange != null ? (
              <AppText style={styles.compactRange} tone="secondary">
                {fmtNumber(displayRange, 0, locale)} {distanceUnit}
              </AppText>
            ) : null}
            {complication?.charging ? (
              <AppText style={styles.compactCharging}>
                {`⚡ ${t('widget.charging', 'Charging')}`}
              </AppText>
            ) : null}
          </View>
        ) : (
          <EmptyState
            icon={<GlyphIcon color={colors.textMuted} name="clock" size={20} />}
            message={t('widget.noWatchData', 'No watch data')}
            style={styles.emptyStatePad}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard (2×2+): Full watch summary with all fields
  return (
    <WidgetShell
      icon={<GlyphIcon color={colors.textMuted} name="clock" size={14} />}
      isError={summaryError}
      isFetching={summaryFetching}
      isStale={summaryStale}
      loading={isLoading}
      onRefresh={() => refetchSummary()}
      title={t('widget.watchSummary', 'Watch Summary')}
      updatedAt={summaryUpdatedAt}>
      {hasData ? (
        <View style={styles.standard}>
          {/* Hero: Battery big number */}
          <WidgetBigNumber
            badge={
              state
                ? {
                    text: state,
                    variant:
                      state === 'online'
                        ? 'success'
                        : state === 'asleep'
                        ? 'neutral'
                        : 'warning',
                  }
                : undefined
            }
            label={t('widget.battery', 'Battery')}
            locale={locale}
            unit="%"
            value={batteryLevel}
          />

          {/* Detail grid: 2 columns */}
          <View style={styles.detailGrid}>
            {/* Range */}
            <View style={styles.detailTile}>
              <AppText style={styles.detailLabel} tone="muted">
                {t('widget.range', 'Range')}
              </AppText>
              {displayRange != null ? (
                <View style={styles.detailValueRow}>
                  <AnimatedNumber
                    decimals={0}
                    locale={locale}
                    style={styles.detailValueText}
                    value={displayRange}
                  />
                  <AppText style={styles.detailUnit} tone="secondary">
                    {distanceUnit}
                  </AppText>
                </View>
              ) : (
                <AppText style={styles.detailDash} tone="muted">
                  —
                </AppText>
              )}
            </View>

            {/* Lock status */}
            <View style={styles.detailTile}>
              <AppText style={styles.detailLabel} tone="muted">
                {t('widget.lockStatus', 'Lock')}
              </AppText>
              {isLocked != null ? (
                <View style={styles.lockRow}>
                  {isLocked ? (
                    <GlyphIcon color={colors.success} name="locked" size={16} />
                  ) : (
                    <GlyphIcon
                      color={colors.warning}
                      name="unlocked"
                      size={16}
                    />
                  )}
                  <Badge variant={isLocked ? 'success' : 'warning'}>
                    {isLocked
                      ? t('widget.locked', 'Locked')
                      : t('widget.unlocked', 'Unlocked')}
                  </Badge>
                </View>
              ) : (
                <AppText style={styles.detailDash} tone="muted">
                  —
                </AppText>
              )}
            </View>

            {/* Cabin temp */}
            <View style={styles.detailTile}>
              <AppText style={styles.detailLabel} tone="muted">
                {t('widget.cabinTemp', 'Cabin')}
              </AppText>
              {displayTemp != null ? (
                <View style={styles.detailValueRow}>
                  <AnimatedNumber
                    decimals={0}
                    locale={locale}
                    style={styles.detailValueText}
                    value={displayTemp}
                  />
                  <AppText style={styles.detailUnit} tone="secondary">
                    {tempUnit}
                  </AppText>
                </View>
              ) : (
                <AppText style={styles.detailDash} tone="muted">
                  —
                </AppText>
              )}
            </View>

            {/* Last updated */}
            <View style={styles.detailTile}>
              <AppText style={styles.detailLabel} tone="muted">
                {t('widget.lastSeen', 'Last Seen')}
              </AppText>
              <TimeStamp style={styles.detailTimestamp} value={lastUpdated} />
            </View>
          </View>
        </View>
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.textMuted} name="clock" size={24} />}
          message={t('widget.noWatchData', 'No watch data')}
          style={styles.emptyStatePad}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  compactCharging: {
    color: EMERALD_300,
    fontSize: 10,
  },
  compactRange: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  detailDash: {
    fontSize: 14,
  },
  detailGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  detailLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  detailTile: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 44,
    padding: spacing.sm,
  },
  detailTimestamp: {
    fontSize: 12,
  },
  detailUnit: {
    fontSize: 12,
    marginLeft: 2,
  },
  detailValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
  },
  detailValueText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyStatePad: {
    paddingVertical: spacing.md,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessLabel: {
    fontSize: 11,
  },
  gaugeWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontWeight: '700',
  },
  lockRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  shell: {
    flex: 1,
    gap: spacing.sm,
  },
  shellBody: {
    flex: 1,
  },
  shellError: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellErrorText: {
    textAlign: 'center',
  },
  shellFreshnessOverlay: {
    alignItems: 'flex-end',
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shellSkeleton: {
    width: '100%',
  },
  shellTitle: {
    fontSize: 11,
    letterSpacing: 0.6,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
  },
  standard: {
    flex: 1,
    gap: spacing.md,
  },
  statusBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
  },
  statusBadgeMd: {
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeSm: {
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusDot: {
    borderRadius: 9999,
  },
  statusDotMd: {
    height: 8,
    width: 8,
  },
  statusDotSm: {
    height: 6,
    width: 6,
  },
  statusTextCapitalize: {
    textTransform: 'capitalize',
  },
  statusTextMd: {
    fontSize: 14,
  },
  statusTextSm: {
    fontSize: 12,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
