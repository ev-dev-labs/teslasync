import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UsageCard } from '@/components/data-display';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';

export function PrivacyBudgetPanel({
  status,
}: {
  status: BenchmarkPrivacyStatus | null;
}) {
  const { t } = useTranslation();
  const spent = status?.epsilon_spent ?? 0;
  const budget = status?.epsilon_budget ?? 0;
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  return (
    <GlassPanel className="p-5 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Gauge className="h-5 w-5 text-purple-300" aria-hidden />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('benchmarks.budget.title', 'Privacy budget')}
        </h2>
      </div>
      <UsageCard
        budget={{
          headline: status
            ? t('benchmarks.budget.headline', 'ε {{spent}} of {{budget}}', {
                spent: fmtNumber(spent, 2),
                budget: fmtNumber(budget, 2),
              })
            : t('benchmarks.budget.unavailable', 'Budget unavailable'),
          rightLabel: t('benchmarks.budget.remaining', 'ε {{value}} remaining', {
            value: fmtNumber(status?.epsilon_remaining ?? 0, 2),
          }),
          caption: t(
            'benchmarks.budget.caption',
            'Epsilon composes across new source versions. Reading or refreshing an existing release costs nothing.',
          ),
          pct,
          intent: pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'normal',
          ariaLabel: t('benchmarks.budget.aria', 'Differential privacy budget used'),
        }}
        emptyMessage={t('benchmarks.budget.empty', 'Opt in to start privacy accounting.')}
      />
    </GlassPanel>
  );
}

