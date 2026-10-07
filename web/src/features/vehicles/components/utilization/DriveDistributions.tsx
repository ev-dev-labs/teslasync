import { Gauge, Ruler } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';

interface DriveDistributionsProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function DriveDistributions({
  summary,
  state,
}: DriveDistributionsProps) {
  const { t } = useTranslation();
  const { formatDistance, formatDuration } =
    useUtilizationDisplay();
  const durationGuard = summary.sampleGuards.durationDistribution;
  const distanceGuard = summary.sampleGuards.distanceDistribution;
  const driveCountName = t(
    'utilization.distribution.driveSeries',
    'Eligible drives',
  );

  const durationRows = useMemo(
    () =>
      summary.durationBands.map((band) => {
        const minimum = formatDuration(band.minInclusive);
        const maximum =
          band.maxExclusive != null
            ? formatDuration(band.maxExclusive)
            : null;
        const label =
          band.minInclusive === 0 && maximum
            ? t(
                'utilization.distribution.under',
                'Under {{maximum}}',
                { maximum },
              )
            : maximum
              ? t(
                  'utilization.distribution.between',
                  '{{minimum}}–{{maximum}}',
                  { minimum, maximum },
                )
              : t(
                  'utilization.distribution.plus',
                  '{{minimum}}+',
                  { minimum },
                );
        return {
          band: label,
          drives: band.driveCount,
          share: Math.round(band.share * 1_000) / 10,
        };
      }),
    [formatDuration, summary.durationBands, t],
  );
  const distanceRows = useMemo(
    () =>
      summary.distanceBands.map((band) => {
        const minimum = formatDistance(band.minInclusive, {
          precision: 0,
        });
        const maximum =
          band.maxExclusive != null
            ? formatDistance(band.maxExclusive, {
                precision: 0,
              })
            : null;
        const label =
          band.minInclusive === 0 && maximum
            ? t(
                'utilization.distribution.under',
                'Under {{maximum}}',
                { maximum },
              )
            : maximum
              ? t(
                  'utilization.distribution.between',
                  '{{minimum}}–{{maximum}}',
                  { minimum, maximum },
                )
              : t(
                  'utilization.distribution.plus',
                  '{{minimum}}+',
                  { minimum },
                );
        return {
          band: label,
          drives: band.driveCount,
          share: Math.round(band.share * 1_000) / 10,
        };
      }),
    [formatDistance, summary.distanceBands, t],
  );

  return (
    <section
      className="grid grid-cols-1 gap-4 xl:grid-cols-2"
      aria-label={t(
        'utilization.sections.distributions',
        'Drive duration and distance distributions',
      )}
      data-testid="utilization-distributions"
    >
      <ChartContainer
        className="h-full"
        title={t(
          'utilization.distribution.durationTitle',
          'Drive duration distribution',
        )}
        subtitle={t(
          'utilization.distribution.durationSubtitle',
          'Eligible drives grouped by logged duration.',
        )}
        ariaLabel={t(
          'utilization.distribution.durationAria',
          'Drive counts across logged duration bands',
        )}
        action={
          <Badge
            variant={durationGuard.sufficient ? 'success' : 'warning'}
            dot
          >
            {durationGuard.sufficient
              ? t(
                  'utilization.sample.supported',
                  '{{count}} observations',
                  { count: durationGuard.sampleSize },
                )
              : t(
                  'utilization.sample.limited',
                  'Limited sample: {{count}} of {{minimum}}',
                  {
                    count: durationGuard.sampleSize,
                    minimum: durationGuard.minimum,
                  },
                )}
          </Badge>
        }
        loading={state.isLoading}
        empty={false}
        height={340}
        exportable={
          !state.error &&
          !state.isLoading &&
          durationGuard.sampleSize > 0
        }
        exportFilename="utilization-duration-distribution"
        exportData={durationRows}
        data={state.error ? [] : durationRows}
        dataColumns={[
          {
            key: 'band',
            label: t(
              'utilization.columns.durationBand',
              'Duration band',
            ),
          },
          {
            key: 'drives',
            label: t('utilization.columns.drives', 'Drives'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'share',
            label: t(
              'utilization.columns.sampleShare',
              'Sample share (%)',
            ),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError
              error={state.error}
              onRetry={state.onRetry}
            />
          </div>
        ) : durationGuard.sampleSize === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            className="h-full"
            icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'utilization.distribution.durationEmpty',
              'No eligible drives include a usable duration.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={durationRows}
              layout="vertical"
              margin={{ top: 8, right: 8, left: 20, bottom: 0 }}
            >
              {chartGrid}
              <XAxis
                type="number"
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="band"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={76}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      t(
                        'utilization.value.drives',
                        '{{count}} drives',
                        {
                          count:
                            typeof value === 'number'
                              ? value
                              : 0,
                        },
                      )
                    }
                  />
                }
              />
              <Bar
                dataKey="drives"
                name={driveCountName}
                fill={CHART_COLORS[2]}
                radius={[0, 4, 4, 0]}
                maxBarSize={36}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>

      <ChartContainer
        className="h-full"
        title={t(
          'utilization.distribution.distanceTitle',
          'Drive distance distribution',
        )}
        subtitle={t(
          'utilization.distribution.distanceSubtitle',
          'Eligible drives grouped in canonical SI distance bands and converted for display.',
        )}
        ariaLabel={t(
          'utilization.distribution.distanceAria',
          'Drive counts across distance bands',
        )}
        action={
          <Badge
            variant={distanceGuard.sufficient ? 'success' : 'warning'}
            dot
          >
            {distanceGuard.sufficient
              ? t(
                  'utilization.sample.supported',
                  '{{count}} observations',
                  { count: distanceGuard.sampleSize },
                )
              : t(
                  'utilization.sample.limited',
                  'Limited sample: {{count}} of {{minimum}}',
                  {
                    count: distanceGuard.sampleSize,
                    minimum: distanceGuard.minimum,
                  },
                )}
          </Badge>
        }
        loading={state.isLoading}
        empty={false}
        height={340}
        exportable={
          !state.error &&
          !state.isLoading &&
          distanceGuard.sampleSize > 0
        }
        exportFilename="utilization-distance-distribution"
        exportData={distanceRows}
        data={state.error ? [] : distanceRows}
        dataColumns={[
          {
            key: 'band',
            label: t(
              'utilization.columns.distanceBand',
              'Distance band',
            ),
          },
          {
            key: 'drives',
            label: t('utilization.columns.drives', 'Drives'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'share',
            label: t(
              'utilization.columns.sampleShare',
              'Sample share (%)',
            ),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError
              error={state.error}
              onRetry={state.onRetry}
            />
          </div>
        ) : distanceGuard.sampleSize === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            className="h-full"
            icon={<Ruler className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'utilization.distribution.distanceEmpty',
              'No eligible drives include a usable positive distance.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={distanceRows}
              layout="vertical"
              margin={{ top: 8, right: 8, left: 20, bottom: 0 }}
            >
              {chartGrid}
              <XAxis
                type="number"
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="band"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={88}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      t(
                        'utilization.value.drives',
                        '{{count}} drives',
                        {
                          count:
                            typeof value === 'number'
                              ? value
                              : 0,
                        },
                      )
                    }
                  />
                }
              />
              <Bar
                dataKey="drives"
                name={driveCountName}
                fill={CHART_COLORS[1]}
                radius={[0, 4, 4, 0]}
                maxBarSize={36}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </section>
  );
}
