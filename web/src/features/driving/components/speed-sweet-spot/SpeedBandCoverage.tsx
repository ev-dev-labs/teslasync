import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar, Cell, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS,
  ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';


import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface SpeedBandCoverageProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
  resolved: boolean;
  retained: boolean;
  className?: string;
}

export function SpeedBandCoverage({
  summary,
  state,
  resolved,
  retained,
  className,
}: SpeedBandCoverageProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { convertDistance, distanceUnit, formatBand } =
    useSpeedSweetSpotDisplay();
  const distanceName = t('sweetSpot.coverage.distanceSeries', 'Distance');
  const drivesName = t('sweetSpot.coverage.drivesSeries', 'Drive count');
  const rows = useMemo(
    () =>
      summary.bands.map((band) => ({
        key: band.key,
        band: formatBand(band.fromKph, band.toKph),
        distance: Math.round(convertDistance(band.distanceM) * 10) / 10,
        drives: band.drives,
        share: Math.round(band.distanceShare * 1_000) / 10,
        qualification: band.qualified
          ? t('sweetSpot.qualified', 'Qualified')
          : t('sweetSpot.unqualified', 'Below sample floor'),
        winner: band.key === summary.sweetSpot?.key ? 1 : 0,
        qualified: band.qualified ? 1 : 0,
      })),
    [
      convertDistance, formatBand, summary.bands, summary.sweetSpot?.key, t,
    ],
  );

  return (
    <section
      className={className}
      aria-label={t(
        'sweetSpot.sections.coverage',
        'Speed-band distance and drive coverage',
      )}
      data-testid="speed-sweet-spot-coverage"
    >
      <ChartContainer
        className="h-full"
        title={t('sweetSpot.coverage.title', 'Evidence coverage by speed band')}
        subtitle={t(
          'sweetSpot.coverage.subtitle',
          'Bars show observed distance and the line shows eligible drives; muted bars are below the qualification floor.',
        )}
        ariaLabel={t(
          'sweetSpot.coverage.aria',
          'Observed distance and drive count distributed across whole-drive average-speed bands',
        )}
        action={
          <div className="flex flex-wrap items-center gap-2">
          {retained && <Badge variant="warning" dot>{t('driving.brief.retained', 'Retained source')}</Badge>}
          <Badge variant={resolved && state.error == null ? 'info' : 'neutral'} dot>
            {resolved && state.error == null
              ? t('sweetSpot.coverage.qualifiedCount', '{{count}} qualified', {
                  count: summary.qualifiedBandCount,
                })
              : t('driving.brief.unavailable', 'Source unavailable')}
          </Badge>
          </div>
        }
        chartKey="speed-sweet-spot-coverage"
        loading={state.isLoading}
        error={state.error}
        onRetry={state.onRetry}
        empty={false}
        height={330}
        exportable={Boolean(resolved) && !state.error && !state.isLoading && rows.length > 0}
        exportFilename="speed-sweet-spot-coverage"
        exportData={rows}
        data={!resolved || state.error ? [] : rows}
        dataColumns={[
          { key: 'band', label: t('sweetSpot.col.band', 'Speed band') },
          {
            key: 'distance',
            label: `${distanceName} (${distanceUnit})`,
          },
          { key: 'drives', label: t('sweetSpot.col.drives', 'Drives') },
          { key: 'share', label: t('sweetSpot.col.distanceShare', 'Distance share') },
          {
            key: 'qualification',
            label: t('sweetSpot.col.qualification', 'Qualification'),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !resolved ? (
            <EmptyState className="h-full" message={t('driving.brief.unavailable', 'Source unavailable')} />
          ) : rows.length === 0 ? (
            <EmptyState /* no-action: the vehicle and range controls recover coverage. */
              className="h-full"
              icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sweetSpot.coverage.empty',
                'No eligible distance is available to distribute across speed bands.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 10, right: 8, left: 0, bottom: 4 }}
              >
                {chartGrid}
                <XAxis
                  dataKey="band"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={10}
                />
                <YAxis
                  yAxisId="distance"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(value) => fmtNumber(value)}
                />
                <YAxis
                  yAxisId="drives"
                  orientation="right"
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === distanceName
                          ? `${fmtNumber(value)} ${distanceUnit}`
                          : t('sweetSpot.coverage.driveValue', '{{count}} drives', {
                              count: Number(value),
                            })
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="distance"
                  dataKey="distance"
                  name={distanceName}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                  hide={hiddenSeries?.isHidden('distance') ?? false}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={
                        row.winner === 1
                          ? CHART_COLORS[1]
                          : row.qualified === 1
                            ? CHART_COLORS[0]
                            : CHART_COLORS[5]
                      }
                      fillOpacity={row.qualified === 1 ? 0.82 : 0.35}
                    />
                  ))}
                </Bar>
                <Line
                  yAxisId="drives"
                  type="monotone"
                  dataKey="drives"
                  name={drivesName}
                  stroke={CHART_COLORS[4]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  hide={hiddenSeries?.isHidden('drives') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
