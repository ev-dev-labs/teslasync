// Native parity port of
// web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx.
//
// The Health Recommendations panel derives a priority-ordered list of drivetrain
// care tips from the overall health status (critical -> warning -> always-on
// baseline) and renders each tip as a coloured advisory row inside a GlassPanel:
// high-priority rows are red-tinted with a critical alert glyph, medium-priority
// rows are amber-tinted with a warning glyph, and the always-present low-priority
// rows are neutral with a trend-up glyph. A Shield-headed title sits above the
// staggered list.
//
// React Native has no DOM, so the web tree is reproduced with native
// View/AppText layers (no className / Tailwind):
//   - @/components/ui GlassPanel -> the native components/ui GlassPanel (View card);
//     className="p-6" -> styles.panel padding 24.
//   - @/components/motion FadeIn -> a static local FadeIn wrapper (there is no
//     native FadeIn component; the web entrance is presentational only, the same
//     idiom as the converted sibling TirePressureSection). The web delay={0.35} is
//     retained on the wrapper prop for source parity but is a no-op.
//   - @/components/motion StaggerContainer + StaggerItem -> a plain container View
//     plus the converted native StaggerItem (web-parity/components/motion), which
//     self-drives the same fade+slide entrance; each item gets an incrementing
//     delayMs (index * 60) reproducing the web staggerChildren: 0.06 offset.
//   - lucide-react Shield / AlertTriangle / TrendingUp -> the shared native
//     SemanticIcon glyphs: header Shield -> 'security'; high AlertTriangle ->
//     'severityCritical' (danger/red); medium AlertTriangle -> 'severityWarn'
//     (warning/amber); low TrendingUp -> 'trendUp'. The icons are decorative,
//     exactly as the source SVGs (no aria-label); the row tint + text carry the
//     meaning. The source text-neon-cyan Shield/TrendingUp hue is approximated by
//     the nearest semantic glyph tone.
//   - @/lib/cn className composition -> native StyleSheet style arrays selecting the
//     per-priority row tint (red/amber/neutral) from the design tokens.
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     preserving every drivetrain.* key + default verbatim.
//   - ./constants HealthStatus + Recommendation types -> inlined verbatim (the
//     native drivetrain-health/constants module is not yet a converted target; the
//     same idiom the sibling used for its inlined types).
//
// No DOM, Recharts, Leaflet, framer-motion, lucide-react, or old web UI components
// are imported.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View, type ViewStyle} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {StaggerItem} from '../../../../components/motion/StaggerItem';

// Inlined verbatim from web .../drivetrain-health/constants.ts. The native module
// for that constants file is not yet a converted target; the source imports only
// these two symbols (`import type { HealthStatus, Recommendation }`).
export type HealthStatus = 'good' | 'warning' | 'critical';

export interface Recommendation {
  key: string;
  text: string;
  priority: 'high' | 'medium' | 'low';
}

interface HealthRecommendationsProps {
  overallHealth: HealthStatus;
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next is not wired in native. i18next returns the supplied default when
// a translation is missing, so the fallback returns the English default and keeps
// every drivetrain.* key verbatim in source.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Web StaggerContainer staggerChildren: 0.06 (60ms) per child — reproduced as an
// incrementing per-item delay on the native StaggerItem.
const STAGGER_STEP_MS = 60;

// Per-priority advisory glyph (decorative), mirroring the source lucide icons:
// high -> AlertTriangle (red), medium -> AlertTriangle (amber), low -> TrendingUp.
const PRIORITY_ICON: Record<Recommendation['priority'], SemanticIconName> = {
  high: 'severityCritical',
  medium: 'severityWarn',
  low: 'trendUp',
};

// Presentation-only entrance animation on web; rendered statically on native (no
// native FadeIn). `delay` is accepted for source parity (web delay={0.35}) but is
// a no-op, matching the converted sibling TirePressureSection.
function FadeIn({
  children,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return <View style={styles.fadeIn}>{children}</View>;
}

export function HealthRecommendations({
  overallHealth,
}: HealthRecommendationsProps) {
  const t = useNativeTranslationFallback();

  const recommendations: Recommendation[] = useMemo(() => {
    const tips: Recommendation[] = [];

    if (overallHealth === 'critical') {
      tips.push({
        key: 'critical-stop',
        text: t(
          'drivetrain.tips.criticalStop',
          'Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.',
        ),
        priority: 'high',
      });
      tips.push({
        key: 'service-urgent',
        text: t(
          'drivetrain.tips.serviceUrgent',
          'Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.',
        ),
        priority: 'high',
      });
    }

    if (overallHealth === 'warning' || overallHealth === 'critical') {
      tips.push({
        key: 'reduce-load',
        text: t(
          'drivetrain.tips.reduceLoad',
          'Reduce driving intensity and avoid hard acceleration to allow components to cool.',
        ),
        priority: 'medium',
      });
      tips.push({
        key: 'check-coolant',
        text: t(
          'drivetrain.tips.checkCoolant',
          'Schedule a service appointment to inspect the coolant system and fluid levels.',
        ),
        priority: 'medium',
      });
      tips.push({
        key: 'avoid-supercharging',
        text: t(
          'drivetrain.tips.avoidSupercharging',
          'Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.',
        ),
        priority: 'medium',
      });
    }

    tips.push({
      key: 'regular-service',
      text: t(
        'drivetrain.tips.regularService',
        'Keep up with regular service intervals for optimal drivetrain health and longevity.',
      ),
      priority: 'low',
    });
    tips.push({
      key: 'gentle-accel',
      text: t(
        'drivetrain.tips.gentleAccel',
        'Gentle acceleration helps maintain lower motor temperatures and extends component life.',
      ),
      priority: 'low',
    });
    tips.push({
      key: 'precondition',
      text: t(
        'drivetrain.tips.precondition',
        'Precondition the battery in cold weather for better thermal performance and driving efficiency.',
      ),
      priority: 'low',
    });
    tips.push({
      key: 'monitor-temps',
      text: t(
        'drivetrain.tips.monitorTemps',
        'Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.',
      ),
      priority: 'low',
    });

    return tips;
  }, [overallHealth, t]);

  return (
    <FadeIn delay={0.35}>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <SemanticIcon decorative name="security" size="sm" />
          <AppText tone="muted" weight="semibold" style={styles.headerTitle}>
            {t('drivetrain.recommendations', 'Health Recommendations')}
          </AppText>
        </View>
        <View style={styles.list}>
          {recommendations.map((tip, index) => (
            <StaggerItem key={tip.key} delayMs={index * STAGGER_STEP_MS}>
              <View style={[styles.row, rowToneStyles[tip.priority]]}>
                <SemanticIcon
                  decorative
                  name={PRIORITY_ICON[tip.priority]}
                  size="sm"
                  style={styles.rowIcon}
                />
                <AppText tone="secondary" style={styles.tipText}>
                  {tip.text}
                </AppText>
              </View>
            </StaggerItem>
          ))}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

HealthRecommendations.displayName = 'HealthRecommendations';

const styles = StyleSheet.create({
  fadeIn: {
    width: '100%',
  },
  panel: {
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  list: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowIcon: {
    marginTop: 2,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});

const rowToneStyles = StyleSheet.create<
  Record<Recommendation['priority'], ViewStyle>
>({
  high: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  medium: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  low: {
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
});
