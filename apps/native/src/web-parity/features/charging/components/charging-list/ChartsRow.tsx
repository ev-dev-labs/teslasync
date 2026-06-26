// Native parity port of
// web/src/features/charging/components/charging-list/ChartsRow.tsx.
//
// The web ChartsRow renders a responsive two-column grid of GlassPanels:
//   1. "Energy & Cost Trend" — a Recharts AreaChart with two series (energy in
//      kWh, cost in $) over the recent session dates, headed by a neon-cyan
//      Calendar icon.
//   2. "Charger Breakdown" — a Recharts donut PieChart of the charger-type mix
//      (chargerBreakdown: name/value/fill) beside a cost-by-type list
//      (costByType: name/energy/cost/perKwh), headed by a neon-purple Plug icon.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - web `@/components/charts` Recharts stack (AreaChart/Area/XAxis/YAxis/
//     Tooltip/ResponsiveContainer/PieChart/Pie/Cell/ChartTooltip/ChartGradient/
//     chartGrid/axisTickSm/AREA_DEFAULTS) is browser DOM/SVG-only (the native
//     charts barrel's Recharts shims only render an "unavailable" placeholder).
//     The Energy & Cost area chart is drawn with the already-ported native
//     `AreaChartWrapper` (a real native filled chart with an always-visible
//     latest-value legend, since hover Tooltips have no native touch analog).
//     The donut PieChart becomes a native horizontal proportion bar plus a
//     value legend (each segment colour-keyed by the web `fill`); the legend
//     carries the per-type counts/percentages the web surfaced only via the
//     hover ChartTooltip.
//   - web `@/components/ui` GlassPanel -> native GlassPanel card shell.
//   - web `@/components/motion` FadeIn (framer-motion, with a `delay` in
//     seconds) -> a reduced-motion-aware mount fade that honours the same delay.
//   - web `lucide-react` Calendar/Plug header icons (text-neon-cyan/
//     text-neon-purple) -> small tinted glyph chips ("CA"/"PL") using the native
//     accent (cyan) / violet (purple) token tints, preserving the colour intent.
//   - web `@/lib/numberFormat` fmtNumber/fmtWithUnit -> inlined native-safe
//     equivalents mirroring the web out-of-box global precision (2) + en-US
//     locale (the native parity layer has no settings store wired in).
//   - web `react-i18next` useTranslation -> local t() fallback shim (each web
//     key + English fallback is preserved verbatim as the visible string).
//   - web `import type { EnergyTrendPoint, ChargerBreakdownEntry, CostByTypeEntry
//     } from './helpers'` -> inlined local object-literal types (the native
//     helpers sibling is a separate conversion target); declared as type aliases
//     so the rows stay assignable to AreaChartWrapper's Record data prop.
//   LIMITATION: the web AreaChart shares one Y-axis across the energy (tens of
//   kWh) and cost ($) series; AreaChartWrapper likewise shares one domain, so
//   the cost series plots low against the energy scale while the legend still
//   surfaces each latest value.

import React, {
  useEffect,
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
import {AreaChartWrapper} from '../../../../components/charts/AreaChartWrapper';

/* ─── inlined `./helpers` data types ───────────────────────────────────────── */

// Object-literal type aliases (not interfaces) so the arrays keep the implicit
// index signature AreaChartWrapper's `data: Record<string, unknown>[]` expects.
type EnergyTrendPoint = {date: string; energy: number; cost: number};
type ChargerBreakdownEntry = {name: string; value: number; fill: string};
type CostByTypeEntry = {
  name: string;
  energy: number;
  cost: number;
  perKwh: number;
};

interface ChartsRowProps {
  energyTrend: EnergyTrendPoint[];
  chargerBreakdown: ChargerBreakdownEntry[];
  costByType: CostByTypeEntry[];
}

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ─────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

// Mirrors web `safeNumber`: finite number or 0.
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

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

/* ─── web Recharts Area series (stroke colours preserved verbatim) ─────────── */

const ENERGY_COST_SERIES = [
  {color: '#10b981', key: 'energy', label: 'Energy (kWh)'},
  {color: '#f59e0b', key: 'cost', label: 'Cost ($)'},
];

const CHART_HEIGHT = 208; // web h-40 sm:h-52 -> tallest (13rem) breakpoint.
const FALLBACK_SEGMENT_COLOR = colors.accent;

/* ─── header icon chip (web `lucide-react` Calendar / Plug) ─────────────────── */

interface HeaderTint {
  surface: string;
  border: string;
  glyph: string;
}

// text-neon-cyan -> accent (cyan); text-neon-purple -> violet (purple).
const CALENDAR_TINT: HeaderTint = {
  surface: colors.accentSoft,
  border: colors.borderAccent,
  glyph: colors.accent,
};
const PLUG_TINT: HeaderTint = {
  surface: colors.violetSurface,
  border: colors.violetBorder,
  glyph: colors.violet,
};

function PanelHeader({
  glyph,
  tint,
  title,
}: {
  glyph: string;
  tint: HeaderTint;
  title: string;
}) {
  return (
    <View style={styles.panelHeader}>
      <View
        style={[
          styles.headerIcon,
          {backgroundColor: tint.surface, borderColor: tint.border},
        ]}>
        <AppText
          style={[styles.headerGlyph, {color: tint.glyph}]}
          weight="bold">
          {glyph}
        </AppText>
      </View>
      <AppText style={styles.sectionTitle} weight="semibold">
        {title}
      </AppText>
    </View>
  );
}

PanelHeader.displayName = 'PanelHeader';

/* ─── charger breakdown (web Recharts donut PieChart) ──────────────────────── */

function ChargerBreakdown({
  data,
  emptyLabel,
}: {
  data: ChargerBreakdownEntry[];
  emptyLabel: string;
}) {
  const total = data.reduce((sum, d) => sum + safeNumber(d.value), 0);

  if (data.length === 0 || total <= 0) {
    return (
      <AppText tone="muted" variant="caption">
        {emptyLabel}
      </AppText>
    );
  }

  const accessibilityLabel = data
    .map(d => `${d.name} ${fmtNumber(d.value, 0)}`)
    .join(', ');

  return (
    <View style={styles.breakdown}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
        accessible
        style={styles.proportionBar}>
        {data.map(d => (
          <View
            key={d.name}
            pointerEvents="none"
            style={[
              styles.segment,
              {
                backgroundColor: d.fill || FALLBACK_SEGMENT_COLOR,
                flex: Math.max(safeNumber(d.value), 0.0001),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.legend}>
        {data.map(d => {
          const pct = total > 0 ? (safeNumber(d.value) / total) * 100 : 0;
          return (
            <View key={d.name} style={styles.legendRow}>
              <View
                pointerEvents="none"
                style={[
                  styles.legendDot,
                  {backgroundColor: d.fill || FALLBACK_SEGMENT_COLOR},
                ]}
              />
              <AppText
                numberOfLines={1}
                style={styles.legendName}
                tone="secondary"
                variant="caption">
                {d.name}
              </AppText>
              <AppText tone="muted" variant="caption">
                {`${fmtNumber(d.value, 0)} \u2022 ${fmtNumber(pct, 0)}%`}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

ChargerBreakdown.displayName = 'ChargerBreakdown';

/* ─── cost-by-type list (web right-hand column) ────────────────────────────── */

function CostByTypeList({
  data,
  emptyLabel,
}: {
  data: CostByTypeEntry[];
  emptyLabel: string;
}) {
  if (data.length === 0) {
    return (
      <AppText tone="muted" variant="caption">
        {emptyLabel}
      </AppText>
    );
  }

  return (
    <View style={styles.costList}>
      {data.map(ct => (
        <View key={ct.name} style={styles.costRow}>
          <View style={styles.costRowTop}>
            <AppText
              numberOfLines={1}
              style={styles.costName}
              tone="secondary">
              {ct.name}
            </AppText>
            <AppText weight="semibold">{fmtWithUnit(ct.energy, 'kWh')}</AppText>
          </View>
          <View style={styles.costRowBottom}>
            <AppText tone="muted" variant="caption">
              {`$${fmtNumber(ct.cost)} total`}
            </AppText>
            <AppText tone="muted" variant="caption">
              {`$${fmtNumber(ct.perKwh)}/kWh`}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

CostByTypeList.displayName = 'CostByTypeList';

/* ─── FadeIn (web `@/components/motion` FadeIn, delay in seconds) ───────────── */

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

/* ─── ChartsRow ────────────────────────────────────────────────────────────── */

export function ChartsRow({
  energyTrend,
  chargerBreakdown,
  costByType,
}: ChartsRowProps) {
  const t = useNativeTranslationFallback();

  return (
    <View style={styles.root}>
      {/* Energy & Cost Trend */}
      <FadeIn delay={0.1}>
        <GlassPanel style={styles.panel}>
          <PanelHeader
            glyph="CA"
            tint={CALENDAR_TINT}
            title={t('charging.charts.energyCostTrend', 'Energy & Cost Trend')}
          />
          {energyTrend.length > 0 ? (
            <AreaChartWrapper
              data={energyTrend}
              height={CHART_HEIGHT}
              series={ENERGY_COST_SERIES}
              xKey="date"
              yFormatter={v => fmtNumber(v, 1)}
            />
          ) : (
            <EmptyState
              message={t(
                'charging.charts.energyCostTrend.empty',
                'No charging energy or cost data yet',
              )}
              title={t('charging.charts.energyCostTrend', 'Energy & Cost Trend')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Charger Type Breakdown */}
      <FadeIn delay={0.15}>
        <GlassPanel style={styles.panel}>
          <PanelHeader
            glyph="PL"
            tint={PLUG_TINT}
            title={t('charging.charts.chargerBreakdown', 'Charger Breakdown')}
          />
          <View style={styles.breakdownBody}>
            <ChargerBreakdown
              data={chargerBreakdown}
              emptyLabel={t(
                'charging.charts.chargerBreakdown.empty',
                'No charger breakdown data',
              )}
            />
            <CostByTypeList
              data={costByType}
              emptyLabel={t(
                'charging.charts.costByType.empty',
                'No cost breakdown data',
              )}
            />
          </View>
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

ChartsRow.displayName = 'ChartsRow';

const styles = StyleSheet.create({
  breakdown: {
    gap: spacing.md,
  },
  breakdownBody: {
    gap: spacing.lg,
  },
  costList: {
    gap: spacing.md,
  },
  costName: {
    flex: 1,
    minWidth: 0,
  },
  costRow: {
    gap: 2,
  },
  costRowBottom: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  costRowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  headerGlyph: {
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  headerIcon: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  legend: {
    gap: spacing.xs,
  },
  legendDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  legendName: {
    flex: 1,
    minWidth: 0,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  proportionBar: {
    flexDirection: 'row',
    gap: 2,
    height: 14,
    width: '100%',
  },
  root: {
    gap: spacing.lg,
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  segment: {
    borderRadius: 3,
    height: '100%',
  },
});
