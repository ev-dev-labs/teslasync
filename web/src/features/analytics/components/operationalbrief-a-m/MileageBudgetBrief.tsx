import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import { OperationalBrief, type StatMetric, type StatPeriod } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { MileageBudgetResult } from '../../lib/mileageBudget';

export function MileageBudgetBrief({
  budget, source, period, formatDistance, formatCurrency,
}: {
  budget: MileageBudgetResult;
  source: DataState<Drive[]>;
  period: StatPeriod;
  formatDistance: (value: number) => string;
  formatCurrency: (value: number) => string;
}) {
  const { t } = useTranslation();
  const historyCapped = budget.historyCapReached;
  const paceOver = !historyCapped && budget.paceRatio != null && budget.paceRatio > 1;
  const unavailable = t('mileageBudget.cap.unavailable', 'unavailable while history is capped');
  const distanceDisplay = { formatter: (raw: number) => ({ value: formatDistance(raw), unit: '' }) };
  const metrics: StatMetric[] = [
    {
      metricId: 'distance', occurrenceId: 'budget-used',
      label: historyCapped ? t('mileageBudget.usedObserved', 'Observed in returned window')
        : t('mileageBudget.used', 'Driven this term'),
      rawValue: source.hasData ? budget.usedM : null, display: distanceDisplay,
      context: historyCapped
        ? t('mileageBudget.cap.observed', 'At least this much is present; older term drives may be absent')
        : t('mileageBudget.allowedToDate', 'allowed so far: {{allowed}}', { allowed: formatDistance(budget.allowedToDateM) }),
    },
    {
      metricId: 'percent', occurrenceId: 'budget-pace',
      label: t('mileageBudget.pace', 'Pace'),
      rawValue: source.hasData && !historyCapped && budget.paceRatio != null ? budget.paceRatio * 100 : null,
      display: { formatter: raw => ({ value: `${Math.round(raw)}%`, unit: '' }) },
      context: !source.hasData ? undefined : historyCapped ? unavailable
        : paceOver ? t('mileageBudget.overPace', 'over budget pace') : t('mileageBudget.underPace', 'within budget pace'),
    },
    {
      metricId: 'distance', occurrenceId: 'budget-projected',
      label: t('mileageBudget.projected', 'Projected term total'),
      rawValue: source.hasData && !historyCapped ? budget.projectedTotalM : null, display: distanceDisplay,
      context: historyCapped ? unavailable : t('mileageBudget.ofAllowance', 'allowance: {{total}}', { total: formatDistance(budget.totalAllowanceM) }),
    },
    {
      metricId: 'currency', occurrenceId: 'budget-overage',
      label: t('mileageBudget.overageCost', 'Projected overage'),
      rawValue: source.hasData && !historyCapped ? budget.projectedOverageM > 0 ? budget.projectedOverageCost : 0 : null,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      context: !source.hasData ? undefined : historyCapped ? unavailable
        : budget.projectedOverageM > 0 ? formatDistance(budget.projectedOverageM)
          : t('mileageBudget.noOverage', 'no overage projected'),
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const title = t('mileageBudget.kpis', 'Mileage budget summary metrics');
  return <div id="mileage-budget-summary">
    <OperationalBrief compact title={title} metrics={operationalMetrics}
      eyebrow={t('mileageBudget.title', 'Mileage budget')}
      description={t('mileageBudget.brief.description', 'Observed term distance, budget pace, and bounded projections from returned drive history.')}
      loading={source.status === 'initial'}
      statusLabel={source.status === 'initial' ? t('analytics.brief.loading', 'Loading evidence')
        : !source.hasData ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : source.status === 'stale' || source.isRefreshBlocked ? t('analytics.brief.retained', 'Retained evidence')
            : historyCapped ? t('mileageBudget.brief.capped', 'History capped') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!source.hasData || source.status === 'stale' || historyCapped ? 'warning' : 'neutral'}
      scope={<span>{period.label}{period.kind === 'event' ? ` · ${period.start} – ${period.end ?? '—'}`
        : period.kind === 'analysis' ? ` · ${period.start} – ${period.endExclusive} · ${period.timezone}` : null}</span>}
      freshness={<span>{period.kind === 'unknown' ? period.reason : period.provenance}</span>}
      provenance={period.kind === 'unknown' ? period.reason : period.provenance}
    />
    {source.fatalError && <SourceContent state="error" label={title} emptyMessage=""
      errorMessage={t('error.loadFailed', 'Failed to load data')} error={source.fatalError}
      errorRecovery={{ onRetry: source.retry ?? undefined }}>{null}</SourceContent>}
  </div>;
}
