// SummaryStats — native parity port of
// web/src/features/driving/components/driving-dynamics/SummaryStats.tsx.
//
// The web component is the driving-dynamics summary strip: an outer
// `FadeIn delay={0.4}` wrapping a `StaggerContainer` whose className makes it a
// responsive grid (`grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6`) of
// six `StaggerItem`-wrapped `StatCard`s — Total Readings, Avg Torque, Peak
// Power, Peak Regen, Avg Power, and Avg Motor Temp. Every card reads from the
// nullable `motorStats` prop with a `?? 0` floor, formats numeric values to one
// decimal (Total Readings is the raw count), and bakes its unit suffix into the
// value string (Nm / kW). Avg Motor Temp routes the SI Celsius through the
// `toTemperatureDisplay` prop and appends the `tempUnit` prop (already '°C' /
// '°F', including the degree mark), falling back to '—' when motorStats is null.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback)
//     keeping every dynamics.* key + English fallback verbatim (the
//     SummaryStatsGrid / TemperatureMetricCards precedent).
//   - lucide-react Gauge / CornerDownRight / TrendingDown / Zap / BarChart3 /
//     Thermometer (web L2-9): lucide is browser-only SVG and forbidden in native
//     output (rule 4). Each StatCard's small muted `h-4 w-4` icon is rendered as
//     the native SemanticIcon glyph vocabulary, drawn as a muted AppText glyph
//     (the GForcePanel Gauge precedent): BarChart3 -> 'analytics' ('AN'),
//     Zap -> 'bolt' ('ZP'), CornerDownRight -> 'arrowDownToDot' ('v.'),
//     TrendingDown -> 'trendDown' ('DN'), Gauge -> 'speedCircle' ('SC', the same
//     Gauge mapping GForcePanel uses), Thermometer -> 'climate' ('CL').
//   - `@/components/data-display` StatCard (web L11): no native StatCard parity
//     port exists yet, so a local StatCard is built from RN primitives
//     reproducing the web Card (rounded-lg border surface, p-4) with the header
//     row (muted label + muted icon) and the baseline bold value. Only the
//     icon/label/value slots this file uses are ported (no unit/trend/sublabel —
//     the units are baked into the value strings here).
//   - `@/components/motion` FadeIn / StaggerContainer / StaggerItem (web L12):
//     FadeIn delay={0.4} -> a local reduced-motion-aware FadeIn (Animated.View)
//     reproducing the web initial {opacity:0, y:12} -> {opacity:1, y:0} easeOut
//     entrance with a 400ms delay (web delay={0.4}) / 400ms duration
//     (useMotionPreference(400)); StaggerContainer + the six StaggerItem children
//     -> a local StaggerGrid that carries BOTH the responsive grid (its mobile
//     base `grid-cols-2 gap-4` — 2 columns, 16px gutter — the lg/xl column counts
//     are web-only responsive intent on a phone-first surface) AND the per-child
//     fade/slide + `index * 0.06s` stagger, reduced-motion-aware, reusing the
//     canonical native StaggerContainer entrance timing (300ms / y8) for
//     consistency with the sibling TemperatureMetricCards StaggerGrid.
//   - `@/lib/numberFormat` fmtNumber (web L13) -> ported inline with the web
//     global defaults (precision 2, locale en-US); this parity tree has no
//     useSettings overrides. Called with precision 1 here, matching the web.
//   - `./helpers` MotorStats type (web L14) -> inlined field-for-field (the
//     sibling native helpers.ts is its own conversion turn — the
//     TemperatureMetricCards inline-types precedent).
//   - `@/lib/unitConversion` TemperatureUnitPref (web L15) -> inlined as the same
//     '°C' | '°F' string union; the toTemperatureDisplay + tempUnit conversion is
//     kept as injected props (the parent owns the unit preference), so no
//     deprecated useSettings converter is reintroduced.
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports — RN
// primitives only. See the .parity.json sidecar for the line-by-line map.

import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

// ---- Inlined `./helpers` MotorStats (own conversion turn) -------------------
// The web `MotorStats` interface, reproduced field-for-field; this file reads
// totalReadings / avgTorque / peakPower / peakRegen / avgPower / avgMotorTemp.

interface MotorStats {
  totalReadings: number;
  avgTorque: number;
  maxTorque: number;
  avgMotorTemp: number;
  maxMotorTemp: number;
  avgPower: number;
  peakPower: number;
  minPower: number;
  peakRegen: number;
  highTorquePct: number;
}

// ---- Inlined `@/lib/unitConversion` TemperatureUnitPref ----------------------
// The display unit suffix already includes the degree mark ('°C' / '°F').

type TemperatureUnitPref = '°C' | '°F';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Native-safe number formatting (web @/lib/numberFormat fmtNumber) --------
// fmtNumber ported with the web global defaults: precision 2, locale en-US.
// The parity tree has no useSettings overrides.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// ---- Icon glyphs (web lucide-react icons) -----------------------------------
// Each web `h-4 w-4` StatCard icon maps to the closest native SemanticIcon glyph.

const TOTAL_READINGS_GLYPH = getSemanticIconDefinition('analytics').glyph; // BarChart3
const AVG_TORQUE_GLYPH = getSemanticIconDefinition('bolt').glyph; // Zap
const PEAK_POWER_GLYPH = getSemanticIconDefinition('arrowDownToDot').glyph; // CornerDownRight
const PEAK_REGEN_GLYPH = getSemanticIconDefinition('trendDown').glyph; // TrendingDown
const AVG_POWER_GLYPH = getSemanticIconDefinition('speedCircle').glyph; // Gauge
const AVG_MOTOR_TEMP_GLYPH = getSemanticIconDefinition('climate').glyph; // Thermometer

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

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

// ---- Reduced-motion-aware FadeIn (web @/components/motion FadeIn) ------------
// web FadeIn delay prop (0.4s) + useMotionPreference(400) duration + initial
// {opacity:0, y:12}. Reduced motion collapses to the final state (the web no-op).

const FADE_IN_DELAY_MS = 400;
const FADE_IN_DURATION_MS = 400;
const FADE_IN_TRANSLATE_Y = 12;

function FadeIn({
  children,
  reduceMotion,
}: {
  children: ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: FADE_IN_DELAY_MS,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [FADE_IN_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ---- StaggerGrid (web StaggerContainer + StaggerItem, grid layout) -----------
// Reproduces the web staggered entrance (per-child fade + slide with a
// `index * 0.06s` delay, collapsing to the final state under reduced motion) AND
// the responsive grid by carrying the 2-column cell sizing on the animated
// wrapper itself. The web grid base is `grid-cols-2 gap-4` (2 columns, 16px
// gutter); the md:3 / lg:6 column counts are web-only responsive intent. The
// canonical native StaggerContainer entrance timing (300ms / y8) is reused for
// consistency with the sibling TemperatureMetricCards StaggerGrid.

const STAGGER_SECONDS = 0.06;
const ENTRANCE_DURATION_MS = 300;
const ENTRANCE_TRANSLATE_Y = 8;
const GRID_GUTTER = 16; // web gap-4

function StaggerGridItem({
  children,
  delayMs,
  reduceMotion,
}: {
  children: ReactNode;
  delayMs: number;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delayMs,
      duration: ENTRANCE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.cell,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [ENTRANCE_TRANSLATE_Y, 0],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

StaggerGridItem.displayName = 'StaggerGridItem';

function StaggerGrid({
  children,
  reduceMotion,
}: {
  children: ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const staggerMs = (reduceMotion ? 0 : STAGGER_SECONDS) * 1000;
  const items = React.Children.toArray(children);

  return (
    <View style={styles.grid}>
      {items.map((child, index) => (
        <StaggerGridItem
          key={index}
          delayMs={index * staggerMs}
          reduceMotion={reduceMotion}>
          {child}
        </StaggerGridItem>
      ))}
    </View>
  );
}

StaggerGrid.displayName = 'StaggerGrid';

// ---- Local StatCard (web @/components/data-display StatCard) -----------------
// Reproduces the web Card (rounded-lg border surface, p-4): a header row with a
// muted medium label + muted icon glyph, then a baseline bold value. Only the
// icon/label/value slots are ported; the value carries any inline unit suffix.

function StatCard({
  icon,
  label,
  value,
}: {
  icon?: string;
  label: string;
  value: string | number;
}): React.ReactElement {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
          {label}
        </AppText>
        {icon ? (
          <AppText style={styles.statIcon} tone="muted">
            {icon}
          </AppText>
        ) : null}
      </View>
      <AppText numberOfLines={1} style={styles.statValue}>
        {value}
      </AppText>
    </View>
  );
}

StatCard.displayName = 'StatCard';

// ---- Component (web L24-77) -------------------------------------------------

interface SummaryStatsProps {
  motorStats: MotorStats | null;
  toTemperatureDisplay: (v: number) => number;
  // See MotorEfficiencyInsights tempUnit comment — already includes '°'.
  tempUnit: TemperatureUnitPref;
}

export default function SummaryStats({
  motorStats,
  toTemperatureDisplay,
  tempUnit,
}: SummaryStatsProps) {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  return (
    <FadeIn reduceMotion={reduceMotion}>
      <StaggerGrid reduceMotion={reduceMotion}>
        <StatCard
          icon={TOTAL_READINGS_GLYPH}
          label={t('dynamics.totalReadings', 'Total Readings')}
          value={motorStats?.totalReadings ?? 0}
        />
        <StatCard
          icon={AVG_TORQUE_GLYPH}
          label={t('dynamics.avgTorque', 'Avg Torque')}
          value={`${fmtNumber(motorStats?.avgTorque ?? 0, 1)} Nm`}
        />
        <StatCard
          icon={PEAK_POWER_GLYPH}
          label={t('dynamics.peakPower', 'Peak Power')}
          value={`${fmtNumber(motorStats?.peakPower ?? 0, 1)} kW`}
        />
        <StatCard
          icon={PEAK_REGEN_GLYPH}
          label={t('dynamics.peakRegen', 'Peak Regen')}
          value={`${fmtNumber(motorStats?.peakRegen ?? 0, 1)} kW`}
        />
        <StatCard
          icon={AVG_POWER_GLYPH}
          label={t('dynamics.avgPower', 'Avg Power')}
          value={`${fmtNumber(motorStats?.avgPower ?? 0, 1)} kW`}
        />
        <StatCard
          icon={AVG_MOTOR_TEMP_GLYPH}
          label={t('dynamics.avgMotorTemp', 'Avg Motor Temp')}
          value={
            motorStats
              ? `${fmtNumber(toTemperatureDisplay(motorStats.avgMotorTemp), 1)}${tempUnit}`
              : '—'
          }
        />
      </StaggerGrid>
    </FadeIn>
  );
}

const STAT_CARD_PADDING = 16; // web Card p-4

const styles = StyleSheet.create({
  // web StaggerContainer `grid grid-cols-2 gap-4 …` -> a 2-column row-wrap grid;
  // the negative gutter + per-cell padding reproduce gap-4 (16) without the
  // percentage-vs-gap overflow risk.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -GRID_GUTTER / 2,
  },
  cell: {
    width: '50%',
    paddingHorizontal: GRID_GUTTER / 2,
    marginBottom: GRID_GUTTER,
  },
  // web Card (StatCard root) `rounded-lg border bg-[var(--surface-1)] p-4` with
  // the StatCard `flex flex-col gap-1`.
  statCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: STAT_CARD_PADDING,
  },
  // web header row `flex items-center justify-between`.
  statHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // web icon `text-[var(--text-muted)]` (lucide glyph stand-in).
  statIcon: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  // web label `text-sm font-medium text-[var(--text-muted)]`.
  statLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  // web value `text-2xl font-bold` (text-[var(--text-primary)] default).
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
});
