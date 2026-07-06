import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { ChargingStats } from './helpers';

interface HeroGaugesProps {
  stats: ChargingStats | null;
}

export function HeroGauges({ stats }: HeroGaugesProps) {
  const { t } = useTranslation();

  // Null-safe reads. `ChargingStats` types every metric as `number`, but the
  // wire shape can omit individual fields; coercing here keeps NaN out of the
  // SVG gauges (an unguarded `stats.count` produced `strokeDashoffset={NaN}`)
  // and out of the animated total.
  const count = stats?.count ?? 0;
  const totalEnergy = stats?.totalEnergy ?? 0;
  const totalCost = stats?.totalCost ?? 0;
  const avgPower = stats?.avgPower ?? 0;
  const avgCostPerKwh = stats?.avgCostPerKwh ?? 0;

  return (
    <GlassPanel className="p-4 sm:p-6">
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
          <RadialGauge value={count} max={Math.max(count, 50)} label={t('charging.gauges.sessions', 'Sessions')} unit="" color="#00f0ff" />
          <RadialGauge value={Math.round(totalEnergy)} max={Math.max(totalEnergy, 500)} label={t('charging.gauges.energy', 'Energy')} unit="kWh" color="#10b981" />
          {/* Round with Math.round, not parseFloat(fmtNumber(x, 0)): once the
              total crosses 1,000 the locale formatter inserts a thousands
              separator (e.g. "1,234") and parseFloat truncates it to 1. */}
          <RadialGauge value={Math.round(totalCost)} max={Math.max(totalCost, 100)} label={t('charging.gauges.totalCost', 'Total Cost')} unit="$" color="#f59e0b" />
          <RadialGauge value={Math.round(avgPower)} max={250} label={t('charging.gauges.avgPower', 'Avg Power')} unit="kW" color="#a855f7" />
          <div className="flex flex-col items-center text-center">
            <p className="text-2xl font-bold text-emerald-300">
              $<AnimatedNumber value={avgCostPerKwh} decimals={3} />
            </p>
            <p className="text-2xs text-[var(--text-muted)] uppercase tracking-wider mt-1">
              {t('charging.gauges.avgCostPerKwh', 'Avg $/kWh')}
            </p>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('charging.noStats', 'No charging statistics available yet')} />
      )}
    </GlassPanel>
  );
}
