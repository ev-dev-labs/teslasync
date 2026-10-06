import { useTranslation } from 'react-i18next';
import { UsageCard } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import type { DataState } from '@/api/dataState';
import { BenchmarkStatusContent } from './BenchmarkStatusContent';

import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function PrivacyBudgetPanel({
  status,
  source,
}: {
  status: BenchmarkPrivacyStatus | null;
  source?: DataState<BenchmarkPrivacyStatus>;
}) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const spent = status?.epsilon_spent ?? 0;
  const budget = status?.epsilon_budget ?? 0;
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  return (
    <LayoutCard title={t('benchmarks.budget.title', 'Privacy budget')}>
      <BenchmarkStatusContent source={source} label={t('benchmarks.budget.title', 'Privacy budget')}>
      <UsageCard
        budget={status ? {
          headline: t('benchmarks.budget.headline', 'ε {{spent}} of {{budget}}', {
                spent: fmtNumber(spent),
                budget: fmtNumber(budget),
              }),
          rightLabel: t('benchmarks.budget.remaining', 'ε {{value}} remaining', {
            value: fmtNumber(status?.epsilon_remaining ?? 0),
          }),
          caption: t(
            'benchmarks.budget.caption',
            'Epsilon composes across new source versions. Reading or refreshing an existing release costs nothing.',
          ),
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
