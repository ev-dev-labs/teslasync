import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import type { ChargingStats } from './helpers';

interface HeroGaugesProps {
  stats: ChargingStats | null;
}

export function HeroGauges({ stats }: HeroGaugesProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-4 sm:p-6">
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
          <RadialGauge value={stats.count} max={Math.max(stats.count, 50)} label={t('charging.gauges.sessions', 'Sessions')} unit="" color="#00f0ff" />
          <RadialGauge value={Math.round(stats.totalEnergy)} max={Math.max(stats.totalEnergy, 500)} label={t('charging.gauges.energy', 'Energy')} unit="kWh" color="#10b981" />
          <RadialGauge value={parseFloat(fmtNumber(stats.totalCost ?? 0, 0))} max={Math.max(stats.totalCost ?? 0, 100)} label={t('charging.gauges.totalCost', 'Total Cost')} unit="$" color="#f59e0b" />
          <RadialGauge value={Math.round(stats.avgPower)} max={250} label={t('charging.gauges.avgPower', 'Avg Power')} unit="kW" color="#a855f7" />
          <div className="flex flex-col items-center text-center">
            <p className="text-2xl font-bold text-emerald-300">
              $<AnimatedNumber value={parseFloat(fmtNumber(stats.avgCostPerKwh ?? 0, 2))} decimals={3} />
            </p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
              {t('charging.gauges.avgCostPerKwh', 'Avg $/kWh')}
            </p>
          </div>
        </div>
      ) : (
        <EmptyState message={t('charging.noStats', 'No charging statistics available yet')} />
      )}
    </GlassPanel>
  );
}
