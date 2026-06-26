// HealthOverview — native parity port of
// web/src/features/driving/components/drivetrain-health/HealthOverview.tsx.
//
// The web component is the drivetrain-health summary header: an optional
// page-level AlertBanner (shown only when overall health is warning/critical)
// above a GlassPanel that pairs a status icon + "Drivetrain Healthy/Running
// Warm/Overheating" heading + "Motor State: …" subtitle on the left with a
// health-variant Badge + animated health-score percentage on the right. Both
// blocks are wrapped in `FadeIn`.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback)
//     keeping every drivetrain.* key + English fallback verbatim.
//   - lucide-react CheckCircle / AlertTriangle (web L2): lucide is browser-only
//     SVG and forbidden in native output (rule 4). The status glyphs are
//     rendered through the native SemanticIcon (good -> 'success', warning ->
//     'warning', critical -> 'severityCritical'); the banner's AlertTriangle ->
//     'warning' (warning) / 'severityCritical' (danger) so the icon tone tracks
//     the banner variant exactly like the web titleText colour.
//   - `@/components/ui` GlassPanel + Badge (web L4): GlassPanel comes from the
//     native ui GlassPanel. The web `glow={HEALTH_GLOW[…]}` is INERT here — the
//     web GlassPanel only applies its glow classes when `hover` is true, and
//     HealthOverview never passes `hover`, so the glow has no visual effect at
//     rest; the native GlassPanel has no glow/hover, so it is dropped with no
//     behavioural change (HEALTH_GLOW import L10 therefore unused -> omitted).
//     Badge has no native parity port yet, so a local variant Badge (success/
//     warning/danger, lg size, dot) is built from RN primitives + theme tokens.
//   - `@/components/data-display` AnimatedNumber (web L5) -> the native
//     AnimatedNumber parity port (count-up % value).
//   - `@/components/motion` FadeIn (web L6) -> a local reduced-motion-aware
//     FadeIn (Animated.View), the TemperatureSection precedent.
//   - `@/components/feedback` AlertBanner (web L7) -> a local AlertBanner built
//     from RN primitives reproducing the web neon variant border/bg/text + the
//     leading icon + title + body copy (warning/danger variants only).
//   - `@/lib/cn` (web L8): the Tailwind class-merge helper has no native role
//     (no className) -> dropped.
//   - `./constants` HEALTH_GLOW + HealthStatus and `./helpers` healthBadgeVariant
//     / getAlertVariant (web L10-11): reproduced inline (the sibling native
//     constants.ts/helpers.ts are owned by their own conversion turns, like the
//     TemperatureSection inline-types precedent). HEALTH_GLOW is inert (see
//     above) so only HealthStatus + the two variant resolvers are ported.
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

import {SemanticIcon, type SemanticIconName} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {AnimatedNumber} from '../../../../components/data-display/AnimatedNumber';

// ---- Inlined `./constants` + `./helpers` (own conversion turns) -------------

type HealthStatus = 'good' | 'warning' | 'critical';
type AlertVariant = 'warning' | 'danger';
type BadgeVariant = 'success' | 'warning' | 'danger';

// web ./helpers healthBadgeVariant: good -> success, warning -> warning, else danger.
function healthBadgeVariant(health: HealthStatus): BadgeVariant {
  if (health === 'good') {
    return 'success';
  }
  if (health === 'warning') {
    return 'warning';
  }
  return 'danger';
}

// web ./helpers getAlertVariant: warning -> warning, else danger.
function getAlertVariant(health: HealthStatus): AlertVariant {
  return health === 'warning' ? 'warning' : 'danger';
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Colours ---------------------------------------------------------------
// web healthTextClass: good -> emerald-500, warning -> amber-500, critical ->
// red-500. The literal Tailwind-500 hexes are reused for the status icon tone
// pairing and the health-score percentage.

const HEALTH_TEXT_COLOR: Record<HealthStatus, string> = {
  good: '#10b981', // emerald-500
  warning: '#f59e0b', // amber-500
  critical: '#ef4444', // red-500
};

// web L63-67 status glyph: good -> CheckCircle, warning/critical -> AlertTriangle.
const HEALTH_ICON_NAME: Record<HealthStatus, SemanticIconName> = {
  good: 'success',
  warning: 'warning',
  critical: 'severityCritical',
};

// Banner AlertTriangle (web L44) -> tone-matched native glyph per banner variant.
const ALERT_ICON_NAME: Record<AlertVariant, SemanticIconName> = {
  warning: 'warning',
  danger: 'severityCritical',
};

// web feedback/AlertBanner neon variant map (warning/danger used here). Neon
// palette from tailwind.config.js: amber #f59e0b, red #ef4444.
const ALERT_VARIANT: Record<
  AlertVariant,
  {border: string; bg: string; text: string; title: string}
> = {
  warning: {
    border: 'rgba(245, 158, 11, 0.2)', // border-neon-amber/20
    bg: 'rgba(245, 158, 11, 0.05)', // bg-neon-amber/5
    text: 'rgba(245, 158, 11, 0.8)', // text-neon-amber/80
    title: '#f59e0b', // text-neon-amber
  },
  danger: {
    border: 'rgba(239, 68, 68, 0.2)', // border-neon-red/20
    bg: 'rgba(239, 68, 68, 0.05)', // bg-neon-red/5
    text: 'rgba(239, 68, 68, 0.8)', // text-neon-red/80
    title: '#ef4444', // text-neon-red
  },
};

// web ui/Badge dark-mode variant map (success/warning/danger used here):
// bg-{c}-900 / text-{c}-200; the dot is `bg-current` (= text colour).
const BADGE_VARIANT: Record<BadgeVariant, {bg: string; text: string}> = {
  success: {bg: '#14532d', text: '#bbf7d0'}, // green-900 / green-200
  warning: {bg: '#713f12', text: '#fef08a'}, // yellow-900 / yellow-200
  danger: {bg: '#7f1d1d', text: '#fecaca'}, // red-900 / red-200
};

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
// Reproduces the web initial {opacity:0, y:12} -> animate {opacity:1, y:0}
// easeOut entrance; reduced motion collapses to the final state (web no-op).

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

// ---- Local AlertBanner (web @/components/feedback AlertBanner) ---------------
// Reproduces the warning/danger neon banner: leading icon + title + body copy.

function AlertBanner({
  variant,
  title,
  iconName,
  children,
}: {
  variant: AlertVariant;
  title: string;
  iconName: SemanticIconName;
  children: ReactNode;
}): React.ReactElement {
  const v = ALERT_VARIANT[variant];

  return (
    <View
      style={[styles.alert, {backgroundColor: v.bg, borderColor: v.border}]}>
      <View style={styles.alertIcon}>
        <SemanticIcon decorative name={iconName} size="sm" />
      </View>
      <View style={styles.alertBody}>
        <AppText style={[styles.alertTitle, {color: v.title}]}>{title}</AppText>
        <AppText style={[styles.alertText, styles.alertTextSpaced, {color: v.text}]}>
          {children}
        </AppText>
      </View>
    </View>
  );
}

// ---- Local Badge (web @/components/ui Badge, lg size, dot) -------------------

function HealthBadge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}): React.ReactElement {
  const v = BADGE_VARIANT[variant];

  return (
    <View style={[styles.badge, {backgroundColor: v.bg}]}>
      <View style={[styles.badgeDot, {backgroundColor: v.text}]} />
      <AppText style={[styles.badgeText, {color: v.text}]}>{children}</AppText>
    </View>
  );
}

// ---- Component --------------------------------------------------------------

interface HealthOverviewProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
}

export function HealthOverview({
  overallHealth,
  healthScore,
  motorStatus,
}: HealthOverviewProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  const healthColor = HEALTH_TEXT_COLOR[overallHealth];

  const healthHeading =
    overallHealth === 'good'
      ? t('drivetrain.healthGood', 'Drivetrain Healthy')
      : overallHealth === 'warning'
        ? t('drivetrain.healthWarn', 'Drivetrain Running Warm')
        : t('drivetrain.healthCrit', 'Drivetrain Overheating');

  return (
    <>
      {overallHealth !== 'good' && (
        <FadeIn reduceMotion={reduceMotion}>
          <AlertBanner
            iconName={ALERT_ICON_NAME[getAlertVariant(overallHealth)]}
            title={
              overallHealth === 'critical'
                ? t('drivetrain.alert.criticalTitle', 'Critical Temperature Warning')
                : t('drivetrain.alert.warningTitle', 'Elevated Temperatures Detected')
            }
            variant={getAlertVariant(overallHealth)}>
            {overallHealth === 'critical'
              ? t(
                  'drivetrain.alert.criticalMsg',
                  'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.',
                )
              : t(
                  'drivetrain.alert.warningMsg',
                  'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.',
                )}
          </AlertBanner>
        </FadeIn>
      )}

      <FadeIn reduceMotion={reduceMotion}>
        <GlassPanel style={styles.panel}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <SemanticIcon
                decorative
                name={HEALTH_ICON_NAME[overallHealth]}
                size="md"
              />
              <View style={styles.headerText}>
                <AppText style={styles.healthHeading} weight="semibold">
                  {healthHeading}
                </AppText>
                <AppText style={styles.motorState} tone="muted">
                  {`${t('drivetrain.motorState', 'Motor State')}: ${motorStatus}`}
                </AppText>
              </View>
            </View>
            <View style={styles.headerRight}>
              <HealthBadge variant={healthBadgeVariant(overallHealth)}>
                {t(`drivetrain.health.${overallHealth}`, overallHealth.toUpperCase())}
              </HealthBadge>
              <AnimatedNumber
                style={[styles.scoreValue, {color: healthColor}]}
                suffix="%"
                value={healthScore}
              />
            </View>
          </View>
        </GlassPanel>
      </FadeIn>
    </>
  );
}

HealthOverview.displayName = 'HealthOverview';

const styles = StyleSheet.create({
  // web feedback/AlertBanner root `flex items-start gap-3 rounded-xl border p-4`.
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  // web banner icon `shrink-0 mt-0.5`.
  alertIcon: {
    flexShrink: 0,
    marginTop: 2,
  },
  // web banner body `flex-1 min-w-0`.
  alertBody: {
    flex: 1,
  },
  // web banner title `text-sm font-medium`.
  alertTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  // web banner body copy `text-xs`.
  alertText: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web banner body `mt-0.5` (always present here — title is always passed).
  alertTextSpaced: {
    marginTop: 2,
  },
  // web Badge root `inline-flex items-center gap-1 rounded-full font-medium`
  // at lg size `px-2.5 py-1`.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // web Badge dot `h-1.5 w-1.5 rounded-full bg-current`.
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 9999,
  },
  // web Badge lg text `text-sm font-medium`.
  badgeText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  // web GlassPanel `p-6`.
  panel: {
    padding: 24,
  },
  // web header `flex flex-col gap-4 …` (mobile-first column base).
  header: {
    flexDirection: 'column',
    gap: 16,
  },
  // web left block `flex items-center gap-4`.
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerText: {
    flexShrink: 1,
  },
  // web h2 `text-xl font-semibold text-[var(--text-primary)]`.
  healthHeading: {
    fontSize: 20,
    lineHeight: 28,
  },
  // web p `text-sm text-[var(--text-muted)]`.
  motorState: {
    fontSize: 14,
    lineHeight: 20,
  },
  // web right block `flex items-center gap-3`.
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // web score span `text-2xl font-bold`.
  scoreValue: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
  },
});
