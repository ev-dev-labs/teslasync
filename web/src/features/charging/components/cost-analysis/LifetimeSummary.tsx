import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { CoreStats, LifetimeMetrics } from './types';

interface LifetimeSummaryProps {
  lifetimeMetrics: LifetimeMetrics | null;
  coreStats: CoreStats | null;
}

function LifetimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-2)] p-3">
      <p className="truncate text-[10px] text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export function LifetimeSummary({ lifetimeMetrics, coreStats }: LifetimeSummaryProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel glow="cyan" className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <TrendingUp className="h-4 w-4 text-cyan-400" />
        {t('costAnalysis.lifetime.title', 'Lifetime Summary')}
      </h3>
      {lifetimeMetrics && coreStats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          <LifetimeMetric
            label={t('costAnalysis.lifetime.totalSpent', 'Total Spent')}
            value={`$${fmtNumber(coreStats.totalCost, 2)}`}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.totalEnergy', 'Total Energy')}
            value={fmtWithUnit(coreStats.totalEnergy, 'kWh', 1)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.totalSessions', 'Total Sessions')}
            value={fmtInt(coreStats.count)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.avgSessionCost', 'Avg Session Cost')}
            value={`$${fmtNumber(lifetimeMetrics.avgSessionCost, 2)}`}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.avgEnergy', 'Avg Energy / Session')}
            value={fmtWithUnit(lifetimeMetrics.avgSessionEnergy, 'kWh', 1)}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.avgDuration', 'Avg Duration')}
            value={`${fmtNumber(lifetimeMetrics.avgDuration, 0)} min`}
          />
          <LifetimeMetric
            label={t('costAnalysis.lifetime.freeSessions', 'Free Sessions')}
            value={`${fmtInt(lifetimeMetrics.freeCount)} (${fmtWithUnit(lifetimeMetrics.freeEnergy, 'kWh', 1)})`}
          />
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-[var(--text-muted)]">
          {t('costAnalysis.lifetime.noData', 'No data')}
        </div>
      )}
    </GlassPanel>
  );
}
