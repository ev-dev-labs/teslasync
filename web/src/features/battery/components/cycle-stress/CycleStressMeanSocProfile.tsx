import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import type { CycleStressResult } from '../../lib/cycleStress';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressMeanSocProfileProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
}

export function CycleStressMeanSocProfile({
  result,
  state,
}: CycleStressMeanSocProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.meanSocProfile.map((point) => ({
        key: String(point.lowerPct),
        label: `${point.lowerPct}-${point.upperPct}%`,
        weightedCycles: point.weightedCycles,
        meanDepthPct: point.meanDepthPct,
        equivalentFullCycles: point.equivalentFullCycles,
        depthWeightedIndex: point.depthWeightedIndex,
      })),
    [result.meanSocProfile],
  );

  return (
    <section data-testid="cycle-stress-mean-soc-profile">
      <ChartContainer
        title={t(
          'cycleStress.meanSoc.title',
          'Cycle mean-SoC profile',
        )}
        subtitle={t(
          'cycleStress.meanSoc.subtitle',
          'Cycle-count weight and mean depth grouped by the midpoint of each reconstructed SoC range.',
        )}
        ariaLabel={t(
          'cycleStress.meanSoc.aria',
          'Chart of reconstructed cycle count and depth by mean battery percentage',
        )}
        chartKey="cycle-stress-mean-soc-profile"
        height={300}
        loading={state.isLoading}
        empty={false}
        exportable={
          state.isResolved && !state.error && result.cycles.length > 0
        }
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'label',
            label: t('cycleStress.columns.meanSocBand', 'Mean SoC band'),
          },
          {
            key: 'weightedCycles',
            label: t(
              'cycleStress.columns.weightedCycles',
              'Weighted cycles',
            ),
          },
          {
            key: 'meanDepthPct',
            label: t(
              'cycleStress.columns.meanDepthPct',
              'Mean depth (%)',
            ),
          },
          {
            key: 'equivalentFullCycles',
            label: t('cycleStress.columns.efc', 'Equivalent full cycles'),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <CycleStressSectionBody
            result={result}
            state={state}
            requirement="cycles"
            className="h-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="count"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="depth"
                orientation="right"
                domain={[0, 100]}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Bar
                yAxisId="count"
                dataKey="weightedCycles"
                name={t(
                  'cycleStress.series.weightedCycles',
                  'Weighted cycles',
                )}
                fill={chartTokens.series[0]}
                fillOpacity={0.8}
                radius={[3, 3, 0, 0]}
                hide={hiddenSeries?.isHidden('weightedCycles')}
              />
              <Line
                yAxisId="depth"
                type="monotone"
                dataKey="meanDepthPct"
                name={t(
                  'cycleStress.series.meanDepth',
                  'Mean depth',
                )}
                stroke={chartTokens.series[2]}
                strokeWidth={2}
                dot={{ r: 4 }}
                connectNulls={false}
                hide={hiddenSeries?.isHidden('meanDepthPct')}
              />
              </ComposedChart>
            </ResponsiveContainer>
          </CycleStressSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
