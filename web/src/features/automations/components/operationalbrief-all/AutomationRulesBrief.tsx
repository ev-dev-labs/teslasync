import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface AutomationRulesBriefProps {
  stats: {
    total: number;
    active: number;
    disabled: number;
    autoDisabled: number;
    totalRuns?: number;
    totalFailures?: number;
  };
  hasData: boolean;
  loading: boolean;
  retained: boolean;
  bulk?: boolean;
}

export function AutomationRulesBrief({
  stats, hasData, loading, retained, bulk = false,
}: AutomationRulesBriefProps) {
  const { t } = useTranslation();
  const prefix = bulk ? 'automationList.kpi' : 'automations.stats';
  const definitions = [
    { key: 'total', label: t(`${prefix}.total`, 'Total'), value: stats.total },
    { key: 'active', label: t(`${prefix}.active`, 'Active'), value: stats.active },
    { key: 'disabled', label: t(`${prefix}.disabled`, 'Disabled'), value: stats.disabled },
    { key: 'autoDisabled', label: t(`${prefix}.autoDisabled`, 'Auto-disabled'), value: stats.autoDisabled },
    ...(bulk ? [
      { key: 'runs', label: t('automationList.kpi.runs', 'Total runs'), value: stats.totalRuns },
      { key: 'failures', label: t('automationList.kpi.failures', 'Failures'), value: stats.totalFailures },
    ] : []),
  ];
  const countContext = t('automations.brief.countContext', 'Full loaded rule set, before status and search filters.');
  const counterContext = t('automations.brief.counterContext', 'Cumulative counters on loaded rules; their start time is not supplied.');
  const rawMetrics: readonly StatMetric[] = definitions.map((metric) => ({
    metricId: 'count',
    occurrenceId: metric.key,
    label: metric.label,
    rawValue: hasData ? metric.value ?? null : null,
    description: metric.key === 'runs' || metric.key === 'failures' ? counterContext : countContext,
  }));
  const metrics = useOperationalMetrics(rawMetrics);

  return (
    <OperationalBrief
      compact
      testId={bulk ? 'automation-rules-brief' : 'automations-brief'}
      eyebrow={t('automations.brief.eyebrow', 'Automation rules')}
      title={t('automations.brief.title', 'Rule inventory')}
      description={t('automations.brief.description', 'Review the loaded rules without changing their triggers, conditions, or actions.')}
      statusLabel={loading ? t('automations.brief.loading', 'Loading rules')
        : !hasData ? t('automations.brief.unavailable', 'Rules unavailable')
          : retained ? t('automations.brief.retained', 'Retained rules')
            : t('automations.brief.available', 'Rules loaded')}
      statusTone={retained || !hasData ? 'warning' : 'neutral'}
      metrics={metrics}
      loading={loading}
      scope={t('automations.brief.scope', 'All loaded rules · unfiltered')}
      freshness={t('automations.brief.freshness', 'Rule response; not a live execution stream')}
      provenance={bulk ? `${countContext} ${counterContext}` : countContext}
    />
  );
}
