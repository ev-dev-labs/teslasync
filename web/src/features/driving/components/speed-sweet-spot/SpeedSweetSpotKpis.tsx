import { Crosshair, Gauge, Leaf, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';

import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface SpeedSweetSpotKpisProps extends SpeedSweetSpotSectionState {
  summary: SweetSpotResult;
}

export function SpeedSweetSpotKpis({
  summary,
  isLoading,
  error,
  onRetry,
}: SpeedSweetSpotKpisProps) {
  const { t } = useTranslation();
  const { formatBand, formatDistance, formatEfficiency } =
    useSpeedSweetSpotDisplay();
  const winning = summary.sweetSpot;
  const gap = summary.observedGapShare;
  const gapLabel =
    gap != null
      ? `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${fmtNumber(
          Math.abs(gap) * 100,
          0,
        )}%`
      : '—';

  return (
    <section
      aria-label={t('sweetSpot.kpis', 'Sweet spot summary metrics')}
      data-testid="speed-sweet-spot-kpis"
    >
      <Grid cols={KPI_COLUMNS} gap={4}>
        {error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={error} onRetry={onRetry} />
          </GlassPanel>
        ) : isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t('sweetSpot.spot', 'Best qualified band')}
              value={
                winning != null
                  ? formatBand(winning.fromKph, winning.toKph)
                  : '—'
              }
              subtitle={
                winning != null
                  ? t(
                      'sweetSpot.kpi.bandSample',
                      '{{drives}} drives · {{distance}} observed',
                      {
                        drives: winning.drives,
                        distance: formatDistance(winning.distanceM),
                      },
                    )
                  : t(
                      'sweetSpot.kpi.noQualified',
                      'No band meets the sample floor',
                    )
              }
              icon={<Crosshair className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('sweetSpot.atSpot', 'Consumption in band')}
              value={formatEfficiency(winning?.whPerKm)}
              subtitle={t(
                'sweetSpot.kpi.weightedBand',
                'distance-weighted within this band',
              )}
              icon={<Leaf className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('sweetSpot.overall', 'Overall weighted consumption')}
              value={formatEfficiency(summary.overallWhPerKm)}
              subtitle={
                summary.historyCapReached
                  ? t(
                      'sweetSpot.kpi.cappedWindowSample',
                      '{{eligible}} eligible · returned window hit the row cap',
                      { eligible: summary.eligible },
                    )
                  : t(
                      'sweetSpot.kpi.windowSample',
                      '{{eligible}} eligible of {{observed}} returned drives',
                      {
                        eligible: summary.eligible,
                        observed: summary.observed,
                      },
                    )
              }
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('sweetSpot.observedGap', 'Observed efficiency gap')}
              value={gapLabel}
              subtitle={t(
                'sweetSpot.observedGapHint',
                'descriptive comparison, not a savings forecast',
              )}
              icon={<Scale className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            {summary.observed === 0 ? (
              <EmptyState /* no-action: vehicle and range selectors are available above. */
                className="col-span-full py-6"
                icon={<Gauge className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'sweetSpot.emptyWindow',
                  'No drives were returned for this selected window.',
                )}
              />
            ) : null}
          </>
        )}
      </Grid>
    </section>
  );
}
