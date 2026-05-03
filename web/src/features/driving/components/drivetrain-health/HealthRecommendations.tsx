import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, AlertTriangle, TrendingUp } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
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
      <GlassPanel className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-neon-cyan" />
          <h3 className="text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {t('drivetrain.recommendations', 'Health Recommendations')}
          </h3>
        </div>
        <StaggerContainer className="space-y-3">
          {recommendations.map((tip) => (
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
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neon-red" />
                ) : tip.priority === 'medium' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
                ) : (
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-neon-cyan" />
                )}
                <p className="text-sm text-[var(--text-secondary)]">{tip.text}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </GlassPanel>
    </FadeIn>
  );
}
