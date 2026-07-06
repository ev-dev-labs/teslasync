import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging, Zap, Gauge, TrendingUp, Timer, Wallet } from 'lucide-react';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import type { NeonColor } from '@/lib/tokens';
import type { SummaryStats } from './types';

interface SummaryStatsGridProps {
  stats: SummaryStats | null;
  loading?: boolean;
}

const GRID = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6';

interface CardSpec {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
  color: NeonColor;
}

export default function SummaryStatsGrid({ stats, loading }: SummaryStatsGridProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  const cards = useMemo<CardSpec[]>(
    () => [
      {
        key: 'totalSessions',
        label: t('charging.curve.totalSessions', 'Total Sessions'),
        value: fmtInt(stats?.totalSessions ?? 0),
        icon: <BatteryCharging className="h-5 w-5" aria-hidden="true" />,
        color: 'cyan',
      },
      {
        key: 'totalEnergy',
        label: t('charging.curve.totalEnergy', 'Total Energy'),
        value: `${fmtNumber(stats?.totalEnergy ?? 0)} kWh`,
        icon: <Zap className="h-5 w-5" aria-hidden="true" />,
        color: 'green',
      },
      {
        key: 'avgRate',
        label: t('charging.curve.avgChargeRate', 'Avg Charge Rate'),
        value: `${fmtNumber(stats?.avgRate ?? 0)} kW`,
        icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
        color: 'blue',
      },
      {
        key: 'peakRate',
        label: t('charging.curve.peakRate', 'Peak Rate'),
        value: `${fmtNumber(stats?.peakRate ?? 0)} kW`,
        icon: <TrendingUp className="h-5 w-5" aria-hidden="true" />,
        color: 'purple',
      },
      {
        key: 'avgDuration',
        label: t('charging.curve.avgDuration', 'Avg Duration'),
        value: `${fmtInt(stats?.avgDuration ?? 0)} min`,
        icon: <Timer className="h-5 w-5" aria-hidden="true" />,
        color: 'amber',
      },
      {
        key: 'totalCost',
        label: t('charging.curve.totalCost', 'Total Cost'),
        value: formatCurrency(stats?.totalCost ?? 0),
        icon: <Wallet className="h-5 w-5" aria-hidden="true" />,
        color: 'green',
      },
    ],
    [t, stats, formatCurrency],
  );

  if (loading) {
    return (
      <div
        className={GRID}
        role="status"
        aria-busy="true"
        aria-label={t('charging.curve.summaryLoading', 'Loading summary metrics')}
        data-testid="charging-summary-skeleton"
      >
        {Array.from({ length: cards.length }).map((_, i) => (
          <GlassPanel key={i} className="p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-20" />
          </GlassPanel>
        ))}
      </div>
    );
  }

  return (
    <div className={GRID}>
      {cards.map((c) => (
        <MetricCard key={c.key} label={c.label} value={c.value} icon={c.icon} color={c.color} />
      ))}
    </div>
  );
}
