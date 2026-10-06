import { useTranslation } from 'react-i18next';
import { OperationalBrief, UsageCard } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { DataState } from '@/api/dataState';
import { BenchmarkStatusContent } from './BenchmarkStatusContent';

import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

export function PrivacyBudgetPanel({
  status,
  source,
}: {
  status: BenchmarkPrivacyStatus | null;
  source?: DataState<BenchmarkPrivacyStatus>;
}) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const spent = status?.epsilon_spent;
  const budget = status?.epsilon_budget;
  const hasBudget = typeof spent === 'number' && Number.isFinite(spent)
    && typeof budget === 'number' && Number.isFinite(budget);
  const pct = hasBudget && budget > 0 ? (spent / budget) * 100 : 0;
  const caption = t(
    'benchmarks.budget.caption',
    'Epsilon composes across new source versions. Reading or refreshing an existing release costs nothing.',
  );
  const summaryMetrics: readonly StatMetric[] = [
    {
      metricId: 'rate', occurrenceId: 'epsilon-spent', rawValue: status?.epsilon_spent,
      label: t('benchmarks.brief.spent', 'Privacy budget spent'),
      description: caption,
      display: { formatter: (raw) => ({ value: `ε ${fmtNumber(raw)}`, unit: '' }) },
    },
    {
      metricId: 'rate', occurrenceId: 'epsilon-budget', rawValue: status?.epsilon_budget,
      label: t('benchmarks.budget.title', 'Privacy budget'),
      description: t('benchmarks.brief.budgetBasis', 'Differential privacy epsilon allowance, not a confidence percentage.'),
      display: { formatter: (raw) => ({ value: `ε ${fmtNumber(raw)}`, unit: '' }) },
    },
    {
      metricId: 'rate', occurrenceId: 'epsilon-remaining', rawValue: status?.epsilon_remaining,
      label: t('benchmarks.brief.remaining', 'Privacy budget remaining'),
      description: t('benchmarks.brief.remainingBasis', 'Remaining epsilon reported by the privacy accounting source.'),
      display: { formatter: (raw) => ({ value: `ε ${fmtNumber(raw)}`, unit: '' }) },
    },
  ];
  const metrics = useOperationalMetrics(summaryMetrics);
  const statusLabel = source?.status === 'stale'
    ? t('benchmarks.brief.retainedBudget', 'Retained privacy accounting')
    : source?.fatalError
      ? t('benchmarks.budget.unavailable', 'Budget unavailable')
      : !status
        ? t('benchmarks.brief.budgetPending', 'Privacy accounting pending')
        : status.opted_in
          ? t('benchmarks.brief.optedIn', 'Participation active')
          : t('benchmarks.brief.optedOut', 'Participation inactive');
  return (
    <LayoutCard title={t('benchmarks.budget.title', 'Privacy budget')}>
      <OperationalBrief
        compact
        eyebrow={t('benchmarks.brief.budgetEyebrow', 'Private participation accounting')}
        title={t('benchmarks.budget.title', 'Privacy budget')}
        description={caption}
        statusLabel={statusLabel}
        statusTone={source?.fatalError ? 'danger' : source?.status === 'stale' ? 'warning' : 'neutral'}
        metrics={metrics}
        loading={!status && source?.status === 'initial'}
        scope={<Caption>{t('benchmarks.brief.budgetScope', 'Selected vehicle; cumulative source versions, not the comparison release window.')}</Caption>}
        freshness={<Caption>{t('benchmarks.brief.budgetFreshness', 'Point-in-time privacy accounting; source measurement time is not supplied.')}</Caption>}
        provenance={status
          ? t('benchmarks.brief.budgetProvenance', 'Privacy accounting; mechanism version {{version}}; release threshold k ≥ {{minimum}}.', {
              version: status.mechanism_version, minimum: status.minimum_cohort_size,
            })
          : t('benchmarks.budget.unavailable', 'Budget unavailable')}
      />
      <BenchmarkStatusContent source={source} label={t('benchmarks.budget.title', 'Privacy budget')}>
      <UsageCard
        budget={status && hasBudget ? {
          headline: t('benchmarks.budget.headline', 'ε {{spent}} of {{budget}}', {
                spent: fmtNumber(spent),
                budget: fmtNumber(budget),
              }),
          rightLabel: t('benchmarks.budget.remaining', 'ε {{value}} remaining', {
            value: status.epsilon_remaining != null && Number.isFinite(status.epsilon_remaining)
              ? fmtNumber(status.epsilon_remaining)
              : '—',
          }),
          caption,
          pct,
          intent: pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'normal',
          ariaLabel: t('benchmarks.budget.aria', 'Differential privacy budget used'),
        } : undefined}
        emptyMessage={t('benchmarks.budget.unavailable', 'Budget unavailable')}
      />
      </BenchmarkStatusContent>
    </LayoutCard>
  );
}
