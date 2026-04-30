import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';

import { GlassPanel, Badge } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { AlertBanner } from '@/components/feedback';
import { cn } from '@/lib/cn';

import { HEALTH_GLOW, type HealthStatus } from './constants';
import { healthBadgeVariant, getAlertVariant } from './helpers';

interface HealthOverviewProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
}

export function HealthOverview({
  overallHealth,
  healthScore,
  motorStatus,
}: HealthOverviewProps) {
  const { t } = useTranslation();

  const healthTextClass =
    overallHealth === 'good'
      ? 'text-emerald-500'
      : overallHealth === 'warning'
        ? 'text-amber-500'
        : 'text-red-500';

  return (
    <>
      {overallHealth !== 'good' && (
        <FadeIn>
          <AlertBanner
            variant={getAlertVariant(overallHealth)}
            title={
              overallHealth === 'critical'
                ? t('drivetrain.alert.criticalTitle', 'Critical Temperature Warning')
                : t('drivetrain.alert.warningTitle', 'Elevated Temperatures Detected')
            }
            icon={<AlertTriangle className="h-4 w-4" />}
          >
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

      <FadeIn>
        <GlassPanel glow={HEALTH_GLOW[overallHealth]} className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {overallHealth === 'good' ? (
                <CheckCircle className={cn('h-10 w-10 shrink-0', healthTextClass)} />
              ) : (
                <AlertTriangle className={cn('h-10 w-10 shrink-0', healthTextClass)} />
              )}
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                  {overallHealth === 'good'
                    ? t('drivetrain.healthGood', 'Drivetrain Healthy')
                    : overallHealth === 'warning'
                      ? t('drivetrain.healthWarn', 'Drivetrain Running Warm')
                      : t('drivetrain.healthCrit', 'Drivetrain Overheating')}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {t('drivetrain.motorState', 'Motor State')}: {motorStatus}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={healthBadgeVariant(overallHealth)} size="lg" dot>
                {t(`drivetrain.health.${overallHealth}`, overallHealth.toUpperCase())}
              </Badge>
              <span className={cn('text-2xl font-bold', healthTextClass)}>
                <AnimatedNumber value={healthScore} suffix="%" />
              </span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
    </>
  );
}
