import { useTranslation } from 'react-i18next';
import { Home, Bolt, Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { formatDuration } from '../ChargingSessionCard';
import type { ChargingStats } from './helpers';

interface QuickMetricsProps {
  stats: ChargingStats | null;
}

export function QuickMetrics({ stats }: QuickMetricsProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="p-3 sm:p-5">
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 text-center">
          <div>
            <p className="text-lg font-bold text-neon-green"><AnimatedNumber value={stats.homeCount} /></p>
            <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
              <Home className="h-3 w-3" /> {t('charging.metrics.home', 'Home')}
            </p>
          </div>
          <div>
            <p className="text-lg font-bold text-neon-red"><AnimatedNumber value={stats.scCount} /></p>
            <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
              <Bolt className="h-3 w-3" /> {t('charging.metrics.supercharger', 'Supercharger')}
            </p>
          </div>
          <div>
            <p className="text-lg font-bold text-neon-amber"><AnimatedNumber value={stats.dcCount} /></p>
            <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
              <Zap className="h-3 w-3" /> {t('charging.metrics.dcFast', 'DC Fast')}
            </p>
          </div>
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(stats.totalDuration)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{t('charging.metrics.totalTime', 'Total Time')}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">${fmtInt(stats.totalCost / 12)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{t('charging.metrics.monthlyAvg', 'Monthly Avg')}</p>
          </div>
          <div>
            <p className="text-lg font-bold text-[var(--text-primary)]">{fmtWithUnit(stats.totalEnergy / stats.count, 'kWh')}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{t('charging.metrics.perSession', 'Per Session')}</p>
          </div>
        </div>
      ) : (
        <EmptyState message={t('charging.noMetrics', 'No charging metrics available yet')} />
      )}
    </GlassPanel>
  );
}
