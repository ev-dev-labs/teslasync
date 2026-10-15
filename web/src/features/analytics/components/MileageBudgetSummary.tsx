import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import { StatStrip, type StatMetric, type StatPeriod } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import type { MileageBudgetResult } from '../lib/mileageBudget';

export function MileageBudgetSummary({
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
  const metrics: StatMetric[] = [
    {
      metricId: 'text',
      occurrenceId: 'budget-used',
      label: historyCapped
        ? t('mileageBudget.usedObserved', 'Observed in returned window')
        : t('mileageBudget.used', 'Driven this term'),
      rawValue: source.hasData ? formatDistance(budget.usedM) : null,
      context: historyCapped
        ? t('mileageBudget.cap.observed', 'At least this much is present; older term drives may be absent')
        : t('mileageBudget.allowedToDate', 'allowed so far: {{allowed}}', {
            allowed: formatDistance(budget.allowedToDateM),
          }),
    },
    {
      metricId: 'text',
      occurrenceId: 'budget-pace',
      label: t('mileageBudget.pace', 'Pace'),
      rawValue: source.hasData && !historyCapped && budget.paceRatio != null
        ? `${Math.round(budget.paceRatio * 100)}%`
        : null,
      context: !source.hasData ? undefined : historyCapped
        ? unavailable
        : paceOver
          ? t('mileageBudget.overPace', 'over budget pace')
          : t('mileageBudget.underPace', 'within budget pace'),
    },
    {
      metricId: 'text',
      occurrenceId: 'budget-projected',
      label: t('mileageBudget.projected', 'Projected term total'),
      rawValue: source.hasData && !historyCapped && budget.projectedTotalM != null
        ? formatDistance(budget.projectedTotalM)
        : null,
      context: historyCapped
        ? unavailable
        : t('mileageBudget.ofAllowance', 'allowance: {{total}}', {
            total: formatDistance(budget.totalAllowanceM),
          }),
    },
    {
      metricId: 'text',
      occurrenceId: 'budget-overage',
      label: t('mileageBudget.overageCost', 'Projected overage'),
      rawValue: source.hasData && !historyCapped
        ? budget.projectedOverageM > 0
          ? formatCurrency(budget.projectedOverageCost)
          : formatCurrency(0)
        : null,
      context: !source.hasData ? undefined : historyCapped
        ? unavailable
        : budget.projectedOverageM > 0
          ? formatDistance(budget.projectedOverageM)
          : t('mileageBudget.noOverage', 'no overage projected'),
    },
  ];

  return (
    <StatStrip
      id="mileage-budget-summary"
      title={t('mileageBudget.kpis', 'Mileage budget summary metrics')}
      metrics={metrics}
      period={period}
      loading={source.status === 'initial'}
      retained={source.hasData && !!source.refreshError}
      footer={source.fatalError ? (
        <SourceContent
          state="error"
          label={t('mileageBudget.kpis', 'Mileage budget summary metrics')}
          emptyMessage=""
          errorMessage={t('error.loadFailed', 'Failed to load data')}
          error={source.fatalError}
          errorRecovery={{ onRetry: source.retry ?? undefined }}
        >{null}</SourceContent>
      ) : undefined}
    />
  );
}
