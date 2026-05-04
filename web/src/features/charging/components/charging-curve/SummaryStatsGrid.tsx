import { useTranslation } from 'react-i18next';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { SummaryStats } from './types';

function SummaryCard({
  label,
  value,
  unit,
  loading,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <GlassPanel className={cn('p-4 min-w-0 overflow-hidden', className)}>
      <p className="text-xs uppercase tracking-wider text-[var(--text-secondary)] truncate">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : (
        <p className="mt-1 text-lg xl:text-2xl font-semibold text-white truncate">
          {value}
          {unit && <span className="ml-1 text-xs xl:text-sm text-[var(--text-secondary)]">{unit}</span>}
        </p>
      )}
    </GlassPanel>
  );
}

interface SummaryStatsGridProps {
  stats: SummaryStats | null;
  currencySymbol: string;
}

export default function SummaryStatsGrid({ stats, currencySymbol }: SummaryStatsGridProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.05}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          label={t('charging.curve.totalSessions', 'Total Sessions')}
          value={fmtInt(stats?.totalSessions ?? 0)}
        />
        <SummaryCard
          label={t('charging.curve.totalEnergy', 'Total Energy')}
          value={fmtNumber(stats?.totalEnergy ?? 0)}
          unit="kWh"
        />
        <SummaryCard
          label={t('charging.curve.avgChargeRate', 'Avg Charge Rate')}
          value={fmtNumber(stats?.avgRate ?? 0)}
          unit="kW"
        />
        <SummaryCard
          label={t('charging.curve.peakRate', 'Peak Rate')}
          value={fmtNumber(stats?.peakRate ?? 0)}
          unit="kW"
        />
        <SummaryCard
          label={t('charging.curve.avgDuration', 'Avg Duration')}
          value={fmtInt(stats?.avgDuration ?? 0)}
          unit="min"
        />
        <SummaryCard
          label={t('charging.curve.totalCost', 'Total Cost')}
          value={`${currencySymbol}${fmtNumber(stats?.totalCost ?? 0)}`}
        />
      </div>
    </FadeIn>
  );
}
