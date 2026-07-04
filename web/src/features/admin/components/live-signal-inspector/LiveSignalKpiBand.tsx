/**
 * Live Signal Inspector — KPI band.
 *
 * Full-width responsive metric grid summarising the current live snapshot:
 * total signals plus a breakdown by layered-state source (L1 / stale / L2),
 * numeric-field count, and the age of the freshest value. Always renders —
 * values collapse to `0` / `—` before a vehicle is picked so the band never
 * disappears (design-language §8).
 */
import { useTranslation } from 'react-i18next';
import { Radio, Zap, Clock, Database, Hash, Timer } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { formatAge, type LiveSignalStats } from './liveSignalStats';

interface LiveSignalKpiBandProps {
  stats: LiveSignalStats;
}

export function LiveSignalKpiBand({ stats }: LiveSignalKpiBandProps) {
  const { t } = useTranslation();

  return (
    // Defensive: honour the "band never disappears" contract (design-language
    // §8) even if handed a partial/malformed snapshot — every count collapses
    // to 0 rather than rendering a blank card value.
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6">
      <MetricCard
        label={t('admin.liveSignals.kpi.total', 'Total Signals')}
        value={stats.total ?? 0}
        icon={<Radio className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('admin.liveSignals.kpi.live', 'Live · L1')}
        value={stats.live ?? 0}
        icon={<Zap className="h-5 w-5" aria-hidden="true" />}
        color="green"
        subtitle={t('admin.liveSignals.kpi.liveHint', 'Fresh in-process')}
      />
      <MetricCard
        label={t('admin.liveSignals.kpi.stale', 'Stale')}
        value={stats.stale ?? 0}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
        color="amber"
        subtitle={t('admin.liveSignals.kpi.staleHint', 'Past 2-min window')}
      />
      <MetricCard
        label={t('admin.liveSignals.kpi.legacy', 'Legacy · L2')}
        value={stats.legacy ?? 0}
        icon={<Database className="h-5 w-5" aria-hidden="true" />}
        color="blue"
        subtitle={t('admin.liveSignals.kpi.legacyHint', 'Redis, unknown age')}
      />
      <MetricCard
        label={t('admin.liveSignals.kpi.numeric', 'Numeric Fields')}
        value={stats.numeric ?? 0}
        icon={<Hash className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('admin.liveSignals.kpi.freshest', 'Freshest')}
        value={formatAge(stats.freshestAgeMs)}
        icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
        subtitle={t('admin.liveSignals.kpi.freshestHint', 'Newest value age')}
      />
    </div>
  );
}
