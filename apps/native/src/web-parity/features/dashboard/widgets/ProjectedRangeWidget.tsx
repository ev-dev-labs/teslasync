// Native parity port of web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx.
//
// The web module is the dashboard "Projected Range" widget. It reads the battery
// projected-range summary (GET /api/v1/vehicles/{id}/battery/projected-range) for
// the selected (or first) vehicle and renders one of three layouts driven by the
// grid `size.cols`:
//   • Compact (cols <= 1): a WidgetBigNumber — animated projected-range value (in
//     the user's distance unit) with a label and a health-confidence badge.
//   • Standard (cols 2): the primary animated range + a Projected-vs-EPA
//     ComparisonBar + a health badge ("{tier} · {score}%").
//   • Wide (cols >= 3): the same primary range + ComparisonBar, plus a scrollable
//     "Range Factors" list (Battery Degradation / Avg Daily Usage / Current
//     Capacity / Battery Cycles). An EmptyState is shown when there is no data.
// Backend distance is SI-floored km (current_range_km / new_range_km / avg_daily_km);
// the widget multiplies by 1000 to meters and converts to the user's distance
// preference at the display boundary, exactly like the source.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Navigation/Thermometer/Gauge/Mountain -> the app SemanticIcon
//     glyph vocabulary rendered as colour-tinted AppText glyphs (GlyphIcon):
//     Navigation -> 'navigation' (accent header / muted empty), Gauge -> 'speed',
//     Thermometer -> 'climate', Mountain -> 'recycle' (the closest "cycles"
//     semantic). The factor-list icons carry the web `text-[var(--text-muted)]`
//     tint; the header icon carries the web `text-neon-cyan` accent.
//   • @/components/data-display AnimatedNumber -> a local AnimatedNumber that
//     reproduces the web rAF count-up exactly: ease-out-quad (1-(1-p)^2) from 0
//     to `value` over `duration` seconds, rendering fmtNumber(display, decimals)
//     in an AppText (tabular-nums); it additionally honours the OS reduce-motion
//     setting (jump to the final value), matching the sibling widget ports.
//   • @/components/ui Badge -> a local native Badge (success/warning/danger/
//     neutral pill) with the web badgeVariantMap (error -> danger) preserved.
//   • @/components/feedback EmptyState -> the already-ported native parity EmptyState.
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly the
//     props this call site uses (title/icon/loading/updatedAt/isFetching/isStale/
//     isError/onRefresh/children): Skeleton while loading, an inline error block on
//     error, a header row (icon + uppercase title + freshness/refresh affordance)
//     when titled, else an overlay freshness chip.
//   • ./shared WidgetBigNumber -> a local native WidgetBigNumber (animated/static
//     value + unit + label + subtitle + badge) with the web badgeVariantMap.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local types
//     (the shared registry types module is not yet in the parity tree).
//   • @/hooks/useUnits useUnits + @/lib/unitConversion convertDistanceFromSI ->
//     a settings-derived useUnits() (unitPrefs.distance / unitPrefs.locale) and an
//     inlined convertDistanceFromSI (km / mi / ft branches), identical to the web
//     lib constants. @/lib/numberFormat fmtNumber -> inlined locale-aware
//     fixed-decimal helper (min === max fraction digits; non-finite -> 0; bad
//     locale -> en-US), threaded with the settings locale.
//   • DOM <div>/<span>/<p> + Tailwind classes + overflow-y-auto -> React Native
//     View/ScrollView/AppText with StyleSheet tokens; text-[var(--text-muted/
//     secondary/primary)] -> tone muted/secondary/primary; text-neon-cyan ->
//     accent. The ComparisonBar fill colour (#10b981/#f59e0b/#ef4444) is a
//     dynamic computed value kept verbatim. The DataFreshness header indicator is
//     computed once at render (no 30s interval) to avoid a dangling timer under
//     --detectOpenHandles.
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
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {useProjectedRange} from '../../../api/hooks/useEnergy';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

// web @/lib/unitConversion distance constants (km / mi / ft branches).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const DEFAULT_LOCALE = 'en-US';

// web ComparisonBar fill colours (dynamic, kept verbatim from the source).
const BAR_GREEN = '#10b981';
const BAR_AMBER = '#f59e0b';
const BAR_RED = '#ef4444';

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
// while preserving every key verbatim at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useUnits + @/lib/unitConversion + numberFormat ──────── */

// web @/lib/unitConversion DistanceUnitPref.
type DistanceUnit = 'km' | 'mi' | 'ft';

// web useUnits' deriveDistance: 'mi' selects miles, everything else km.
function deriveDistance(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// web useUnits/numberFormat global locale: settings.locale when non-empty.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

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

interface UnitPrefs {
  distance: DistanceUnit;
  locale: string;
}

// Native bridge mirroring the web useUnits().unitPrefs surface this widget reads
// (unitPrefs.distance + unitPrefs.locale), derived from the native useSettings().
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  return {
    unitPrefs: {
      distance: deriveDistance(settings?.unit_of_length),
      locale: deriveLocale(settings?.locale),
    },
  };
}

/* ─── health badge tier (ported verbatim from the source) ────────────────── */

type HealthBadgeVariant = 'success' | 'warning' | 'error';

interface HealthBadge {
  text: string;
  variant: HealthBadgeVariant;
}

function healthBadge(score: number, t: TFunc): HealthBadge {
  if (score >= 90) {
    return {text: t('widget.projectedRange.excellent', 'Excellent'), variant: 'success'};
  }
  if (score >= 70) {
    return {text: t('widget.projectedRange.good', 'Good'), variant: 'success'};
  }
  if (score >= 50) {
    return {text: t('widget.projectedRange.fair', 'Fair'), variant: 'warning'};
  }
  return {text: t('widget.projectedRange.poor', 'Poor'), variant: 'error'};
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
// to the final value (same final output).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  locale,
  style,
  testID,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  locale: string;
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
      {fmtNumber(display, decimals, locale)}
    </AppText>
  );
}

/* ─── tinted glyph icon (web lucide-react icons) ─────────────────────────── */

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

/* ─── @/components/ui Badge (pill) ───────────────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
};

function Badge({
  variant = 'neutral',
  children,
  style,
  testID,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}, style]} testID={testID}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

// web ./shared WidgetBigNumber badgeVariantMap (error -> danger).
const badgeVariantMap: Record<'success' | 'warning' | 'error' | 'neutral', BadgeVariant> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
};

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
  // Compact (dot-only) when the widget has no title (typically 1-col widgets).
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

/* ─── WidgetBigNumber (web ./shared) ─────────────────────────────────────── */

function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor = colors.textPrimary,
  nullDisplay = '—',
  animated = true,
  locale,
  testID,
}: {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
  locale: string;
  testID?: string;
}) {
  return (
    <View style={styles.bigNumber}>
      <View style={styles.bigNumberRow}>
        {value !== null ? (
          animated ? (
            <AnimatedNumber
              locale={locale}
              style={[styles.bigNumberValue, {color: valueColor}]}
              testID={testID}
              value={value}
            />
          ) : (
            <AppText
              style={[styles.bigNumberValue, styles.tabularNums, {color: valueColor}]}
              testID={testID}
              weight="bold">
              {String(value)}
            </AppText>
          )
        ) : (
          <AppText style={[styles.bigNumberValue, styles.bigNumberNull]} testID={testID} weight="bold">
            {nullDisplay}
          </AppText>
        )}
        {unit ? (
          <AppText style={styles.bigNumberUnit} tone="secondary">
            {unit}
          </AppText>
        ) : null}
      </View>

      {label ? (
        <AppText style={styles.bigNumberLabel} tone="muted">
          {label}
        </AppText>
      ) : null}

      {subtitle ? (
        <AppText style={styles.bigNumberSubtitle} tone="secondary" variant="caption">
          {subtitle}
        </AppText>
      ) : null}

      {badge ? (
        <Badge variant={badgeVariantMap[badge.variant]}>{badge.text}</Badge>
      ) : null}
    </View>
  );
}

/* ─── primary range header (shared by the standard + wide layouts) ───────── */

function PrimaryRange({
  projectedRange,
  distanceUnit,
  badge,
  healthScore,
  locale,
}: {
  projectedRange: number | null;
  distanceUnit: string;
  badge: HealthBadge | undefined;
  healthScore: number | null;
  locale: string;
}) {
  return (
    <View style={styles.primary}>
      <View style={styles.primaryRow}>
        {projectedRange != null ? (
          <AnimatedNumber
            locale={locale}
            style={styles.primaryValue}
            testID="projected-range-value"
            value={Math.round(projectedRange)}
          />
        ) : (
          <AppText style={[styles.primaryValue, styles.primaryNull]} weight="bold">
            —
          </AppText>
        )}
        <AppText style={styles.primaryUnit} tone="secondary">
          {distanceUnit}
        </AppText>
      </View>
      {badge ? (
        <Badge
          style={styles.primaryBadge}
          variant={
            badge.variant === 'success'
              ? 'success'
              : badge.variant === 'warning'
              ? 'warning'
              : 'danger'
          }>
          {`${badge.text} · ${fmtNumber(healthScore ?? 0, 0, locale)}%`}
        </Badge>
      ) : null}
    </View>
  );
}

/* ─── ComparisonBar (ported from the source) ─────────────────────────────── */

function ComparisonBar({
  rangePct,
  epaRange,
  distanceUnit,
  locale,
  t,
}: {
  rangePct: number | null;
  epaRange: number | null;
  distanceUnit: string;
  locale: string;
  t: TFunc;
}) {
  const fillColor =
    rangePct != null && rangePct >= 80
      ? BAR_GREEN
      : rangePct != null && rangePct >= 60
      ? BAR_AMBER
      : BAR_RED;

  const fillWidth: DimensionValue = `${rangePct ?? 0}%`;

  return (
    <View style={styles.comparison} testID="projected-range-comparison">
      <View style={styles.comparisonHeader}>
        <AppText style={styles.comparisonCaption} tone="muted">
          {t('widget.projectedRange.projected', 'Projected')}
        </AppText>
        <AppText style={styles.comparisonCaption} tone="muted">
          {`${t('widget.projectedRange.epa', 'EPA')}: ${
            epaRange != null ? `${fmtNumber(epaRange, 0, locale)} ${distanceUnit}` : '—'
          }`}
        </AppText>
      </View>
      <View style={styles.comparisonTrack}>
        <View
          style={[styles.comparisonFill, {width: fillWidth, backgroundColor: fillColor}]}
          testID="projected-range-bar-fill"
        />
      </View>
      {rangePct != null ? (
        <AppText style={styles.comparisonFooter} tone="muted">
          {`${rangePct}% ${t('widget.projectedRange.ofEpa', 'of EPA rated')}`}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── range factors list (wide layout) ───────────────────────────────────── */

interface RangeFactor {
  icon: SemanticIconName;
  label: string;
  value: string;
}

function FactorsList({factors, t}: {factors: RangeFactor[]; t: TFunc}) {
  return (
    <ScrollView style={styles.factors} testID="projected-range-factors">
      <AppText style={styles.factorsTitle} tone="muted">
        {t('widget.projectedRange.factors', 'Range Factors')}
      </AppText>
      <View style={styles.factorsList}>
        {factors.map((f, i) => (
          <View
            key={f.label}
            style={[styles.factorRow, i === factors.length - 1 && styles.factorRowLast]}>
            <View style={styles.factorLeft}>
              <GlyphIcon color={colors.textMuted} name={f.icon} size={13} />
              <AppText
                numberOfLines={1}
                style={styles.factorLabel}
                tone="secondary">
                {f.label}
              </AppText>
            </View>
            <AppText numberOfLines={1} style={styles.factorValue}>
              {f.value}
            </AppText>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/* ─── ProjectedRangeWidget ───────────────────────────────────────────────── */

export default function ProjectedRangeWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch} =
    useProjectedRange(idStr);

  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const locale = unitPrefs.locale;
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, distanceUnit),
    [distanceUnit],
  );

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Data is in km; convert to SI meters before display conversion.
  const projectedRange = useMemo(
    () =>
      data?.current_range_km != null
        ? toDistanceDisplay(data.current_range_km * 1000)
        : null,
    [data?.current_range_km, toDistanceDisplay],
  );

  const epaRange = useMemo(
    () =>
      data?.new_range_km != null ? toDistanceDisplay(data.new_range_km * 1000) : null,
    [data?.new_range_km, toDistanceDisplay],
  );

  const avgDaily = useMemo(
    () =>
      data?.avg_daily_km != null ? toDistanceDisplay(data.avg_daily_km * 1000) : null,
    [data?.avg_daily_km, toDistanceDisplay],
  );

  const healthScore = data?.health_score ?? null;
  const badge = healthScore != null ? healthBadge(healthScore, t) : undefined;

  // Comparison bar: projected / EPA ratio (clamped 0-100%)
  const rangePct =
    projectedRange != null && epaRange != null && epaRange > 0
      ? Math.min(100, Math.round((projectedRange / epaRange) * 100))
      : null;

  // Factors list for wide view — derived from available data fields
  const factors = useMemo<RangeFactor[]>(() => {
    if (!data) {
      return [];
    }
    return [
      {
        icon: 'speed',
        label: t('widget.projectedRange.degradation', 'Battery Degradation'),
        value: `${fmtNumber(data.degradation_pct ?? 0, 1, locale)}%`,
      },
      {
        icon: 'navigation',
        label: t('widget.projectedRange.avgDaily', 'Avg Daily Usage'),
        value: `${fmtNumber(avgDaily ?? 0, 0, locale)} ${distanceUnit}`,
      },
      {
        icon: 'climate',
        label: t('widget.projectedRange.capacity', 'Current Capacity'),
        value: `${fmtNumber(data.current_capacity_pct ?? 0, 1, locale)}%`,
      },
      {
        icon: 'recycle',
        label: t('widget.projectedRange.cycles', 'Battery Cycles'),
        value: fmtNumber(data.total_cycles ?? 0, 0, locale),
      },
    ];
  }, [data, avgDaily, distanceUnit, locale, t]);

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <GlyphIcon color={colors.accent} name="navigation" size={13} />
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.projectedRange.title', 'Projected Range')}
      updatedAt={dataUpdatedAt}>
      {data ? (
        isCompact ? (
          /* ── Compact (1×2): big number + confidence badge ── */
          <WidgetBigNumber
            badge={badge}
            label={t('widget.projectedRange.projected', 'Projected')}
            locale={locale}
            testID="projected-range-value"
            unit={distanceUnit}
            value={projectedRange != null ? Math.round(projectedRange) : null}
          />
        ) : isWide ? (
          /* ── Wide (2×4): range + comparison + factors list ── */
          <View style={styles.wide}>
            <PrimaryRange
              badge={badge}
              distanceUnit={distanceUnit}
              healthScore={healthScore}
              locale={locale}
              projectedRange={projectedRange}
            />
            <ComparisonBar
              distanceUnit={distanceUnit}
              epaRange={epaRange}
              locale={locale}
              rangePct={rangePct}
              t={t}
            />
            <FactorsList factors={factors} t={t} />
          </View>
        ) : (
          /* ── Standard (2×2): range + comparison bar + health badge ── */
          <View style={styles.standard}>
            <PrimaryRange
              badge={badge}
              distanceUnit={distanceUnit}
              healthScore={healthScore}
              locale={locale}
              projectedRange={projectedRange}
            />
            <ComparisonBar
              distanceUnit={distanceUnit}
              epaRange={epaRange}
              locale={locale}
              rangePct={rangePct}
              t={t}
            />
          </View>
        )
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.textMuted} name="navigation" size={18} />}
          message={t('widget.projectedRange.noData', 'No projected range data')}
          style={styles.empty}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellSkeleton: {
    height: '100%',
    minHeight: 120,
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
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // Badge
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
  // WidgetBigNumber (compact)
  bigNumber: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
  },
  bigNumberRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
  },
  bigNumberValue: {
    fontSize: 30,
    lineHeight: 36,
  },
  bigNumberNull: {
    color: colors.textMuted,
  },
  bigNumberUnit: {
    fontSize: 18,
  },
  bigNumberLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  bigNumberSubtitle: {
    fontSize: 12,
  },
  // Standard / wide layouts
  standard: {
    flex: 1,
    flexDirection: 'column',
    gap: spacing.md,
    justifyContent: 'center',
  },
  wide: {
    flex: 1,
    flexDirection: 'column',
    gap: spacing.md,
    minHeight: 0,
  },
  // PrimaryRange
  primary: {
    alignItems: 'center',
  },
  primaryRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
  },
  primaryValue: {
    color: colors.accent,
    fontSize: 30,
    lineHeight: 36,
  },
  primaryNull: {
    color: colors.textMuted,
  },
  primaryUnit: {
    fontSize: 18,
  },
  primaryBadge: {
    marginTop: spacing.xs,
  },
  // ComparisonBar
  comparison: {
    flexShrink: 0,
  },
  comparisonHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  comparisonCaption: {
    fontSize: 10,
  },
  comparisonTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 9999,
    height: 8,
    overflow: 'hidden',
  },
  comparisonFill: {
    borderRadius: 9999,
    height: '100%',
  },
  comparisonFooter: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  // FactorsList
  factors: {
    flex: 1,
    minHeight: 0,
  },
  factorsTitle: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  factorsList: {
    flexDirection: 'column',
    gap: 6,
  },
  factorRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: 4,
  },
  factorRowLast: {
    borderBottomWidth: 0,
  },
  factorLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  factorLabel: {
    flexShrink: 1,
    fontSize: 12,
  },
  factorValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 8,
  },
  // EmptyState
  empty: {
    paddingVertical: spacing.md,
  },
});
