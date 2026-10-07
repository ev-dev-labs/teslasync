import { Ruler } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CHART_COLORS,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';

import type { DistanceBand, ExplorerSummary } from '../../lib/explorer';
import type { ExplorerDistanceDisplay, ExplorerSectionState } from './types';

interface DistanceBandsChartProps extends ExplorerDistanceDisplay {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function DistanceBandsChart({
  summary,
  state,
  formatDistance,
  className,
}: DistanceBandsChartProps) {
  const { t } = useTranslation();

  const labelFor = (band: DistanceBand): string => {
    if (band.key === 'local' && band.maxM != null) {
      return t('explorer.distanceBands.local', 'Under {{max}}', {
        max: formatDistance(band.maxM, { precision: 0 }),
      });
    }
    if (band.key === 'near' && band.maxM != null) {
      return t('explorer.distanceBands.near', '{{min}}–{{max}}', {
        min: formatDistance(band.minM, { precision: 0 }),
        max: formatDistance(band.maxM, { precision: 0 }),
      });
    }
    if (band.key === 'regional' && band.maxM != null) {
      return t('explorer.distanceBands.regional', '{{min}}–{{max}}', {
        min: formatDistance(band.minM, { precision: 0 }),
        max: formatDistance(band.maxM, { precision: 0 }),
      });
    }
    return t('explorer.distanceBands.far', '{{min}} and beyond', {
      min: formatDistance(band.minM, { precision: 0 }),
    });
  };

  const rows = summary.distanceBands.map((band) => ({
    band: labelFor(band),
    destinations: band.destinations,
    arrivals: band.arrivals,
  }));
  const hasDestinations = summary.destinations.length > 0;
  const chartReady = summary.evidence.baseSufficient && hasDestinations;
  const subtitle =
    summary.radiusM != null
      ? t(
          'explorer.distanceBands.radiusSubtitle',
          'Visit-weighted p90 radius: {{radius}}',
          {
            radius: formatDistance(summary.radiusM, { precision: 0 }),
          },
        )
      : t(
          'explorer.distanceBands.subtitle',
          'Destination clusters and arrival volume by base-relative distance',
        );

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.distanceBands',
        'Base-relative distance and radius bands',
      )}
      data-testid="explorer-distance-bands"
    >
      <ChartContainer
        className="h-full"
        title={t('explorer.distanceBands.title', 'Distance & radius bands')}
        subtitle={subtitle}
        ariaLabel={t(
          'explorer.distanceBands.aria',
          'Destination and arrival counts grouped by distance from the inferred observed base',
        )}
        loading={state.isLoading}
        empty={false}
        height={330}
        chartKey="explorer-distance-bands"
        exportable={!state.error && !state.isLoading && chartReady}
        exportFilename="explorer-distance-bands"
        exportData={chartReady ? rows : []}
        data={state.error || !chartReady ? [] : rows}
        dataColumns={[
          {
            key: 'band',
            label: t('explorer.distanceBands.band', 'Distance band'),
          },
          {
            key: 'destinations',
            label: t(
              'explorer.distanceBands.destinations',
              'Destinations',
            ),
          },
          {
            key: 'arrivals',
            label: t('explorer.distanceBands.arrivals', 'Arrivals'),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !chartReady ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={<Ruler className="h-8 w-8" aria-hidden="true" />}
              message={
                hasDestinations
                  ? t(
                      'explorer.distanceBands.needsBase',
                      'At least three located arrivals, including two in the inferred-base cluster, are required for distance bands.',
                    )
                  : t(
                      'explorer.distanceBands.empty',
                      'No non-base destinations are available for distance bands.',
                    )
              }
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 12, right: 8, left: -8, bottom: 0 }}
              >
                {chartGrid}
                <XAxis
                  dataKey="band"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend />
                <Bar
                  dataKey="destinations"
                  name={t(
                    'explorer.distanceBands.destinationSeries',
                    'Destinations',
                  )}
                  fill={CHART_COLORS[2]}
                  radius={[4, 4, 0, 0]}
                  hide={hiddenSeries?.isHidden('destinations')}
                />
                <Bar
                  dataKey="arrivals"
                  name={t(
                    'explorer.distanceBands.arrivalSeries',
                    'Arrivals',
                  )}
                  fill={CHART_COLORS[0]}
                  radius={[4, 4, 0, 0]}
                  hide={hiddenSeries?.isHidden('arrivals')}
                />
              </BarChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
