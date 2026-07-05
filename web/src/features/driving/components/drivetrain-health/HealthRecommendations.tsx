import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, AlertTriangle, TrendingUp } from 'lucide-react';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { VisuallyHidden } from '@/components/a11y';
import { cn } from '@/lib/cn';

import type { HealthStatus, Recommendation } from './constants';

interface HealthRecommendationsProps {
  overallHealth: HealthStatus;
}

export function HealthRecommendations({ overallHealth }: HealthRecommendationsProps) {
  const { t } = useTranslation();

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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-cyan-300" aria-hidden="true" />
          {t('drivetrain.recommendations', 'Health Recommendations')}
        </PanelTitle>
        <StaggerContainer className="space-y-3">
          {recommendations.map((tip) => {
            // Priority is otherwise signalled only through the row's colour and
            // an aria-hidden icon (WCAG 1.4.1 — Use of Color). Surface an
            // equivalent text cue so assistive-tech users perceive urgency.
            const srPriority =
              tip.priority === 'high'
                ? t('drivetrain.priority.urgent', 'Urgent recommendation:')
                : tip.priority === 'medium'
                  ? t('drivetrain.priority.important', 'Important recommendation:')
                  : null;
            return (
              <StaggerItem key={tip.key}>
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-4 py-3',
                    tip.priority === 'high'
                      ? 'border-neon-red/20 bg-neon-red/5'
                      : tip.priority === 'medium'
                        ? 'border-neon-amber/20 bg-neon-amber/5'
                        : 'border-[var(--border-subtle)] bg-white/[0.02]',
                  )}
                >
                  {tip.priority === 'high' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
                  ) : tip.priority === 'medium' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                  ) : (
                    <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                  )}
                  {srPriority ? <VisuallyHidden>{`${srPriority} `}</VisuallyHidden> : null}
                  <Text as="p" size="sm" color="secondary">{tip.text}</Text>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </GlassPanel>
    </FadeIn>
  );
}
