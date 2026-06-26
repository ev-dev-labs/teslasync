// Native parity port of
// web/src/features/dashboard/widgets/MileageStatsWidget.tsx.
//
// The web widget is a dashboard "Mileage Stats" tile. It resolves the active
// vehicle (vehicleId prop, else the first vehicle, else id 0), fetches a
// mileage summary via useMileageStats(id > 0 ? String(id) : '') (MileageStats
// with lifetime_km / last_30d_km + drive counts), then derives — from the SI
// kilometre fields — a total/daily-average display distance (km or mi per the
// user's unit_of_length), a next 10 000-unit milestone, the remaining distance
// to it, and an estimated months-to-milestone. It renders one of two layouts
// inside a <WidgetShell>:
//   1. Compact (size.cols <= 1): a title-less shell wrapping a centred
//      <AnimatedNumber value={dailyAvgDisplay}> with a "{unit}/day" caption —
//      or a TrendingUp EmptyState ("No mileage data") when there is no data.
//   2. Standard / Wide (size.cols >= 2): a titled shell ("Mileage Stats" + an
//      emerald TrendingUp icon) wrapping a 2-up <WidgetStatGrid> of Daily Avg /
//      Weekly Avg / Monthly Avg / Next Milestone (the milestone carries an "up"
//      trend reading "~{months} mo"). A TrendingUp EmptyState replaces the body
//      when there is no data. Combined query freshness (loading / fetching /
//      stale / error / dataUpdatedAt) and a manual refresh feed the shell header.
//
// This native port preserves that contract 1:1 — the same id/useMileageStats
// resolution (incl. the '' empty-id disable), the same nextMilestone(step =
// 10 000) helper, the same totalMeters = lifetime_km * 1000 and dailyAvgMeters =
// last_30d_km / 30 * 1000 derivations, the same convertDistanceFromSI display
// conversion, the same milestone / remaining / monthsToMilestone math, the same
// four StatGridItem rows + their fmtNumber(…, 1|0)/fmtInt formatting, the same
// isCompact branch, the same i18n keys + English defaults (incl. the
// "~{{months}} mo" interpolation), and the same visual intent — using React
// Native primitives, the existing native AppText + design tokens, and the
// already-ported native useMileageStats / useVehicles / useSettings hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?, params?)
//     = (fallback ?? key) with i18next-style {{token}} interpolation so the
//     "~{{months}} mo" string renders identically. Every key + English default
//     is preserved.
//   - lucide-react TrendingUp / Calendar / Target / Route (web L3): DOM SVG
//     icons -> emoji/glyph stand-ins, tinted via the muted stat-icon / emerald
//     title intent (the title TrendingUp keeps its text-emerald-400 colour).
//   - @/components/data-display AnimatedNumber (web L4): the DOM count-up <span>
//     -> a native <AnimatedNumber> driving AppText with the same ease-out-quad
//     requestAnimationFrame count-up (Date.now in place of performance.now), the
//     same value/duration/decimals/prefix/suffix props, and the same
//     fmtNumber(display, decimals) formatting.
//   - @/components/feedback EmptyState (web L5): the DOM empty-state -> a native
//     <EmptyState> (icon glyph + muted message), carrying the same i18n message.
//   - @/hooks/useUnits useUnits (web L8) + @/lib/unitConversion
//     convertDistanceFromSI (web L13): the consumed subset (unitPrefs.distance +
//     unitPrefs.locale, derived from useSettings exactly as the web hook does)
//     and the pure SI-metres -> km/mi converter are inlined; no unit math beyond
//     the web's own METERS_PER_KM / METERS_PER_MILE factors is introduced.
//   - @/lib/numberFormat fmtNumber / fmtInt (web L9): inlined locale-aware
//     formatters (en-US fallback), threaded with unitPrefs.locale so grouping
//     matches the web global-locale behaviour.
//   - ./WidgetShell (web L10) + ./shared WidgetStatGrid/StatGridItem (web L11) +
//     ./types WidgetProps (web L12): ported inline as native components/types
//     (shared with the sibling EnergyStatsWidget port), reproducing the same
//     header/title/freshness/skeleton/error shell, the 2-up stat grid, and the
//     StatGridItem shape.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {useMileageStats} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_TRENDING_UP = '\uD83D\uDCC8'; // 📈 (TrendingUp)
const ICON_CALENDAR = '\uD83D\uDCC5'; // 📅 (Calendar)
const ICON_TARGET = '\uD83C\uDFAF'; // 🎯 (Target)
const ICON_ROUTE = '\uD83D\uDEE3\uFE0F'; // 🛣️ (Route)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type TParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: TParams,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, params) => {
      const template = fallback ?? key;
      if (!params) {
        return template;
      }
      // i18next-style {{token}} interpolation (web L78 "~{{months}} mo").
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        params[name] != null ? String(params[name]) : `{{${name}}}`,
      );
    },
    [],
  );
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
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ported: ./shared StatGridItem (web shared/WidgetStatGrid)          */
/* ------------------------------------------------------------------ */

export interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

/* ------------------------------------------------------------------ */
/*  native-safe number formatters (web @/lib/numberFormat)             */
/* ------------------------------------------------------------------ */

/** Port of web fmtNumber — locale-aware (en-US fallback), min=max fractions. */
function fmtNumber(value: unknown, decimals = 2, locale?: string): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
/*  scoped native useUnits + convertDistanceFromSI                     */
/*  (web @/hooks/useUnits + @/lib/unitConversion, consumed subset)     */
/* ------------------------------------------------------------------ */

type DistanceUnitPref = 'km' | 'mi';

interface NativeUnitPrefs {
  distance: DistanceUnitPref;
  locale: string;
}

// web @/lib/unitConversion METERS_PER_KM / METERS_PER_MILE (NIST exact).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
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

/** web @/hooks/useUnits deriveDistance — 'mi' stays 'mi', else 'km'. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
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
  const locale = deriveLocale(settings?.locale);

  const unitPrefs = useMemo<NativeUnitPrefs>(
    () => ({distance, locale}),
    [distance, locale],
  );

  return useMemo(() => ({unitPrefs}), [unitPrefs]);
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
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
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
  // Pulse on data change.
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
  // Compact (dot-only) when widget has no title.
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
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  AnimatedNumber (native-safe port of data-display/AnimatedNumber)    */
/* ------------------------------------------------------------------ */

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
  const rafRef = useRef<number>(0);

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

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return (
    <AppText style={[styles.animatedNumber, style]}>
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetStatGrid (web ./shared WidgetStatGrid)                */
/* ------------------------------------------------------------------ */

function trendColor(trend: 'up' | 'down' | 'flat'): string {
  return trend === 'up'
    ? colors.success
    : trend === 'flat'
      ? colors.textMuted
      : colors.danger;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  cols: 2 | 3;
}

function WidgetStatGrid({stats, cols}: WidgetStatGridProps) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  // web container-query cols 2 / 3 -> native flex-basis.
  const basis: DimensionValue = cols === 3 ? '31%' : '47%';

  return (
    <View style={styles.statGrid}>
      {stats.map(stat => (
        <View key={stat.label} style={[styles.statCard, {flexBasis: basis}]}>
          <View style={styles.statCardHeader}>
            <AppText numberOfLines={1} style={styles.statCardLabel}>
              {stat.label}
            </AppText>
            {stat.icon ? (
              <View style={styles.statCardIcon}>{stat.icon}</View>
            ) : null}
          </View>
          <View style={styles.statValueRow}>
            <AppText
              numberOfLines={1}
              style={[
                styles.statValue,
                stat.valueColor ? {color: stat.valueColor} : null,
              ]}>
              {stat.value}
            </AppText>
            {stat.unit ? (
              <AppText numberOfLines={1} style={styles.statUnit}>
                {stat.unit}
              </AppText>
            ) : null}
          </View>
          {stat.trend && stat.trendValue ? (
            <View style={styles.statTrendRow}>
              <AppText style={[styles.statTrend, {color: trendColor(stat.trend)}]}>
                {`${
                  stat.trend === 'up'
                    ? '\u2191'
                    : stat.trend === 'down'
                      ? '\u2193'
                      : '\u2014'
                } ${stat.trendValue}`}
              </AppText>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ported helper (web L15-19)                                         */
/* ------------------------------------------------------------------ */

/** Round up to the next 10 000-mile milestone above current total. */
function nextMilestone(totalMi: number): number {
  const step = 10_000;
  return Math.ceil((totalMi + 1) / step) * step;
}

/* ------------------------------------------------------------------ */
/*  MileageStatsWidget (web L21-142)                                   */
/* ------------------------------------------------------------------ */

export default function MileageStatsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMileageStats(id > 0 ? String(id) : '');

  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols <= 1;

  // Backend `/mileage/stats` returns SI kilometres; multiply by 1000
  // so the SI-canonical `convertDistanceFromSI` (meters in) treats it
  // correctly. Daily-avg derives from the last_30d_km rolling window —
  // the legacy endpoint exposed `avgDaily` directly; the restored
  // endpoint exposes `last_30d_km`.
  const totalMeters = (data?.lifetime_km ?? 0) * 1000;
  const dailyAvgMeters = ((data?.last_30d_km ?? 0) / 30) * 1000;
  const totalDisplay = toDistanceDisplay(totalMeters);
  const dailyAvgDisplay = toDistanceDisplay(dailyAvgMeters);
  const milestone = nextMilestone(totalDisplay);
  const remaining = milestone - totalDisplay;
  const monthsToMilestone =
    dailyAvgDisplay > 0
      ? Math.max(1, Math.round(remaining / dailyAvgDisplay / 30))
      : 0;

  const stats = useMemo((): StatGridItem[] => {
    if (!data) {
      return [];
    }
    return [
      {
        label: t('widget.mileageStats.dailyAvg', 'Daily Avg'),
        value: fmtNumber(dailyAvgDisplay, 1, unitPrefs.locale),
        unit: distanceUnit,
        icon: <AppText style={styles.statIconGlyph}>{ICON_ROUTE}</AppText>,
      },
      {
        label: t('widget.mileageStats.weeklyAvg', 'Weekly Avg'),
        value: fmtNumber(dailyAvgDisplay * 7, 0, unitPrefs.locale),
        unit: distanceUnit,
        icon: <AppText style={styles.statIconGlyph}>{ICON_CALENDAR}</AppText>,
      },
      {
        label: t('widget.mileageStats.monthlyAvg', 'Monthly Avg'),
        value: fmtNumber(dailyAvgDisplay * 30, 0, unitPrefs.locale),
        unit: distanceUnit,
        icon: <AppText style={styles.statIconGlyph}>{ICON_TRENDING_UP}</AppText>,
      },
      {
        label: t('widget.mileageStats.nextMilestone', 'Next Milestone'),
        value: fmtInt(milestone, unitPrefs.locale),
        unit: distanceUnit,
        trend: 'up' as const,
        trendValue:
          monthsToMilestone > 0
            ? t('widget.mileageStats.inMonths', '~{{months}} mo', {
                months: monthsToMilestone,
              })
            : '\u2014',
        icon: <AppText style={styles.statIconGlyph}>{ICON_TARGET}</AppText>,
      },
    ];
  }, [
    data,
    dailyAvgDisplay,
    distanceUnit,
    milestone,
    monthsToMilestone,
    unitPrefs.locale,
    t,
  ]);

  // Compact: daily avg as large number
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
        {data ? (
          <View style={styles.compactWrap}>
            <AnimatedNumber style={styles.compactNumber} value={dailyAvgDisplay} />
            <AppText style={styles.compactUnit}>
              {`${distanceUnit}/${t('widget.mileageStats.day', 'day')}`}
            </AppText>
          </View>
        ) : (
          <EmptyState
            icon={<AppText style={styles.emptyGlyph}>{ICON_TRENDING_UP}</AppText>}
            message={t('widget.mileageStats.noData', 'No mileage data')}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard / Wide
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<AppText style={styles.titleGlyph}>{ICON_TRENDING_UP}</AppText>}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.mileageStats.title', 'Mileage Stats')}
      updatedAt={dataUpdatedAt}>
      {data ? (
        <WidgetStatGrid cols={2} stats={stats} />
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_TRENDING_UP}</AppText>}
          message={t('widget.mileageStats.noData', 'No mileage data')}
        />
      )}
    </WidgetShell>
  );
}

MileageStatsWidget.displayName = 'MileageStatsWidget';

// shadow-[0_0_12px_rgba(52,211,153,0.15)] pulse-on-update glow (emerald).
const PULSE_GLOW = '#34d399';

const styles = StyleSheet.create({
  animatedNumber: {
    fontVariant: ['tabular-nums'],
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  compactNumber: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  compactUnit: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  compactWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    rowGap: 2,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
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
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
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
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flexGrow: 1,
    minWidth: 0,
    padding: spacing.sm,
    rowGap: spacing.xs,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardIcon: {
    marginLeft: spacing.xs,
  },
  statCardLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  statGrid: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  statIconGlyph: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
  },
  statTrend: {
    fontSize: 11,
  },
  statTrendRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 12,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  statValueRow: {
    alignItems: 'baseline',
    columnGap: 2,
    flexDirection: 'row',
  },
  titleGlyph: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 16,
  },
});
