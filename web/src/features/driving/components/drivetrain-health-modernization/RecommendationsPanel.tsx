import { useTranslation } from 'react-i18next';
import { Text, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { HealthStatus } from '../drivetrain-health/constants';

/** Exact specialist advice, priority and ordering; unknown is explicitly
 * unassessed, while the four unconditional care tips remain available. */
export function RecommendationsPanel({ status }: { status: HealthStatus | null }) {
  const { t } = useTranslation();
  const tips: { key: string; text: string; priority: 'high' | 'medium' | 'low' }[] = [];
  if (status === 'critical') {
    tips.push({
      key: 'critical-stop', priority: 'high',
      text: t('drivetrain.tips.criticalStop', 'Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.'),
    }, {
      key: 'service-urgent', priority: 'high',
      text: t('drivetrain.tips.serviceUrgent', 'Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.'),
    });
  }
  if (status === 'warning' || status === 'critical') {
    tips.push({
      key: 'reduce-load', priority: 'medium',
      text: t('drivetrain.tips.reduceLoad', 'Reduce driving intensity and avoid hard acceleration to allow components to cool.'),
    }, {
      key: 'check-coolant', priority: 'medium',
      text: t('drivetrain.tips.checkCoolant', 'Schedule a service appointment to inspect the coolant system and fluid levels.'),
    }, {
      key: 'avoid-supercharging', priority: 'medium',
      text: t('drivetrain.tips.avoidSupercharging', 'Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.'),
    });
  }
  tips.push({
    key: 'regular-service', priority: 'low',
    text: t('drivetrain.tips.regularService', 'Keep up with regular service intervals for optimal drivetrain health and longevity.'),
  }, {
    key: 'gentle-accel', priority: 'low',
    text: t('drivetrain.tips.gentleAccel', 'Gentle acceleration helps maintain lower motor temperatures and extends component life.'),
  }, {
    key: 'precondition', priority: 'low',
    text: t('drivetrain.tips.precondition', 'Precondition the battery in cold weather for better thermal performance and driving efficiency.'),
  }, {
    key: 'monitor-temps', priority: 'low',
    text: t('drivetrain.tips.monitorTemps', 'Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.'),
  });
  return <div className="min-w-0 space-y-3">
    {status == null && <Text as="p" variant="bodySm">
      {t('drivetrain.modernization.generalAdvice', 'No active assessment is available. General care recommendations remain available below.')}
    </Text>}
    {tips.map(tip => <div key={tip.key} data-recommendation={tip.key}
      className={cn('min-w-0 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3',
        tip.priority === 'high' && 'border-rose-500/20',
        tip.priority === 'medium' && 'border-amber-500/20')}>
      {tip.priority !== 'low' && <Badge variant={tip.priority === 'high' ? 'danger' : 'warning'}>
        {tip.priority === 'high'
          ? t('drivetrain.priority.urgent', 'Urgent recommendation:')
          : t('drivetrain.priority.important', 'Important recommendation:')}
      </Badge>}
      <Text as="p" variant="bodySm" className="break-words">{tip.text}</Text>
    </div>)}
  </div>;
}
