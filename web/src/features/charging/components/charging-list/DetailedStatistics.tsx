import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat';
import { formatDuration } from '../ChargingSessionCard';
import type { ChargingStats, EnhancedStats } from './helpers';

interface DetailedStatisticsProps {
  stats: ChargingStats;
  enhanced: EnhancedStats;
}

export function DetailedStatistics({ stats, enhanced }: DetailedStatisticsProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-neon-cyan" />
        {t('charging.stats.detailedStatistics', 'Detailed Statistics')}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 text-center">
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]"><AnimatedNumber value={stats.count} /></p>
          <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.totalSessions', 'Total Sessions')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(enhanced.avgDuration)}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.avgDuration', 'Avg Duration')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-purple-300">{fmtWithUnit(stats.avgPower, 'kW')}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.avgPower', 'Avg Power')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{enhanced.mostCommonType[0]}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.topCharger', 'Top Charger')} ({enhanced.mostCommonType[1]}×)</p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-300">${fmtNumber(stats.totalCost)}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.totalCost', 'Total Cost')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-emerald-300">${fmtNumber(stats.avgCostPerKwh)}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{t('charging.stats.avgCostPerKwh', 'Avg $/kWh')}</p>
        </div>
      </div>
    </GlassPanel>
  );
}
