import { useTranslation } from 'react-i18next';
import { Home, Bolt, Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { AnimatedNumber, Currency } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { fmtWithUnit } from '@/lib/numberFormat';
import { formatDuration } from '../ChargingSessionCard';
import type { ChargingStats } from './helpers';

interface QuickMetricsProps {
  stats: ChargingStats | null;
}

/** Months used to derive the rolling "Monthly Avg" cost from the running total. */
const MONTHS_PER_YEAR = 12;

export function QuickMetrics({ stats }: QuickMetricsProps) {
  const { t } = useTranslation();

  if (!stats) {
    return (
      <GlassPanel className="p-3 sm:p-5">
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('charging.noMetrics', 'No charging metrics available yet')} />
      </GlassPanel>
    );
  }

  // Null-safety: `stats` is an already-computed aggregate, but a partial payload
  // must degrade to zeros rather than feed NaN/Infinity into the formatters.
  const homeCount = stats.homeCount ?? 0;
  const scCount = stats.scCount ?? 0;
  const dcCount = stats.dcCount ?? 0;
  const count = stats.count ?? 0;
  // computeStats never emits count === 0 (an empty fleet yields a null stats,
  // handled above), but a hand-built object could — guard the divide so the
  // per-session tile never renders from an Infinity/NaN quotient.
  const perSessionEnergy = count > 0 ? (stats.totalEnergy ?? 0) / count : 0;
  const monthlyAvgCost = (stats.totalCost ?? 0) / MONTHS_PER_YEAR;

  return (
    <GlassPanel className="p-3 sm:p-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 text-center">
        <div>
          <p className="text-lg font-bold text-emerald-300"><AnimatedNumber value={homeCount} /></p>
          <p className="text-2xs text-[var(--text-muted)] flex items-center justify-center gap-1">
            <Home className="h-3 w-3" aria-hidden="true" /> {t('charging.metrics.home', 'Home')}
          </p>
        </div>
        <div>
          <p className="text-lg font-bold text-rose-300"><AnimatedNumber value={scCount} /></p>
          <p className="text-2xs text-[var(--text-muted)] flex items-center justify-center gap-1">
            <Bolt className="h-3 w-3" aria-hidden="true" /> {t('charging.metrics.supercharger', 'Supercharger')}
          </p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-300"><AnimatedNumber value={dcCount} /></p>
          <p className="text-2xs text-[var(--text-muted)] flex items-center justify-center gap-1">
            <Zap className="h-3 w-3" aria-hidden="true" /> {t('charging.metrics.dcFast', 'DC Fast')}
          </p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(stats.totalDuration)}</p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.metrics.totalTime', 'Total Time')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]"><Currency value={monthlyAvgCost} precision={0} /></p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.metrics.monthlyAvg', 'Monthly Avg')}</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{fmtWithUnit(perSessionEnergy, 'kWh')}</p>
          <p className="text-2xs text-[var(--text-muted)]">{t('charging.metrics.perSession', 'Per Session')}</p>
        </div>
      </div>
    </GlassPanel>
  );
}
