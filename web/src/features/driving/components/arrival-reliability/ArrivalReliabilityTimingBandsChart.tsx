import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import type {
  ArrivalReliabilityQueryState,
  DurationFormatter,
} from './types';

interface ArrivalReliabilityTimingBandsChartProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  formatDuration: DurationFormatter;
}

export function ArrivalReliabilityTimingBandsChart({
  analysis,
  state,
  formatDuration,
}: ArrivalReliabilityTimingBandsChartProps) {
  const { t } = useTranslation();
  const p50Name = t(
    'arrivalReliability.bandsChart.p50Series',
    'Observed p50',
  );
  const p90Name = t(
    'arrivalReliability.bandsChart.p90Series',
    'Observed p90',
  );
  const bufferName = t(
    'arrivalReliability.bandsChart.bufferSeries',
    'Observed p90 minus p50',
  );
  const rows = useMemo(
    () =>
      analysis.routes.slice(0, 10).map((route) => ({
        route: route.label,
        p50: route.p50DurationS,
        p90: route.p90DurationS,
        buffer: route.p90BufferS,
        spread: route.robustSpreadS,
        samples: route.samples,
      })),
    [analysis.routes],
  );
  const ready = state.isResolved && !state.error && rows.length > 0;
  const duration = (value: unknown) =>
    formatDuration(typeof value === 'number' ? value : null, {
      precision: 1,
    });

  return (
    <section data-testid="arrival-timing-bands">
      <ChartContainer
        title={t(
          'arrivalReliability.bandsChart.title',
          'Observed route timing bands',
        )}
        subtitle={t(
          'arrivalReliability.bandsChart.subtitle',
          'Historical p50, p90, and p90-minus-p50 evidence by supported route.',
        )}
        ariaLabel={t(
          'arrivalReliability.bandsChart.aria',
          'Observed median, ninetieth percentile, and p90-minus-p50 timing buffer for supported routes',
        )}
        ariaDescription={t(
          'arrivalReliability.bandsChart.description',
          'Durations are historical route summaries; the observed buffer is not an outcome promise.',
        )}
        height={360}
        chartKey="arrival-timing-bands"
        exportable={ready}
        exportFilename="arrival-timing-bands"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'route',
            label: t(
              'arrivalReliability.bandsChart.column.route',
              'Directional route',
            ),
          },
          {
            key: 'p50',
            label: t(
              'arrivalReliability.bandsChart.column.p50',
              'Observed p50',
            ),
            format: duration,
          },
          {
            key: 'p90',
            label: t(
              'arrivalReliability.bandsChart.column.p90',
              'Observed p90',
            ),
            format: duration,
          },
          {
            key: 'buffer',
            label: t(
              'arrivalReliability.bandsChart.column.buffer',
              'Observed p90 minus p50',
            ),
            format: duration,
          },
          {
            key: 'spread',
            label: t(
              'arrivalReliability.bandsChart.column.spread',
              'Scaled MAD',
            ),
            format: duration,
          },
          {
            key: 'samples',
            label: t(
              'arrivalReliability.bandsChart.column.samples',
              'Samples',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <ArrivalReliabilitySectionBody
            analysis={analysis}
            state={state}
            className="h-full min-h-0"
            skeletonHeight={320}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--glass-border)"
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="route"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    formatDuration(
                      typeof value === 'number' ? value : null,
                      { precision: 0 },
                    )
                  }
                />
                <Tooltip
                  content={<ChartTooltip valueFormatter={duration} />}
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  dataKey="p50"
                  name={p50Name}
                  fill={CHART_COLORS[0]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('p50') ?? false}
                />
                <Bar
                  dataKey="p90"
                  name={p90Name}
                  fill={CHART_COLORS[2]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('p90') ?? false}
                />
                <Bar
                  dataKey="buffer"
                  name={bufferName}
                  fill={CHART_COLORS[4]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('buffer') ?? false}
                />
              </BarChart>
            </ResponsiveContainer>
          </ArrivalReliabilitySectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
