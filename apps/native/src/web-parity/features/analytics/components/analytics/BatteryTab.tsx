// Native parity port of
// web/src/features/analytics/components/analytics/BatteryTab.tsx.
//
// The web BatteryTab renders the fleet battery-health analytics tab: a 5-up
// MetricCard strip (health score, capacity, degradation, est. range, cycles)
// followed by four Recharts panels (health-score area timeline, capacity line
// trend, range line trend, and a degradation/cycle-count composed chart). It is
// reproduced here with React Native primitives and the native parity component
// library while preserving every state name, API field, unit-handling rule, and
// i18n key:
//
//   - web `@/components/ui` GlassPanel -> native GlassPanel card shell.
//   - web `@/components/data-display` MetricCard is NOT yet ported to native
//     parity (it is a separate conversion target in this file-by-file loop), so
//     a self-contained native MetricCard equivalent is inlined here with the
//     same label/value/subtitle/icon/color contract, following the ToolCard
//     inlining precedent. The lucide-react icons (Heart/Battery/TrendingUp/
//     MapPin/Activity) have no native icon dependency and become short
//     colour-coded badge glyphs; the web `color` prop (green/cyan/amber/purple)
//     drives the badge tint via a local token map.
//   - web `@/components/charts` Recharts stack (ResponsiveContainer/AreaChart/
//     LineChart/ComposedChart/Area/Line/XAxis/YAxis/Tooltip/Legend/ChartTooltip/
//     ChartGradient/AREA_DEFAULTS/chartGrid/axisTick/axisTickSm/
//     chartMarginLabeled/chartAnimation) is browser DOM/SVG-only (the native
//     charts barrel's Recharts shims only render an "unavailable" placeholder).
//     Each chart is drawn with the already-ported native parity
//     `AreaChartWrapper`, which renders the series as a native filled chart with
//     an always-visible latest-value legend (hover Tooltips have no native touch
//     equivalent). The web `safe` guard and the CB-safe `CHART_COLORS` palette
//     are inlined native-safe.
//     LIMITATIONS (documented in the sidecar): the Degradation & Cycles
//     ComposedChart uses two independent Recharts Y-axes (left % / right count);
//     AreaChartWrapper shares one domain, so both series plot on one native
//     scale with the legend still surfacing each latest value. The health
//     timeline's fixed [80,100] YAxis domain becomes the wrapper's auto-fit
//     domain.
//   - web `@/components/feedback` EmptyState (message + Battery icon) becomes
//     the native EmptyState (title + message); the icon meaning is carried by
//     the title/message copy.
//   - web `@/components/motion` FadeIn becomes a reduced-motion-aware mount fade.
//   - web `./helpers` SectionTitle is not yet ported (separate target); a native
//     SectionTitle equivalent is inlined.
//   - web `@/hooks/useUnits`, `@/lib/unitConversion` convertDistanceFromSI, and
//     `@/lib/numberFormat` fmtNumber/fmtInt: the native parity layer has no
//     settings store wired in, so a native useUnits shim mirrors the web
//     out-of-box defaults (distance 'km', energy 'kWh', precision 2, en-US
//     locale) and reads SI straight from the API, converting at the display
//     boundary exactly as the web hook does.
//   - react-i18next `useTranslation` -> local t() fallback shim (the source
//     passes the English copy as the fallback, so every key is preserved
//     verbatim as the visible string).

import React, {
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
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {FleetAnalytics} from '../../../../api/types';
import {AreaChartWrapper} from '../../../../components/charts/AreaChartWrapper';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ─────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

// Mirrors web `safe` from `@/components/charts` (chartUtils): finite or 0.
function safe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safe(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safe(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ───── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
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

interface FormatOptions {
  precision?: number;
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
  formatEnergy: (
    wh: number | null | undefined,
    options?: FormatOptions,
  ) => string;
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults: distance 'km', energy 'kWh', en-US locale. The
// API already returns SI; conversion happens here at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(
    () => ({
      unitPrefs: {distance: 'km'},
      formatEnergy: (wh, options) => {
        if (wh == null || !Number.isFinite(wh)) {
          return '\u2014';
        }
        const kwh = wh / 1000;
        return `${fmtNumber(kwh, options?.precision ?? DEFAULT_GLOBAL_PRECISION)} kWh`;
      },
    }),
    [],
  );
}

/* ─── CB-safe chart palette (web `@/components/charts` `CHART_COLORS`) ──────── */

const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

/* ─── MetricCard (web `@/components/data-display` MetricCard, not yet ported) ─ */

type MetricColor = 'cyan' | 'green' | 'amber' | 'purple';

interface MetricTint {
  surface: string;
  border: string;
  glyph: string;
}

const METRIC_TINTS: Record<MetricColor, MetricTint> = {
  cyan: {
    surface: colors.accentSoft,
    border: colors.borderAccent,
    glyph: colors.accent,
  },
  green: {
    surface: colors.successSurface,
    border: colors.successBorder,
    glyph: colors.success,
  },
  amber: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    glyph: colors.warning,
  },
  purple: {
    surface: colors.violetSurface,
    border: colors.violetBorder,
    glyph: colors.violet,
  },
};

interface MetricCardProps {
  label: string;
  value: string;
  iconGlyph: string;
  color: MetricColor;
  subtitle?: string;
}

function MetricCard({label, value, iconGlyph, color, subtitle}: MetricCardProps) {
  const tint = METRIC_TINTS[color] ?? METRIC_TINTS.cyan;
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricBody}>
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
          {value}
        </AppText>
        {subtitle ? (
          <AppText
            numberOfLines={1}
            style={styles.metricSubtitle}
            tone="muted"
            variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View
        style={[
          styles.metricBadge,
          {backgroundColor: tint.surface, borderColor: tint.border},
        ]}>
        <AppText style={[styles.metricBadgeGlyph, {color: tint.glyph}]} weight="bold">
          {iconGlyph}
        </AppText>
      </View>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

/* ─── SectionTitle (web `./helpers` SectionTitle, not yet ported) ──────────── */

function SectionTitle({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.sectionTitle} weight="semibold">
      {children}
    </AppText>
  );
}

SectionTitle.displayName = 'SectionTitle';

/* ─── FadeIn (web `@/components/motion` FadeIn) ────────────────────────────── */

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
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
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

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

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

FadeIn.displayName = 'FadeIn';

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

/* ─── BatteryTab ───────────────────────────────────────────────────────────── */

export function BatteryTab({data}: {data: FleetAnalytics | undefined}) {
  const t = useNativeTranslationFallback();
  const {unitPrefs, formatEnergy} = useUnits();
  const distanceUnit = unitPrefs.distance;
  // backend `range_km` is SI km; convert via meter-floored helper.
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);

  const trend = data?.battery_trend ?? [];
  const latest = trend.length > 0 ? trend[trend.length - 1] : null;

  if (trend.length === 0) {
    return (
      <FadeIn style={styles.emptyWrap}>
        <GlassPanel style={styles.emptyPanel}>
          <EmptyState
            message={t(
              'analytics.battery.noData',
              'No battery trend data available',
            )}
            title={t('analytics.battery.noDataTitle', 'No battery data')}
          />
        </GlassPanel>
      </FadeIn>
    );
  }

  const rangeData = trend.map(d => ({...d, range: fromKm(safe(d.range_km))}));

  return (
    <FadeIn style={styles.root}>
      {/* Battery Health Cards */}
      <View style={styles.metricGrid}>
        <MetricCard
          color="green"
          iconGlyph="HR"
          label={t('analytics.battery.healthScore', 'Health Score')}
          subtitle="%"
          value={latest ? fmtNumber(safe(latest.health_score), 1) : '\u2014'}
        />
        <MetricCard
          color="cyan"
          iconGlyph="BT"
          label={t('analytics.battery.capacity', 'Capacity')}
          value={
            latest ? formatEnergy(safe(latest.capacity_wh), {precision: 1}) : '\u2014'
          }
        />
        <MetricCard
          color="amber"
          iconGlyph="UP"
          label={t('analytics.battery.degradation', 'Degradation')}
          subtitle="%"
          value={latest ? fmtNumber(safe(latest.degradation_pct), 2) : '\u2014'}
        />
        <MetricCard
          color="purple"
          iconGlyph="PN"
          label={t('analytics.battery.estRange', 'Est. Range')}
          subtitle={distanceUnit}
          value={latest ? fmtNumber(fromKm(safe(latest.range_km)), 0) : '\u2014'}
        />
        <MetricCard
          color="cyan"
          iconGlyph="AC"
          label={t('analytics.battery.cycles', 'Cycles')}
          value={latest ? fmtInt(safe(latest.cycle_count)) : '\u2014'}
        />
      </View>

      {/* Health Score Timeline */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.battery.healthTimeline', 'Health Score Timeline')}
        </SectionTitle>
        <AreaChartWrapper
          data={trend}
          height={280}
          series={[
            {
              color: CHART_COLORS[1],
              key: 'health_score',
              label: t('analytics.battery.health', 'Health %'),
            },
          ]}
          xFormatter={v => v.slice(5)}
          xKey="date"
          yFormatter={v => fmtNumber(v, 1)}
        />
      </GlassPanel>

      <View style={styles.trendColumns}>
        {/* Capacity Trend */}
        <GlassPanel style={styles.panel}>
          <SectionTitle>
            {t('analytics.battery.capacityTrend', 'Capacity Trend')}
          </SectionTitle>
          <AreaChartWrapper
            data={trend}
            height={260}
            series={[
              {
                color: CHART_COLORS[0],
                key: 'capacity_wh',
                label: t('analytics.battery.capacity', 'Capacity'),
              },
            ]}
            xFormatter={v => v.slice(5)}
            xKey="date"
            yFormatter={v => fmtNumber(v, 0)}
          />
        </GlassPanel>

        {/* Range Trend */}
        <GlassPanel style={styles.panel}>
          <SectionTitle>
            {t('analytics.battery.rangeTrend', 'Range Trend')}
          </SectionTitle>
          <AreaChartWrapper
            data={rangeData}
            height={260}
            series={[
              {
                color: CHART_COLORS[2],
                key: 'range',
                label: `${t('analytics.battery.range', 'Range')} (${distanceUnit})`,
              },
            ]}
            xFormatter={v => v.slice(5)}
            xKey="date"
            yFormatter={v => fmtNumber(v, 0)}
          />
        </GlassPanel>
      </View>

      {/* Degradation & Cycles */}
      <GlassPanel style={styles.panel}>
        <SectionTitle>
          {t('analytics.battery.degradationCycles', 'Degradation & Cycles')}
        </SectionTitle>
        <AreaChartWrapper
          data={trend}
          height={280}
          series={[
            {
              color: CHART_COLORS[5],
              key: 'degradation_pct',
              label: t('analytics.battery.degradPct', 'Degradation %'),
            },
            {
              color: CHART_COLORS[4],
              key: 'cycle_count',
              label: t('analytics.battery.cycleCount', 'Cycle Count'),
            },
          ]}
          xFormatter={v => v.slice(5)}
          xKey="date"
          yFormatter={v => fmtNumber(v, 1)}
        />
      </GlassPanel>
    </FadeIn>
  );
}

BatteryTab.displayName = 'BatteryTab';

const styles = StyleSheet.create({
  emptyPanel: {
    padding: spacing.lg,
  },
  emptyWrap: {
    marginTop: spacing.md,
  },
  metricBadge: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  metricBadgeGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  metricBody: {
    flexShrink: 1,
    minWidth: 0,
  },
  metricCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  metricLabel: {
    letterSpacing: 0.6,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  metricSubtitle: {
    marginTop: 2,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  root: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  trendColumns: {
    gap: spacing.lg,
  },
});
