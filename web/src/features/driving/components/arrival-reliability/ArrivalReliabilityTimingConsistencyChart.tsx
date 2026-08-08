import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import type { ArrivalReliabilityQueryState } from './types';

interface ArrivalReliabilityTimingConsistencyChartProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
}

export function ArrivalReliabilityTimingConsistencyChart({
  analysis,
  state,
  locale,
}: ArrivalReliabilityTimingConsistencyChartProps) {
  const { t } = useTranslation();
  const consistencyName = t(
    'arrivalReliability.consistencyChart.consistencySeries',
    'Timing consistency index',
  );
  const allowanceName = t(
    'arrivalReliability.consistencyChart.allowanceSeries',
    'Observed within-allowance share',
  );
  const rows = useMemo(
    () =>
      analysis.routeRankings.slice(0, 10).map((route) => ({
        route: route.label,
        consistency: Math.round(route.timingConsistencyIndex * 10) / 10,
        allowance: Math.round(route.withinAllowanceShare * 1_000) / 10,
        samples: route.samples,
        support: Math.round(route.support.index * 10) / 10,
      })),
    [analysis.routeRankings],
  );
  const ready = state.isResolved && !state.error && rows.length > 0;

  return (
    <section data-testid="arrival-consistency-chart">
      <ChartContainer
        title={t(
          'arrivalReliability.consistencyChart.title',
          'Route timing consistency',
        )}
        subtitle={t(
          'arrivalReliability.consistencyChart.subtitle',
          'Top supported directional routes; the index and allowance share are observed in the same returned sample.',
        )}
        ariaLabel={t(
          'arrivalReliability.consistencyChart.aria',
          'Timing consistency index and observed within-allowance share for supported directional routes',
        )}
        ariaDescription={t(
          'arrivalReliability.consistencyChart.description',
          'The table includes route sample counts and the separate route support index.',
        )}
        height={360}
        chartKey="arrival-timing-consistency"
        exportable={ready}
        exportFilename="arrival-timing-consistency"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'route',
            label: t(
              'arrivalReliability.consistencyChart.column.route',
              'Directional route',
            ),
          },
          {
            key: 'consistency',
            label: t(
              'arrivalReliability.consistencyChart.column.consistency',
              'Timing consistency index',
            ),
          },
          {
            key: 'allowance',
            label: t(
              'arrivalReliability.consistencyChart.column.allowance',
              'Observed within-allowance share (%)',
            ),
          },
          {
            key: 'samples',
            label: t(
              'arrivalReliability.consistencyChart.column.samples',
              'Samples',
            ),
          },
          {
            key: 'support',
            label: t(
              'arrivalReliability.consistencyChart.column.support',
              'Route support index',
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
              <ComposedChart data={rows}>
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
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value) =>
                        fmtNumber(value, 1, locale)
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  dataKey="consistency"
                  name={consistencyName}
                  fill={CHART_COLORS[0]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries?.isHidden('consistency') ?? false}
                />
                <Line
                  type="monotone"
                  dataKey="allowance"
                  name={allowanceName}
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2}
                  hide={hiddenSeries?.isHidden('allowance') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ArrivalReliabilitySectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
