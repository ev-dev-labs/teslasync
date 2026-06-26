// Native parity port of
// web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx.
//
// Drivetrain Health — the "Live Motor Status" panel. Surfaces the latest
// /motor/latest snapshot: a four-tile summary row (shift state / power / regen /
// source) plus a nine-cell inline-metric grid (front+rear axle RPM, front+rear
// axle torque, front+rear motor / inverter / battery temperatures, and the HV
// isolation resistance). All inputs are SI on the wire (kW, Nm, °C, kΩ) and the
// temperatures are converted to the user's °C/°F preference at the display
// boundary exactly as the web panel does. When no snapshot has arrived the panel
// shows a transient, no-action empty state.
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-i18next `useTranslation` (web L1, L21) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key', 'English') call
//     keeps its English default and translation-key intent. All 15 drivetrain.*
//     keys are preserved verbatim.
//   - lucide-react Cog/Activity/Thermometer/Shield/Zap (web L2) -> the Cog panel
//     marker becomes the shared SemanticIcon 'settings' chip (lucide Settings IS a
//     cog/gear; guaranteed cross-platform render). The tiny per-metric Activity/
//     Zap/Thermometer/Shield marks become small colour-coded dots — the documented
//     "variant-coloured status dot" native idiom (PowerFlowDashboardPage precedent)
//     — because the meaningful signal each lucide mark carried here is its COLOUR
//     (front=cyan vs rear=purple; temp severity red/amber/green; and the HV
//     isolation health colour that the web computes from the resistance value),
//     while the metric TYPE is already spelled out by the adjacent label.
//   - `@/components/ui` GlassPanel (web L4) -> the existing native GlassPanel.
//   - `@/components/layout` Grid (web L5, L38) -> a flex-wrap two-column View
//     (web `cols={{ default: 2, sm: 4 }}` renders two columns at the mobile
//     default, which native targets).
//   - `@/components/data-display` InlineMetric (web L6) -> the ported native
//     parity InlineMetric (icon + value + label), one per axle/thermal/isolation
//     stat, fed the same label/value strings.
//   - `@/components/motion` FadeIn (web L7, L30, L178) -> a local Animated.View
//     mount fade reproducing the web framer-motion entry (opacity 0->1, y 12->0,
//     400ms, easeOut, `delay={0.22}`); web's prefers-reduced-motion opt-out has no
//     native analogue and is dropped (PowerProfileChart FadeIn precedent).
//   - `@/components/feedback` EmptyState (web L8, L173-175) -> the source passes a
//     message only (no title/icon/action — the web EmptyState renders just that
//     centred message), so native renders the same single centred muted message
//     rather than the shared native EmptyState, which would force an absent title.
//     The web "no-action: transient empty state" comment is preserved below.
//   - `@/hooks/useUnits` useUnits + `@/lib/unitConversion` convertTempFromSI +
//     `@/lib/numberFormat` fmtNumber/fmtInt (web L9, L10, L13, L22-25) ->
//     useFormatPrefs() + convertTempFromSI() from the shared native format
//     primitives: tempUnit mirrors unitPrefs.temperature ('°C'/'°F'); fmt(v)
//     mirrors fmtNumber (settings-derived global precision) and fmt(v, 0) mirrors
//     fmtInt; convertTempFromSI(c, tempUnit) is the same SI->display conversion.
//   - `MotorSnapshot` (web L12) -> imported from the ported native web-parity
//     api/types (identical snake_case wire shape).
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, lucide-react or
// react-i18next are imported — only react, react-native primitives, the existing
// apps/native SemanticIcon / AppText / GlassPanel / theme tokens, the ported
// web-parity InlineMetric and the shared native format primitives.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {MotorSnapshot} from '../../../../api/types';
import {InlineMetric} from '../../../../components/data-display/InlineMetric';
import {
  convertTempFromSI,
  useFormatPrefs,
} from '../../../../components/data-display/format/_formatPrimitives';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  isolationResistance?: number | null;
}

/** Em-dash placeholder for unrenderable values (web `'—'`, U+2014). */
const DASH = '\u2014';

/** FadeIn entry timing — mirrors web framer-motion FadeIn duration + delay. */
const FADE_DURATION_MS = 400;
const FADE_DELAY_S = 0.22;

// Web Tailwind text colours mapped to the nearest native theme token. These are
// the colour-coded signals the per-metric lucide icons carried on the web.
const CYAN = colors.accent; // text-cyan-400 (front axle)
const PURPLE = colors.violet; // text-purple-400 (rear axle)
const RED = colors.danger; // text-red-400 (motor temperatures)
const AMBER = colors.warning; // text-amber-400 (inverter temperature)
const GREEN = colors.success; // text-green-400 (regen / battery temperature)

/**
 * Inlined react-i18next fallback: returns the web English fallback copy verbatim,
 * matching the other native parity ports (AddressInput / WhyEndedPanel).
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

/**
 * Colour-coded status dot replacing a tiny per-metric lucide mark. Decorative —
 * the adjacent InlineMetric label conveys the metric type; the colour conveys the
 * web signal (axle, temperature severity, isolation health).
 */
function MetricDot({color}: {color: string}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.metricDot, {color}]}>
      {'\u25CF'}
    </AppText>
  );
}

/** A single summary tile (shift state / power / regen / source). */
function StatTile({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <View style={styles.tile}>
      <AppText style={styles.tileLabel} tone="muted">
        {label}
      </AppText>
      <AppText style={[styles.tileValue, {color: valueColor}]} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

export function LiveMotorStatus({
  motorLatest,
  isolationResistance,
}: LiveMotorStatusProps) {
  const t = useNativeTranslation();
  const {tempUnit, fmt} = useFormatPrefs();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, tempUnit);

  const hasData = motorLatest != null;

  // HV isolation health colour, mirroring the web Shield className ternary:
  // null/<=0 -> muted; >=500 -> green; >=100 -> amber; otherwise red.
  const isolationColor =
    isolationResistance == null || isolationResistance <= 0
      ? colors.textMuted
      : isolationResistance >= 500
      ? GREEN
      : isolationResistance >= 100
      ? AMBER
      : RED;

  return (
    <FadeIn delay={FADE_DELAY_S}>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <SemanticIcon decorative name="settings" size="sm" />
          <AppText style={styles.headerTitle} tone="muted">
            {t('drivetrain.liveMotor', 'Live Motor Status')}
          </AppText>
        </View>

        {hasData ? (
          <>
            <View style={styles.tileGrid}>
              <StatTile
                label={t('drivetrain.shiftState', 'Shift State')}
                value={motorLatest.shift_state ?? DASH}
                valueColor={CYAN}
              />
              <StatTile
                label={t('drivetrain.power', 'Power')}
                value={
                  motorLatest.power_kw != null
                    ? `${fmt(motorLatest.power_kw)} kW`
                    : DASH
                }
                valueColor={PURPLE}
              />
              <StatTile
                label={t('drivetrain.regen', 'Regen')}
                value={
                  motorLatest.regen_kw != null
                    ? `${fmt(motorLatest.regen_kw)} kW`
                    : DASH
                }
                valueColor={GREEN}
              />
              <StatTile
                label={t('drivetrain.source', 'Source')}
                value={motorLatest.source ?? DASH}
                valueColor={colors.textPrimary}
              />
            </View>

            <View style={styles.metricGrid}>
              <InlineMetric
                icon={<MetricDot color={CYAN} />}
                label={t('drivetrain.rpmFront', 'Front Motor RPM')}
                style={styles.metricItem}
                value={
                  motorLatest.motor_rpm_front != null
                    ? `${fmt(motorLatest.motor_rpm_front, 0)} RPM`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={PURPLE} />}
                label={t('drivetrain.rpmRear', 'Rear Motor RPM')}
                style={styles.metricItem}
                value={
                  motorLatest.motor_rpm_rear != null
                    ? `${fmt(motorLatest.motor_rpm_rear, 0)} RPM`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={CYAN} />}
                label={t('drivetrain.torqueFront', 'Front Torque')}
                style={styles.metricItem}
                value={
                  motorLatest.torque_nm_front != null
                    ? `${fmt(motorLatest.torque_nm_front)} Nm`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={PURPLE} />}
                label={t('drivetrain.torqueRear', 'Rear Torque')}
                style={styles.metricItem}
                value={
                  motorLatest.torque_nm_rear != null
                    ? `${fmt(motorLatest.torque_nm_rear)} Nm`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={RED} />}
                label={t('drivetrain.motorTempFront', 'Front Motor Temp')}
                style={styles.metricItem}
                value={
                  motorLatest.motor_temp_c_front != null
                    ? `${fmt(toTemperatureDisplay(motorLatest.motor_temp_c_front))} ${tempUnit}`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={RED} />}
                label={t('drivetrain.motorTempRear', 'Rear Motor Temp')}
                style={styles.metricItem}
                value={
                  motorLatest.motor_temp_c_rear != null
                    ? `${fmt(toTemperatureDisplay(motorLatest.motor_temp_c_rear))} ${tempUnit}`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={AMBER} />}
                label={t('drivetrain.inverterTemp', 'Inverter Temp')}
                style={styles.metricItem}
                value={
                  motorLatest.inverter_temp_c != null
                    ? `${fmt(toTemperatureDisplay(motorLatest.inverter_temp_c))} ${tempUnit}`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={GREEN} />}
                label={t('drivetrain.batteryTemp', 'Battery Temp')}
                style={styles.metricItem}
                value={
                  motorLatest.battery_temp_c != null
                    ? `${fmt(toTemperatureDisplay(motorLatest.battery_temp_c))} ${tempUnit}`
                    : DASH
                }
              />
              <InlineMetric
                icon={<MetricDot color={isolationColor} />}
                label={t('drivetrain.isolationResistance', 'HV Isolation')}
                style={styles.metricItem}
                value={
                  isolationResistance != null && isolationResistance > 0
                    ? `${fmt(isolationResistance)} k\u03A9`
                    : DASH
                }
              />
            </View>
          </>
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <View style={styles.emptyState}>
            <AppText style={styles.emptyText} tone="muted">
              {t('drivetrain.noLiveMotor', 'No live motor telemetry yet')}
            </AppText>
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 1,
    lineHeight: 18,
    textTransform: 'uppercase',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
    width: '48%',
  },
  tileLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  tileValue: {
    fontSize: 18,
    lineHeight: 24,
    marginTop: 2,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    rowGap: spacing.md,
  },
  metricItem: {
    width: '48%',
  },
  metricDot: {
    fontSize: 10,
    lineHeight: 14,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
});

export default LiveMotorStatus;
