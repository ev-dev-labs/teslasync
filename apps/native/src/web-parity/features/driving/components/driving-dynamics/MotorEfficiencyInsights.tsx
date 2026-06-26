// Native parity port of
// web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx.
//
// Driving Dynamics — the "Motor Efficiency Insights" row: a three-panel summary
// (Torque Distribution / Throttle Behavior / Motor Thermal) computed from the
// already-derived MotorStats + ThrottleStyle. Each panel renders its metric rows
// or, when motorStats is null, the same transient no-action empty state. Motor
// temperatures arrive in SI °C and are converted to the user's display preference
// by the caller-supplied toTemperatureDisplay() before formatting — the tempUnit
// string already includes the degree symbol so it is appended raw (never prefixed
// with another '°').
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-i18next `useTranslation` (web L1) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key','English') call
//     keeps its English default + translation-key intent. All 17 dynamics.* keys
//     are preserved verbatim (the AutopilotSection / LiveMotorStatus pattern).
//   - lucide-react Zap/Gauge/Thermometer/Activity (web L2) -> the shared native
//     SemanticIcon: Zap (Torque) -> name='bolt', Gauge (Throttle) -> name='speed'
//     (the AutopilotSection Gauge->'speed' precedent), Thermometer (Thermal) ->
//     name='climate' (the temperature/HVAC semantic chip), Activity (empty state)
//     -> name='activity'; all decorative because the adjacent title/label already
//     names the metric (the DriveTelemetryWidget lucide -> SemanticIcon precedent).
//   - `@/components/layout` Grid (cols={{default:1,md:3}} gap={4}) (web L4) -> a
//     vertical View stack (styles.grid: flexDirection column, gap spacing.md): the
//     mobile `default: 1` column is what native targets, so the three panels stack
//     (the AutopilotSection/LiveMotorStatus "render the mobile default" approach).
//   - `@/components/ui` GlassPanel (web L5) -> the existing native GlassPanel,
//     <GlassPanel style={styles.panel}> with padding spacing.lg (web p-5).
//   - `@/components/ui` Badge (variant/size, web L5) -> an inline native Badge
//     (success/warning/danger pill) — the native tree has no shared Badge, so this
//     mirrors the SchemaDriftPage inline-Badge precedent; size is always 'sm'.
//   - `@/components/data-display` MetricBar (web L6) -> the ported native parity
//     MetricBar (the Animated width fill); the empty `label`/`sublabel` `??`
//     suppression policy is preserved verbatim (intentional "" hides the readout).
//   - `@/components/feedback` EmptyState (icon + message) (web L7) -> the web
//     EmptyState with no title renders just the centred icon + message, so native
//     renders the same centred SemanticIcon('activity') + muted AppText rather than
//     the shared native EmptyState (which mandates a title). The web "no-action"
//     comment is preserved.
//   - `@/components/motion` FadeIn (delay={0.35}) (web L8) -> a local FadeIn =
//     Animated.View mount fade reproducing the web framer-motion entry (opacity
//     0->1, translateY 12->0, 400ms easeOut, delay 0.35s). Web's
//     prefers-reduced-motion opt-out has no native analogue and is dropped
//     (PowerProfileChart / AutopilotSection FadeIn precedent).
//   - `@/lib/numberFormat` fmtNumber (web L9) -> useFormatPrefs().fmt: fmt(v, 1)
//     mirrors fmtNumber(v, 1) (locale-aware, 1 decimal).
//   - `./helpers` MotorStats / ThrottleStyle (web L10) -> the type definitions are
//     ported verbatim here (the native ./helpers is not present in this tree; this
//     file imports them as `import type` only, so the structural types are inlined).
//   - `@/lib/unitConversion` TemperatureUnitPref (web L11) -> the structurally
//     identical TempUnit ('°C' | '°F') from the shared native format primitives,
//     aliased as TemperatureUnitPref to preserve the web prop type name + intent.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, lucide-react or
// react-i18next are imported — only react, react-native primitives, the existing
// apps/native SemanticIcon / AppText / GlassPanel / theme tokens, and the ported
// web-parity MetricBar + format primitives.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {MetricBar} from '../../../../components/data-display/MetricBar';
import {
  useFormatPrefs,
  type TempUnit,
} from '../../../../components/data-display/format/_formatPrimitives';

// Ported verbatim from web ./helpers (imported there as `import type`). The native
// ./helpers is not present in this tree, so the structural types are inlined.
type ThrottleStyle = 'conservative' | 'moderate' | 'aggressive';

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

// web @/lib/unitConversion TemperatureUnitPref -> the structurally identical native
// TempUnit. Aliased to keep the web prop type name + the degree-symbol contract.
type TemperatureUnitPref = TempUnit;

interface MotorEfficiencyInsightsProps {
  motorStats: MotorStats | null;
  throttleStyle: ThrottleStyle | null;
  toTemperatureDisplay: (v: number) => number;
  // tempUnit is the user's display preference (e.g. '°C' or '°F'). The
  // value already INCLUDES the degree symbol — never prefix another '°'
  // (that produces "49.0°°C", which was a real bug). Type is narrowed
  // from `string` to TemperatureUnitPref so callers can't pass a bare
  // "C"/"F" and reintroduce the bug.
  tempUnit: TemperatureUnitPref;
}

/** Badge variants used by this panel (web @/components/ui Badge). */
type BadgeVariant = 'success' | 'warning' | 'danger';

/** Monospace family for the font-mono value readouts. */
const MONO = Platform.select({ios: 'Courier', default: 'monospace'});

/** FadeIn entry timing — mirrors web framer-motion FadeIn duration + delay. */
const FADE_DURATION_MS = 400;
const FADE_DELAY_S = 0.35;

/**
 * Inlined react-i18next fallback: returns the web English fallback copy verbatim,
 * matching the other native parity ports (AutopilotSection / LiveMotorStatus).
 */
function useNativeTranslation(): (key: string, fallback: string) => string {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * `@/components/motion` FadeIn -> Animated.View mount fade reproducing the web
 * framer-motion entry: opacity 0->1, translateY 12->0, 400ms easeOut, after the
 * caller-supplied `delay` (seconds, like the web prop).
 */
function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/** `@/components/ui` Badge -> inline success/warning/danger pill (size 'sm'). */
function Badge({label, variant}: {label: string; variant: BadgeVariant}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]} weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/** A label + mono value row (web `flex justify-between` + `font-mono`). */
function StatRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.row}>
      <AppText style={styles.rowLabel} tone="secondary">
        {label}
      </AppText>
      <AppText style={styles.rowValue} tone="secondary">
        {value}
      </AppText>
    </View>
  );
}

export default function MotorEfficiencyInsights({
  motorStats,
  throttleStyle,
  toTemperatureDisplay,
  tempUnit,
}: MotorEfficiencyInsightsProps) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();

  const noData = (
    // no-action: transient empty state — surfaces when source data is missing;
    // no specific recovery action available.
    <View style={styles.emptyState}>
      <SemanticIcon decorative name="activity" size="md" style={styles.emptyIcon} />
      <AppText style={styles.emptyText} tone="muted">
        {t('dynamics.noMotorData', 'No motor data recorded yet')}
      </AppText>
    </View>
  );

  const throttleVariant: BadgeVariant =
    throttleStyle === 'conservative'
      ? 'success'
      : throttleStyle === 'moderate'
        ? 'warning'
        : 'danger';
  const throttleLabel =
    throttleStyle === 'conservative'
      ? t('dynamics.conservative', 'Conservative')
      : throttleStyle === 'moderate'
        ? t('dynamics.moderate', 'Moderate')
        : t('dynamics.aggressive', 'Aggressive');
  const throttleColor =
    throttleStyle === 'conservative'
      ? '#22c55e'
      : throttleStyle === 'moderate'
        ? '#eab308'
        : '#ef4444';

  return (
    <FadeIn delay={FADE_DELAY_S}>
      <View style={styles.grid}>
        {/* Torque Distribution */}
        <GlassPanel style={styles.panel}>
          <View style={styles.panelHeader}>
            <SemanticIcon decorative name="bolt" size="sm" />
            <AppText style={styles.panelTitle} weight="semibold">
              {t('dynamics.torqueDistribution', 'Torque Distribution')}
            </AppText>
          </View>
          {motorStats ? (
            <View style={styles.rowsSm}>
              <StatRow
                label={t('dynamics.avgTorque', 'Avg Torque')}
                value={`${fmt(motorStats.avgTorque, 1)} Nm`}
              />
              <StatRow
                label={t('dynamics.maxTorque', 'Max Torque')}
                value={`${fmt(motorStats.maxTorque, 1)} Nm`}
              />
              <StatRow
                label={t('dynamics.highTorqueTime', 'High Torque Time')}
                value={`${fmt(motorStats.highTorquePct, 1)}%`}
              />
            </View>
          ) : (
            noData
          )}
        </GlassPanel>

        {/* Throttle Behavior */}
        <GlassPanel style={styles.panel}>
          <View style={styles.panelHeader}>
            <SemanticIcon decorative name="speed" size="sm" />
            <AppText style={styles.panelTitle} weight="semibold">
              {t('dynamics.throttleBehavior', 'Throttle Behavior')}
            </AppText>
          </View>
          {motorStats ? (
            <View style={styles.rowsMd}>
              <StatRow
                label={t('dynamics.avgPower', 'Avg Power')}
                value={`${fmt(motorStats.avgPower, 1)} kW`}
              />
              <View style={styles.row}>
                <AppText style={styles.rowLabel} tone="secondary">
                  {t('dynamics.drivingStyle', 'Style')}
                </AppText>
                <Badge label={throttleLabel} variant={throttleVariant} />
              </View>
              <MetricBar
                value={motorStats.avgPower}
                max={200}
                color={throttleColor}
                label=""
                // Empty string explicitly suppresses the textual readout
                // beside the bar (the same number is already rendered as
                // "Avg Power" above). MetricBar uses `??` so this is
                // honoured — passing `||` previously fell through to
                // `fmtNumber(value)` and rendered a stray "0.00".
                sublabel=""
              />
            </View>
          ) : (
            noData
          )}
        </GlassPanel>

        {/* Motor Thermal */}
        <GlassPanel style={styles.panel}>
          <View style={styles.panelHeader}>
            <SemanticIcon decorative name="climate" size="sm" />
            <AppText style={styles.panelTitle} weight="semibold">
              {t('dynamics.motorThermal', 'Motor Thermal')}
            </AppText>
          </View>
          {motorStats ? (
            <View style={styles.rowsMd}>
              <StatRow
                label={t('dynamics.avgMotorTemp', 'Avg Motor Temp')}
                value={`${fmt(toTemperatureDisplay(motorStats.avgMotorTemp), 1)}${tempUnit}`}
              />
              <StatRow
                label={t('dynamics.maxMotorTemp', 'Max Motor Temp')}
                value={`${fmt(toTemperatureDisplay(motorStats.maxMotorTemp), 1)}${tempUnit}`}
              />
              <Badge
                label={
                  motorStats.maxMotorTemp < 100
                    ? t('dynamics.thermalGood', 'Thermal: Good')
                    : motorStats.maxMotorTemp < 140
                      ? t('dynamics.thermalWarm', 'Thermal: Warm')
                      : t('dynamics.thermalHot', 'Thermal: Hot')
                }
                variant={
                  motorStats.maxMotorTemp < 100
                    ? 'success'
                    : motorStats.maxMotorTemp < 140
                      ? 'warning'
                      : 'danger'
                }
              />
            </View>
          ) : (
            noData
          )}
        </GlassPanel>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  panel: {
    padding: spacing.lg,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  rowsSm: {
    gap: spacing.sm,
  },
  rowsMd: {
    gap: spacing.md,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 14,
  },
  rowValue: {
    fontFamily: MONO,
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
});
