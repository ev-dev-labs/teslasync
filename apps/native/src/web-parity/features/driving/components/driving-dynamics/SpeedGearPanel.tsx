// Native parity port of
// web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx.
//
// The web panel (inside a `FadeIn` delayed 0.15s) renders a glass card titled
// "Speed & Gear" over a responsive 2-up / md:4-up grid of four centred stat
// cells: (1) the current shift state as a 5xl letter colour-coded by gear with a
// success/danger/warning/neutral "Shift State" Badge beneath it; (2) Motor Power
// in kW from `motorLatest.power_kw`; (3) Avg Drive Speed and (4) Top Drive Speed,
// both reduced from `filteredDrives` in SI (m/s) and converted ONCE via
// `toSpeedDisplay` at the render site. The web file's double-conversion fix is
// preserved verbatim: the aggregates stay in m/s and `toSpeedDisplay` is applied
// only in the JSX, never eagerly during the reduce/Math.max.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next useTranslation -> useNativeTranslation() shim returning the
//     fallback copy verbatim; every web t() key + default string is preserved.
//   - `@/components/layout` Grid (CSS `grid-cols-2 md:grid-cols-4 gap-6`) -> an
//     inline native Grid that measures its width via onLayout, resolves the
//     column count from the same Tailwind breakpoints (default 2, md>=768 -> 4)
//     and lays cells out with an explicit pixel width + 24px gap (the same proven
//     port as the sibling TemperatureGauges).
//   - `@/components/ui` GlassPanel -> the native parity components/ui/GlassPanel;
//     the web `className="p-6"` padding becomes RN style padding 24.
//   - `@/components/ui` Badge (rounded chip, size="sm") -> an inline native Badge
//     pill (tinted bg/border/text from the success/danger/warning tokens; neutral
//     -> surfaceRaised/border/textSecondary). size="sm" px-1.5/py-0.5/text-xs ->
//     paddingHorizontal 6 / paddingVertical 2 / fontSize 12, rounded-full -> 999.
//   - `@/components/motion` FadeIn (framer-motion, browser-only) -> an inline
//     native Animated FadeIn (opacity 0->1 + slide-up 12->0, reduce-motion-aware
//     via AccessibilityInfo) honouring the web `delay={0.15}` (seconds -> ms).
//   - `@/lib/numberFormat` fmtNumber -> inlined native-safe formatter mirroring
//     the web module (locale-aware toLocaleString, precision-2 / en-US defaults).
//   - `@/lib/cn` cn() -> dropped; the merged Tailwind class strings collapse into
//     static RN styles, the dynamic per-gear shift colour applied inline.
//   - `@/api/types` MotorSnapshot + `@/types/driving` Drive -> imported from the
//     native parity api/types + api/hooks/useDriving modules (same field shapes).

import {
  Children,
  isValidElement,
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
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import type {Drive} from '../../../../api/hooks/useDriving';
import type {MotorSnapshot} from '../../../../api/types';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

// Web `FadeIn` default entrance duration (useMotionPreference(400)).
const FADE_DURATION_MS = 400;

// Mirrors the StatCard / TemperatureGauges reduce-motion source-of-truth.
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

// Native parity for `@/components/motion` FadeIn: fades + slides children up on
// mount after `delay` seconds. Reduce-motion renders the final state immediately.
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
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

/* ─── native number formatter (web `@/lib/numberFormat`) ────────────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

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

/* ─── native Grid (web `@/components/layout` Grid) ──────────────────────────── */

interface GridCols {
  default?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

// Tailwind responsive breakpoints (px) used to resolve the active column count.
const SM_BREAKPOINT = 640;
const MD_BREAKPOINT = 768;
const LG_BREAKPOINT = 1024;
const XL_BREAKPOINT = 1280;
// Tailwind spacing scale: gap-N -> N * 4px (gap-6 -> 24).
const TAILWIND_GAP_PX = 4;

function resolveColumns(cols: GridCols, width: number): number {
  let columns = cols.default ?? 1;
  if (cols.sm != null && width >= SM_BREAKPOINT) {
    columns = cols.sm;
  }
  if (cols.md != null && width >= MD_BREAKPOINT) {
    columns = cols.md;
  }
  if (cols.lg != null && width >= LG_BREAKPOINT) {
    columns = cols.lg;
  }
  if (cols.xl != null && width >= XL_BREAKPOINT) {
    columns = cols.xl;
  }
  return Math.max(1, columns);
}

function Grid({
  cols = {default: 1},
  gap = 4,
  children,
}: {
  cols?: GridCols;
  gap?: number;
  children: ReactNode;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const gapPx = gap * TAILWIND_GAP_PX;
  const columns = resolveColumns(cols, containerWidth);
  const cells = Children.toArray(children);
  const cellWidth =
    containerWidth > 0
      ? Math.floor((containerWidth - gapPx * (columns - 1)) / columns)
      : null;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setContainerWidth(prev => (Math.abs(prev - next) > 0.5 ? next : prev));
  };

  return (
    <View onLayout={onLayout} style={[styles.grid, {gap: gapPx}]}>
      {cells.map((child, index) => {
        const key =
          isValidElement(child) && child.key != null
            ? child.key
            : `grid-cell-${index}`;
        return (
          <View
            key={key}
            style={cellWidth != null ? {width: cellWidth} : styles.cellFull}>
            {child}
          </View>
        );
      })}
    </View>
  );
}

/* ─── inlined gear helpers (web shiftColor + shiftBadgeVariant) ─────────────── */

// Tailwind text-emerald-400 / text-red-400 / text-yellow-400 hex literals; P and
// the default fall through to the --text-muted / --text-secondary CSS vars.
const SHIFT_COLOR_DRIVE = '#34d399';
const SHIFT_COLOR_REVERSE = '#f87171';
const SHIFT_COLOR_NEUTRAL = '#facc15';

function shiftColor(shift: string | null | undefined): string {
  switch (shift) {
    case 'D':
      return SHIFT_COLOR_DRIVE;
    case 'R':
      return SHIFT_COLOR_REVERSE;
    case 'N':
      return SHIFT_COLOR_NEUTRAL;
    case 'P':
      return colors.textMuted;
    default:
      return colors.textSecondary;
  }
}

type BadgeVariant = 'success' | 'danger' | 'warning' | 'neutral';

function shiftBadgeVariant(shift: string | null | undefined): BadgeVariant {
  switch (shift) {
    case 'D':
      return 'success';
    case 'R':
      return 'danger';
    case 'N':
      return 'warning';
    default:
      return 'neutral';
  }
}

/* ─── inlined Badge (web `@/components/ui` Badge, size="sm") ────────────────── */

const BADGE_TINTS: Record<
  BadgeVariant,
  {background: string; border: string; text: string}
> = {
  success: {
    background: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  danger: {
    background: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
  warning: {
    background: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
  neutral: {
    background: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
};

function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: BadgeVariant;
}) {
  const tint = BADGE_TINTS[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tint.background, borderColor: tint.border},
      ]}>
      <AppText style={[styles.badgeText, {color: tint.text}]}>{children}</AppText>
    </View>
  );
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface SpeedGearPanelProps {
  motorLatest: MotorSnapshot | null | undefined;
  filteredDrives: Drive[];
  toSpeedDisplay: (v: number) => number;
  speedUnit: string;
}

export default function SpeedGearPanel({
  motorLatest,
  filteredDrives,
  toSpeedDisplay,
  speedUnit,
}: SpeedGearPanelProps) {
  const t = useNativeTranslation();

  // Compute drive-level aggregates in SI (m/s) and convert ONCE at render
  // time. The pre-fix code called `toSpeedDisplay` once during the
  // reduce/Math.max AND a second time at the JSX render site, which
  // double-applied the m/s → mph factor (×2.237 squared = ×5.005). For
  // mph users that turned a real ~31 mph top into a displayed "154 mph";
  // for km/h users it was even worse (×3.6 → ×12.96). The bug shipped
  // since this panel was extracted from the legacy DrivingDynamicsPage,
  // because the surrounding code had already moved to "convert at the
  // boundary" semantics but these two reductions kept the legacy "convert
  // eagerly, render verbatim" assumption from the old in-line code.
  const avgDriveSpeedMps =
    filteredDrives.length > 0
      ? filteredDrives.reduce((s, d) => s + (d.avgSpeedMps ?? 0), 0) /
        filteredDrives.length
      : null;

  const topDriveSpeedMps =
    filteredDrives.length > 0
      ? Math.max(...filteredDrives.map(d => d.maxSpeedMps ?? 0))
      : null;

  return (
    <FadeIn delay={0.15}>
      <GlassPanel style={styles.panel}>
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('dynamics.speedGear', 'Speed & Gear')}
        </AppText>
        <Grid cols={{default: 2, md: 4}} gap={6}>
          <View style={styles.shiftCell}>
            <AppText
              style={[
                styles.shiftValue,
                {color: shiftColor(motorLatest?.shift_state)},
              ]}>
              {motorLatest?.shift_state ?? '—'}
            </AppText>
            <Badge variant={shiftBadgeVariant(motorLatest?.shift_state)}>
              {t('dynamics.shiftState', 'Shift State')}
            </Badge>
          </View>
          <View style={styles.statCell}>
            <AppText style={styles.statLabel} tone="secondary">
              {t('dynamics.power', 'Motor Power')}
            </AppText>
            <AppText style={styles.statValue}>
              {motorLatest?.power_kw != null
                ? fmtNumber(motorLatest.power_kw)
                : '—'}
            </AppText>
            <AppText style={styles.statUnit} tone="muted">
              kW
            </AppText>
          </View>
          <View style={styles.statCell}>
            <AppText style={styles.statLabel} tone="secondary">
              {t('dynamics.avgDriveSpeed', 'Avg Drive Speed')}
            </AppText>
            <AppText style={styles.statValue}>
              {avgDriveSpeedMps != null
                ? fmtNumber(toSpeedDisplay(avgDriveSpeedMps), 0)
                : '—'}
            </AppText>
            <AppText style={styles.statUnit} tone="muted">
              {speedUnit}
            </AppText>
          </View>
          <View style={styles.statCell}>
            <AppText style={styles.statLabel} tone="secondary">
              {t('dynamics.topDriveSpeed', 'Top Drive Speed')}
            </AppText>
            <AppText style={styles.statValue}>
              {topDriveSpeedMps != null
                ? fmtNumber(toSpeedDisplay(topDriveSpeedMps), 0)
                : '—'}
            </AppText>
            <AppText style={styles.statUnit} tone="muted">
              {speedUnit}
            </AppText>
          </View>
        </Grid>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  cellFull: {
    width: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 28,
    marginBottom: 16,
  },
  panel: {
    padding: 24,
  },
  shiftCell: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  shiftValue: {
    fontSize: 48,
    fontWeight: '700',
    lineHeight: 52,
  },
  statCell: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  statLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  statUnit: {
    fontSize: 12,
    lineHeight: 16,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
});
