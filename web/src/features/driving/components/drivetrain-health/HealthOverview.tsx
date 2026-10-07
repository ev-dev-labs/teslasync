import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';

import { GlassPanel, Badge, SectionTitle, Text, MetricValue } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { AlertBanner, Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { cn } from '@/lib/cn';

import { HEALTH_GLOW, type HealthStatus } from './constants';
import { healthBadgeVariant, getAlertVariant } from './helpers';

interface HealthOverviewProps {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
  /** Whether the drivetrain-health query resolved with real data. */
  hasData: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function HealthOverview({
  overallHealth,
  healthScore,
  motorStatus,
  hasData,
  loading = false,
  error,
  onRetry,
}: HealthOverviewProps) {
  const { t } = useTranslation();

  // Toned status accent (300-level). Color is always paired with the badge
  // text + icon so status is never conveyed by color alone.
  const healthTextClass =
    overallHealth === 'good'
      ? 'text-emerald-300'
      : overallHealth === 'warning'
        ? 'text-amber-300'
        : 'text-rose-300';

  // The parent passes `motorStatus ?? ''`, so an empty (or whitespace-only)
  // value is the real "unknown" case. Fall back to a placeholder so the label
  // never dangles as "Motor State:" with nothing after the colon.
  const motorStatusLabel = motorStatus && motorStatus.trim() ? motorStatus : '—';
  // A non-finite score (NaN, or a runtime undefined slipping past the type)
  // would otherwise render "NaN%" in the metric.
  const safeHealthScore = Number.isFinite(healthScore) ? healthScore : 0;

  const showAlert = hasData && !loading && !error && overallHealth !== 'good';

  return (
    <>
      {showAlert && (
        <FadeIn>
          <AlertBanner
            variant={getAlertVariant(overallHealth)}
            title={
              overallHealth === 'critical'
                ? t('drivetrain.alert.criticalTitle', 'Critical Temperature Warning')
                : t('drivetrain.alert.warningTitle', 'Elevated Temperatures Detected')
            }
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
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
        <GlassPanel
          glow={hasData && !loading && !error ? HEALTH_GLOW[overallHealth] : 'none'}
          className="p-4 sm:p-5"
        >
          {loading ? (
            <Skeleton height={72} />
          ) : error ? (
            <QueryError
              error={error}
              onRetry={onRetry}
              resourceName={t('drivetrain.title', 'Drivetrain Health')}
            />
          ) : !hasData ? (
            <EmptyState /* no-action: transient — health data missing until first telemetry */
              message={t('drivetrain.noHealth', 'No drivetrain health data available yet')}
            />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                {overallHealth === 'good' ? (
                  <CheckCircle className={cn('h-10 w-10 shrink-0', healthTextClass)} aria-hidden="true" />
                ) : (
                  <AlertTriangle className={cn('h-10 w-10 shrink-0', healthTextClass)} aria-hidden="true" />
                )}
                <div>
                  <SectionTitle>
                    {overallHealth === 'good'
                      ? t('drivetrain.healthGood', 'Drivetrain Healthy')
                      : overallHealth === 'warning'
                        ? t('drivetrain.healthWarn', 'Drivetrain Running Warm')
                        : t('drivetrain.healthCrit', 'Drivetrain Overheating')}
                  </SectionTitle>
                  <Text as="p" size="sm" color="muted">
                    {t('drivetrain.motorState', 'Motor State')}: {motorStatusLabel}
                  </Text>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={healthBadgeVariant(overallHealth)} size="lg" dot>
                  {t(`drivetrain.health.${overallHealth}`, overallHealth.toUpperCase())}
                </Badge>
                <MetricValue className={cn('!text-2xl', healthTextClass)}>
                  <AnimatedNumber value={safeHealthScore} suffix="%" />
                </MetricValue>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </>
  );
}
