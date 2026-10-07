import { Flame, Gauge, Target, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';

import type { TargetSummary } from '../../lib/efficiencyTarget';
import type { EfficiencyTargetSectionState } from './types';
import { useEfficiencyTargetDisplay } from './useEfficiencyTargetDisplay';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface EfficiencyTargetKpisProps {
  summary: TargetSummary;
  targetWhPerKm: number;
  state: EfficiencyTargetSectionState;
}

export function EfficiencyTargetKpis({
  summary,
  targetWhPerKm,
  state,
}: EfficiencyTargetKpisProps) {
  const { t } = useTranslation();
  const { formatEfficiency } = useEfficiencyTargetDisplay();

  return (
    <section
      aria-label={t(
        'effTarget.kpis',
        'Efficiency target summary metrics',
      )}
      data-testid="efficiency-target-kpis"
    >
      <Grid cols={KPI_COLUMNS} gap={4}>
        {state.error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </GlassPanel>
        ) : state.isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t('effTarget.target', 'Target')}
              value={formatEfficiency(targetWhPerKm)}
              subtitle={t(
                'effTarget.kpi.canonical',
                'Saved canonically in Wh/km',
              )}
              icon={<Target className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('effTarget.streak', 'Completed-week streak')}
              value={t('effTarget.weeks', '{{count}} weeks', {
                count: summary.currentStreak,
              })}
              subtitle={t(
                'effTarget.longest',
                'Longest completed run: {{count}}',
                { count: summary.longestStreak },
              )}
              icon={<Flame className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('effTarget.hitRate', 'Completed-week hit rate')}
              value={
                summary.hitRate != null
                  ? `${fmtNumber(summary.hitRate * 100, 0)}%`
                  : '—'
              }
              subtitle={t(
                'effTarget.ofWeeks',
                'Across {{count}} completed weeks',
                { count: summary.completedWeeks.length },
              )}
              icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('effTarget.overall', 'Observed overall')}
              value={formatEfficiency(summary.overallWhPerKm)}
              subtitle={t(
                'effTarget.analyzed',
                '{{eligible}} of {{observed}} drives eligible',
                {
                  eligible: summary.analyzed,
                  observed: summary.observed,
                },
              )}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            {summary.analyzed === 0 ? (
              <EmptyState
                className="col-span-full py-6"
                icon={<Target className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'effTarget.noData',
                  'No drives with at least 1 km of distance and measured energy are available in this observed window.',
                )}
                actionTo={{
                  label: t('effTarget.browseDrives', 'Browse drives'),
                  to: '/drives',
                }}
              />
            ) : null}
          </>
        )}
      </Grid>
    </section>
  );
}
