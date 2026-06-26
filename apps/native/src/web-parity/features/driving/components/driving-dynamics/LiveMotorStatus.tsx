// Native parity port of
// web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx.
//
// The web component is the driving-dynamics "Live Motor Status" panel: a FadeIn
// wrapping a GlassPanel (p-6) with an h2 heading and, when `motorLatest` is
// present, a 2-up (md:4-up) Grid of four cells — three RadialGauges (total
// Torque in Nm, Front RPM, peak Motor temperature in the user's unit) each with
// a caption below, plus a Shift-State cell rendering a Badge (success when the
// gear is 'D', else neutral) with a Cog icon. When `motorLatest` is null the
// panel shows an EmptyState message instead.
//
// Native adaptations (each documented in the .parity.json sidecar):
//   - react-i18next `useTranslation` (web L1) -> local native-safe
//     `useNativeTranslation()` returning t(key, fallback) = fallback (the
//     established DriveTimeline / TorqueHistoryChart convention); every i18n key
//     + English default is preserved verbatim.
//   - lucide-react `Cog` (web L2) -> GEAR_GLYPH '\u2699\uFE0E' (a gear glyph with
//     the text-presentation variation selector so it inherits the badge text
//     colour like the web icon's stroke=currentColor) — no DOM SVG icon.
//   - `@/components/layout` Grid cols={{default:2, md:4}} gap=6 (web L4) -> a
//     native flex-wrap two-column grid (the phone base breakpoint == web
//     `default: 2`) with a 24px (gap-6) gutter via negative-margin/padding.
//   - `@/components/ui` GlassPanel (web L5) -> native GlassPanel; Badge (web L5)
//     -> a local native pill mirroring the web success/neutral variants + lg
//     size (rounded-full, coloured surface/border/text).
//   - `@/components/charts` RadialGauge (web L6) -> the native charts-barrel
//     RadialGauge parity export (same value/max/label/unit/color/size props).
//   - `@/components/feedback` EmptyState (web L7) -> a local native-safe
//     message-only EmptyState (the AnomalyDashboardPage convention).
//   - `@/components/motion` FadeIn (web L8) -> a native Animated fade/translate
//     entry honouring AccessibilityInfo reduce-motion (the established
//     DriveTimeline / TorqueHistoryChart convention).
//   - `@/lib/numberFormat` fmtNumber (web L9) -> a local locale-aware fmtNumber
//     (default precision 2) ported from web/src/lib/numberFormat.ts.
//   - `@/api/types` MotorSnapshot (web L10) -> imported from the already-ported
//     native web-parity api/types to keep the type faithful.
//   - `@/lib/unitConversion` TemperatureUnitPref (web L11) -> the consumed union
//     '\u00b0C' | '\u00b0F' is mirrored locally (native unitConversion lib not
//     yet ported), matching the MoreDetailsPanel / useDriveDetailData convention.
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

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
} from 'react-native';

import {RadialGauge} from '../../../../components/charts';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {MotorSnapshot} from '../../../../api/types';

/* ── consumed type: @/lib/unitConversion TemperatureUnitPref (web L11) ─────── */
// '\u00b0C' | '\u00b0F' — already includes the degree sign (web L16 comment).
type TemperatureUnitPref = '\u00b0C' | '\u00b0F';

interface LiveMotorStatusProps {
  motorLatest: MotorSnapshot | null | undefined;
  toTemperatureDisplay: (v: number) => number;
  // See MotorEfficiencyInsights tempUnit comment — already includes '°'.
  tempUnit: TemperatureUnitPref;
}

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

/* ── ported number formatter (web @/lib/numberFormat) ──────────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtNumber — locale-aware, default precision 2 (web/src/lib/numberFormat.ts). */
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

/* ── reduce-motion preference (drives the FadeIn entry animation) ──────────── */

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

/* ── FadeIn (native-safe port of @/components/motion framer-motion entry) ──── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
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
      duration: 400,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

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

/* ── EmptyState (native-safe port of @/components/feedback EmptyState) ─────── */

function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.caption} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ── Badge (native-safe port of @/components/ui Badge, success/neutral, lg) ── */

// lucide-react `Cog` -> gear glyph with the text-presentation variation
// selector so it inherits the badge text colour (web icon stroke=currentColor).
const GEAR_GLYPH = '\u2699\uFE0E';

function Badge({
  variant,
  icon,
  label,
}: {
  variant: 'success' | 'neutral';
  icon: string;
  label: string;
}) {
  const isSuccess = variant === 'success';
  const textStyle = isSuccess ? styles.badgeTextSuccess : styles.badgeTextNeutral;

  return (
    <View style={[styles.badge, isSuccess ? styles.badgeSuccess : styles.badgeNeutral]}>
      <AppText style={[styles.badgeIcon, textStyle]} weight="semibold">
        {icon}
      </AppText>
      <AppText style={textStyle} weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

// Web RadialGauge `color` props (text-blue / purple / amber 500 swatches).
const TORQUE_COLOR = '#3b82f6';
const RPM_COLOR = '#a855f7';
const TEMP_COLOR = '#f59e0b';
const GAUGE_SIZE = 120;

export default function LiveMotorStatus({
  motorLatest,
  toTemperatureDisplay,
  tempUnit,
}: LiveMotorStatusProps) {
  const t = useNativeTranslation();

  const torqueTotal = motorLatest
    ? (motorLatest.torque_nm_front ?? 0) + (motorLatest.torque_nm_rear ?? 0)
    : 0;
  const rpmFront = motorLatest?.motor_rpm_front ?? 0;
  const motorTempC = motorLatest
    ? Math.max(
        motorLatest.motor_temp_c_front ?? -Infinity,
        motorLatest.motor_temp_c_rear ?? -Infinity,
      )
    : null;
  const motorTempDisplay =
    motorTempC != null && Number.isFinite(motorTempC)
      ? toTemperatureDisplay(motorTempC)
      : 0;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.heading} variant="title" weight="semibold">
          {t('dynamics.liveMotor', 'Live Motor Status')}
        </AppText>
        {motorLatest ? (
          <View style={styles.grid}>
            <View style={styles.cell}>
              <View style={styles.cellInner}>
                <RadialGauge
                  value={torqueTotal}
                  max={1000}
                  label={t('dynamics.torque', 'Torque')}
                  unit="Nm"
                  color={TORQUE_COLOR}
                  size={GAUGE_SIZE}
                />
                <AppText style={styles.caption} tone="secondary" variant="caption">
                  {`${fmtNumber(torqueTotal)} Nm`}
                </AppText>
              </View>
            </View>
            <View style={styles.cell}>
              <View style={styles.cellInner}>
                <RadialGauge
                  value={rpmFront}
                  max={18000}
                  label={t('dynamics.rpmFront', 'Front RPM')}
                  unit="RPM"
                  color={RPM_COLOR}
                  size={GAUGE_SIZE}
                />
                <AppText style={styles.caption} tone="secondary" variant="caption">
                  {`${fmtNumber(rpmFront, 0)} RPM`}
                </AppText>
              </View>
            </View>
            <View style={styles.cell}>
              <View style={styles.cellInner}>
                <RadialGauge
                  value={motorTempDisplay}
                  max={200}
                  label={t('dynamics.motorTemp', 'Motor')}
                  unit={tempUnit}
                  color={TEMP_COLOR}
                  size={GAUGE_SIZE}
                />
                <AppText style={styles.caption} tone="secondary" variant="caption">
                  {motorTempC != null && Number.isFinite(motorTempC)
                    ? `${fmtNumber(toTemperatureDisplay(motorTempC), 1)}${tempUnit}`
                    : t('dynamics.awaiting', 'Awaiting data')}
                </AppText>
              </View>
            </View>
            <View style={styles.cell}>
              <View style={styles.cellInnerShift}>
                <View style={styles.shiftBox}>
                  <Badge
                    variant={motorLatest.shift_state === 'D' ? 'success' : 'neutral'}
                    icon={GEAR_GLYPH}
                    label={motorLatest.shift_state ?? t('dynamics.unknown', 'Unknown')}
                  />
                </View>
                <AppText style={styles.caption} tone="secondary" variant="caption">
                  {t('dynamics.shiftState', 'Shift State')}
                </AppText>
              </View>
            </View>
          </View>
        ) : (
          <EmptyState
            message={t('dynamics.noLiveMotor', 'Awaiting live motor data')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs, // gap-1 (4px)
    paddingHorizontal: spacing.sm + 2, // px-2.5 (10px)
    paddingVertical: spacing.xs, // py-1 (4px)
  },
  badgeIcon: {
    marginRight: spacing.xs, // mr-1 (4px)
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  badgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  badgeTextNeutral: {
    color: colors.textSecondary,
  },
  badgeTextSuccess: {
    color: colors.success,
  },
  caption: {
    textAlign: 'center',
  },
  cell: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    width: '50%',
  },
  cellInner: {
    alignItems: 'center',
    gap: spacing.sm, // gap-2 (8px)
  },
  cellInnerShift: {
    alignItems: 'center',
    gap: spacing.md, // gap-3 (12px)
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.md, // counter the per-cell gutter (gap-6 == 24px)
  },
  heading: {
    marginBottom: spacing.md + 4, // mb-4 (16px)
  },
  panel: {
    padding: spacing.lg + 4, // p-6 (24px)
  },
  shiftBox: {
    alignItems: 'center',
    height: GAUGE_SIZE,
    justifyContent: 'center',
    width: GAUGE_SIZE,
  },
});
