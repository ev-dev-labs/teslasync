import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { AnimatedNumber, Currency } from '@/components/data-display';
import { fmtWithUnit } from '@/lib/numberFormat';
import { formatDuration } from '../ChargingSessionCard';
import type { ChargingStats, EnhancedStats } from './helpers';

interface DetailedStatisticsProps {
  stats: ChargingStats;
  enhanced: EnhancedStats;
}

/** Placeholder tuple used when the caller passes a malformed `mostCommonType`. */
const FALLBACK_COMMON_TYPE: [string, number] = ['—', 0];

export function DetailedStatistics({ stats, enhanced }: DetailedStatisticsProps) {
  const { t } = useTranslation();

  // Null-safety: these props are already-computed aggregates, but guard every
  // field so a partial/undefined payload degrades to a placeholder instead of
  // crashing — reading `mostCommonType[0]` off an undefined tuple would throw.
  const [topType, topCount] = enhanced?.mostCommonType ?? FALLBACK_COMMON_TYPE;

  return (
    <GlassPanel className="p-5">
      <h3 className="section-title flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-neon-cyan" aria-hidden="true" />
        {t('charging.stats.detailedStatistics', 'Detailed Statistics')}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 text-center">
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]"><AnimatedNumber value={stats?.count ?? 0} /></p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.stats.totalSessions', 'Total Sessions')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(enhanced?.avgDuration ?? 0)}</p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.stats.avgDuration', 'Avg Duration')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-purple-300">{fmtWithUnit(stats?.avgPower ?? 0, 'kW')}</p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.stats.avgPower', 'Avg Power')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{topType || '—'}</p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.stats.topCharger', 'Top Charger')} ({topCount ?? 0}×)</p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-300"><Currency value={stats?.totalCost} /></p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.stats.totalCost', 'Total Cost')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-emerald-300"><Currency value={stats?.avgCostPerKwh} precision={3} /></p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.stats.avgCostPerKwh', 'Avg $/kWh')}</p>
        </div>
      </div>
    </GlassPanel>
  );
}
