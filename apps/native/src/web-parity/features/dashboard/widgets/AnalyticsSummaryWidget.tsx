// Native parity port of web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx.
//
// The web module is the dashboard "Analytics Summary" widget. It reads the fleet
// analytics summary (GET /api/v1/analytics/fleet?days=30) and renders one of two
// layouts driven by the grid `size.cols`:
//   • Compact (cols <= 1): a single large AnimatedNumber count-up of the total
//     distance (in the user's distance unit) with an uppercase caption, or an
//     EmptyState when there is no data.
//   • Standard (cols 2..3) / Wide (cols >= 4): a WidgetStatGrid of four stats —
//     Total Distance, Avg Efficiency, Energy Consumed, Cost / {unit} — and, on
//     wide layouts when trend arrays are present, a row of four Sparklines; or an
//     EmptyState when there is no data.
// Backend distance is SI (km in totalDistanceKm; efficiency in Wh/km); the widget
// converts at the display boundary to the user's distance preference.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?, values?) returns the fallback
//     (or key) and interpolates {{token}} placeholders (used by the
//     'Cost / {{unit}}' stat label), preserving every translation key verbatim.
//   • @/hooks/useUnits (unitPrefs.distance) + @/hooks/useFormatting
//     (currencySymbol, formatCurrency) -> derived from the native useSettings()
//     query exactly like the web hooks (deriveDistance: unit_of_length === 'mi'
//     ? 'mi' : 'km'; currencySymbol = settings.currency_symbol || '$';
//     formatCurrency = `${symbol}${fmtNumber(amount, decimals ?? precision)}`).
//   • @/lib/unitConversion convertDistanceFromSI -> inlined for the km/mi cases
//     (meters / 1000 or meters / 1609.344), identical to the web lib constants.
//   • @/lib/numberFormat fmtNumber -> inlined locale-aware fixed-decimal helper
//     (min === max fraction digits; non-finite -> 0; bad locale -> en-US),
//     identical to the web lib.
//   • @/components/data-display AnimatedNumber -> a local AnimatedNumber that
//     reproduces the web rAF count-up exactly: ease-out-quad (1-(1-p)^2) from 0
//     to `value` over `duration` seconds, rendering fmtNumber(display, decimals)
//     with prefix/suffix in an AppText (tabular-nums). It additionally honours the
//     OS reduce-motion setting (jump to the final value), matching the StatHeroSlide
//     port.
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly the
//     props this call site uses (title/icon/loading/error/updatedAt/isFetching/
//     isStale/isError/onRefresh/children): Skeleton while loading, an inline error
//     block (web QueryError) on error, a header row (icon + uppercase title +
//     freshness/refresh affordance) when titled, else an overlay freshness chip.
//   • ./shared WidgetStatGrid + StatGridItem -> a local native WidgetStatGrid +
//     StatCard cell (label + tinted icon, bold value, muted unit) laid out as a
//     flex-wrap grid whose column target (1/2/4) mirrors the web container-query
//     cols; the StatGridItem type is ported verbatim.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • lucide-react BarChart3/TrendingUp/Zap/DollarSign/Gauge -> the app's
//     SemanticIcon glyph vocabulary rendered as colour-tinted AppText glyphs,
//     honouring the web per-icon tints (cyan/emerald/amber/purple).
//   • @/components/charts Sparkline + @/components/feedback EmptyState -> the
//     already-ported native parity components.
//   • DOM <div>/<span>/<h3> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens; text-[var(--text-muted)] -> tone muted; text-cyan-400 ->
//     accent. The DataFreshness header indicator is computed once at render (no
//     30s interval) to avoid a dangling timer under --detectOpenHandles.
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
import {Sparkline} from '../../../components/charts/Sparkline';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {useAnalyticsSummary} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';

// web @/lib/unitConversion distance constants (km / mi cases used here).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const DEFAULT_LOCALE = 'en-US';

// Preserved verbatim from the source.
const MI_TO_KM = 1.60934;
const SPARKLINE_COLORS = ['#00f0ff', '#34d399', '#fbbf24', '#a78bfa'];

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

/* ─── ./shared StatGridItem (ported verbatim) ────────────────────────────── */

export interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site and interpolating {{token}} tokens.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return {t};
}

/* ─── inlined @/hooks/useUnits + @/hooks/useFormatting + lib helpers ──────── */

// web @/lib/unitConversion DistanceUnitPref (km / mi branches this caller hits).
type DistanceUnit = 'km' | 'mi';

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

// web useFormatting/useUnits derivePrecision: a finite, >= 0 decimal precision.
function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return 2;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/unitConversion convertDistanceFromSI (km / mi branches): pure SI
// meters -> display distance.
function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
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

interface DisplayFormatting {
  distanceUnit: DistanceUnit;
  locale: string;
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Native bridge mirroring web useUnits().unitPrefs.distance + useFormatting()
// (currencySymbol + formatCurrency), derived from the native useSettings() query.
function useDisplayFormatting(): DisplayFormatting {
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';

  // web useFormatting.formatCurrency: `${symbol}${fmtNumber(amount, decimals ?? precision)}`.
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? precision, locale)}`,
    [currencySymbol, precision, locale],
  );

  return {distanceUnit, locale, currencySymbol, formatCurrency};
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
// fmtNumber(display, decimals) wrapped by prefix/suffix with tabular-nums.
// Reduced motion jumps straight to the final value (same final output).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  locale,
  style,
  testID,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
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
  }, [decimals, duration, reduceMotion, value]);

  return (
    <AppText style={[styles.tabularNums, style]} testID={testID} weight="bold">
      {`${prefix ?? ''}${fmtNumber(display, decimals, locale)}${suffix ?? ''}`}
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

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// web DataFreshness: a small relative-time + refresh affordance. Computed once
// at render (no interval) to avoid a dangling timer under --detectOpenHandles.
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

/* ─── WidgetStatGrid (web ./shared) ──────────────────────────────────────── */

function StatCard({label, value, unit, icon, valueColor}: StatGridItem) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        {icon ? <View style={styles.statIcon}>{icon}</View> : null}
      </View>
      <View style={styles.statValueRow}>
        <AppText
          numberOfLines={1}
          style={[styles.statValue, valueColor ? {color: valueColor} : null]}
          weight="bold">
          {String(value)}
        </AppText>
        {unit ? (
          <AppText style={styles.statUnit} tone="muted" variant="caption">
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function WidgetStatGrid({
  stats,
  compact,
  cols,
}: {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  const resolvedCols = compact ? 1 : cols ?? 2;
  const basis =
    resolvedCols === 1 ? '100%' : resolvedCols === 4 ? '22%' : '46%';

  return (
    <View style={styles.statGrid} testID="widget-stat-grid">
      {stats.map(stat => (
        <View key={stat.label} style={[styles.statCell, {flexBasis: basis}]}>
          <StatCard {...stat} />
        </View>
      ))}
    </View>
  );
}

/* ─── AnalyticsSummaryWidget ─────────────────────────────────────────────── */

export default function AnalyticsSummaryWidget({size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {distanceUnit, locale, formatCurrency} = useDisplayFormatting();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, distanceUnit);

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useAnalyticsSummary();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const distKm = data?.totalDistanceKm ?? 0;
  const displayDist = toDistanceDisplay(distKm * 1000);

  const effWhKm = data?.avgEfficiencyWhKm ?? 0;
  const displayEff = distanceUnit === 'mi' ? effWhKm * MI_TO_KM : effWhKm;
  const effUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const energyKwh = data?.totalEnergyKwh ?? 0;
  const totalCost = data?.totalCost ?? 0;
  const costPerDist = displayDist > 0 ? totalCost / displayDist : 0;

  const hasData = distKm > 0 || energyKwh > 0;

  // Trend arrays — API may provide these in the future
  const trends = data as Record<string, unknown> | undefined;
  const distTrend = (trends?.distanceTrend as number[] | undefined) ?? [];
  const effTrend = (trends?.efficiencyTrend as number[] | undefined) ?? [];
  const energyTrend = (trends?.energyTrend as number[] | undefined) ?? [];
  const costTrend = (trends?.costTrend as number[] | undefined) ?? [];
  const sparklines = [distTrend, effTrend, energyTrend, costTrend];
  const hasSparklines = sparklines.some(s => s.length > 0);

  const stats = useMemo(
    (): StatGridItem[] => [
      {
        label: t('widget.analyticsSummary.totalDistance', 'Total Distance'),
        value: fmtNumber(displayDist, 0, locale),
        unit: distanceUnit,
        icon: <GlyphIcon color={colors.accent} name="trendUp" size={13} />,
      },
      {
        label: t('widget.analyticsSummary.avgEfficiency', 'Avg Efficiency'),
        value: fmtNumber(displayEff, 0, locale),
        unit: effUnit,
        icon: <GlyphIcon color={colors.success} name="efficiency" size={13} />,
      },
      {
        label: t('widget.analyticsSummary.energyConsumed', 'Energy Consumed'),
        value: fmtNumber(energyKwh, 1, locale),
        unit: 'kWh',
        icon: <GlyphIcon color={colors.warning} name="bolt" size={13} />,
      },
      {
        label: t('widget.analyticsSummary.costPerDist', 'Cost / {{unit}}', {
          unit: distanceUnit,
        }),
        value: costPerDist > 0 ? formatCurrency(costPerDist, 3) : '—',
        icon: <GlyphIcon color={colors.violet} name="dollarSign" size={13} />,
      },
    ],
    [
      displayDist,
      displayEff,
      effUnit,
      energyKwh,
      costPerDist,
      distanceUnit,
      locale,
      formatCurrency,
      t,
    ],
  );

  // Compact (1×2): large animated distance number
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        {hasData ? (
          <View style={styles.compactWrap}>
            <AnimatedNumber
              decimals={0}
              locale={locale}
              style={styles.compactNumber}
              suffix={` ${distanceUnit}`}
              testID="analytics-summary-distance"
              value={Math.round(displayDist)}
            />
            <AppText style={styles.compactLabel} tone="muted">
              {t('widget.analyticsSummary.totalDistance', 'Total Distance')}
            </AppText>
          </View>
        ) : (
          <EmptyState
            icon={<GlyphIcon color={colors.accent} name="analytics" size={18} />}
            message={t('widget.analyticsSummary.noData', 'No analytics data')}
            style={styles.emptyCompact}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard (2×2) and Wide (4×2)
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<GlyphIcon color={colors.accent} name="analytics" size={13} />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.analyticsSummary.title', 'Analytics Summary')}
      updatedAt={dataUpdatedAt}>
      {hasData ? (
        <View style={styles.standardWrap}>
          <WidgetStatGrid cols={isWide ? 4 : 2} compact={false} stats={stats} />
          {isWide && hasSparklines && (
            <View style={styles.sparklineRow} testID="analytics-summary-sparklines">
              {sparklines.map((trend, i) => (
                <View key={i} style={styles.sparklineCell}>
                  <Sparkline color={SPARKLINE_COLORS[i]} data={trend} />
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.accent} name="analytics" size={18} />}
          message={t('widget.analyticsSummary.noData', 'No analytics data')}
          style={styles.emptyStandard}
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
  // Compact layout
  compactWrap: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactNumber: {
    color: colors.accent,
    fontSize: 30,
    lineHeight: 36,
  },
  compactLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  emptyCompact: {
    paddingVertical: spacing.md,
  },
  emptyStandard: {
    paddingVertical: spacing.xl,
  },
  // Standard / wide layout
  standardWrap: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCell: {
    flexGrow: 1,
    minWidth: 120,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'column',
    gap: spacing.xs,
    padding: spacing.md,
  },
  statHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  statIcon: {
    marginLeft: spacing.xs,
  },
  statValueRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 4,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 26,
  },
  statUnit: {
    fontSize: 13,
    paddingBottom: 2,
  },
  sparklineRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  sparklineCell: {
    alignItems: 'center',
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
});
