import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatPeriod } from '@/lib/metric-reference';
import { formatDateTime } from '@/lib/dateFormat';

interface Props {
  id?: string;
  title: string;
  description?: string;
  metrics: readonly StatMetric[];
  period: StatPeriod;
  loading?: boolean;
  retained?: boolean;
  secondary?: string;
}

/** Keep source-window limitations beside the readings and in the real review drawer. */
export function BatteryEvidenceBrief({
  id, title, description, metrics, period, loading = false, retained = false, secondary,
}: Props) {
  const { t } = useTranslation();
  const scopeReason = period.kind === 'unknown' ? period.reason : period.provenance;
  const evidence = useOperationalMetrics(metrics.map(metric => ({
    ...metric,
    description: metric.description === metric.label || metric.description === metric.context
      ? undefined : metric.description,
    context: metric.context != null ? <div data-battery-detail-context>{metric.context}</div> : undefined,
  })));
  const hasReadings = evidence.some(metric => metric.valueState === 'value');
  return (
    <div id={id}>
    <OperationalBrief
      compact
      testId={id}
      eyebrow={t('battery.brief.eyebrow', 'Battery and energy evidence')}
      title={title}
      description={[description ?? scopeReason ?? period.label, secondary].filter(Boolean).join(' ')}
      statusLabel={loading
        ? t('battery.brief.loading', 'Loading source evidence')
        : retained
          ? t('battery.brief.retained', 'Retained source evidence')
          : hasReadings
            ? t('battery.brief.available', 'Available source readings')
            : t('battery.brief.unavailable', 'Source readings unavailable')}
      statusTone={retained ? 'warning' : 'neutral'}
      loading={loading}
      metrics={evidence}
      scope={<Caption data-battery-period>{period.label}</Caption>}
      freshness={period.kind === 'snapshot' && period.observedAt
        ? <Caption>{formatDateTime(period.observedAt)}</Caption> : undefined}
      provenance={scopeReason}
    />
    </div>
  );
}
