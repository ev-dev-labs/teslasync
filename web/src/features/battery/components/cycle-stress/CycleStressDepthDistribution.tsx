import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
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

interface CycleStressDepthDistributionProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
}

export function CycleStressDepthDistribution({
  result,
  state,
}: CycleStressDepthDistributionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.histogram.map((bin) => ({
        key: String(bin.lowerPct),
        label: `${bin.lowerPct}-${bin.upperPct}%`,
        weightedCycles: bin.weightedCycles,
        equivalentFullCycles: bin.equivalentFullCycles,
        depthWeightedIndex: bin.depthWeightedIndex,
      })),
    [result.histogram],
  );

  return (
    <section data-testid="cycle-stress-depth-distribution">
      <ChartContainer
        title={t(
          'cycleStress.distribution.title',
          'Cycle-depth distribution',
        )}
        subtitle={t(
          'cycleStress.distribution.subtitle',
          'Full cycles count as 1 and unresolved boundary ranges as 0.5; EFC and the illustrative depth index are shown beside count.',
        )}
        ariaLabel={t(
          'cycleStress.distribution.aria',
          'Histogram of reconstructed cycle depth with equivalent full cycles and depth-weighted index',
        )}
        chartKey="cycle-stress-depth-distribution"
        height={320}
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
            label: t('cycleStress.columns.depthBand', 'Depth band'),
          },
          {
            key: 'weightedCycles',
            label: t(
              'cycleStress.columns.weightedCycles',
              'Weighted cycles',
            ),
          },
          {
            key: 'equivalentFullCycles',
            label: t('cycleStress.columns.efc', 'Equivalent full cycles'),
          },
          {
            key: 'depthWeightedIndex',
            label: t(
              'cycleStress.columns.depthIndex',
              'Depth-weighted index',
            ),
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
              <BarChart data={rows}>
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
                interval={0}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Bar
                dataKey="weightedCycles"
                name={t(
                  'cycleStress.series.weightedCycles',
                  'Weighted cycles',
                )}
                fill={chartTokens.series[0]}
                fillOpacity={0.82}
                radius={[3, 3, 0, 0]}
                hide={hiddenSeries?.isHidden('weightedCycles')}
              />
              <Bar
                dataKey="equivalentFullCycles"
                name={t(
                  'cycleStress.series.efc',
                  'Equivalent full cycles',
                )}
                fill={chartTokens.series[1]}
                fillOpacity={0.82}
                radius={[3, 3, 0, 0]}
                hide={hiddenSeries?.isHidden('equivalentFullCycles')}
              />
              <Bar
                dataKey="depthWeightedIndex"
                name={t(
                  'cycleStress.series.depthIndex',
                  'Depth-weighted index',
                )}
                fill={chartTokens.series[4]}
                fillOpacity={0.82}
                radius={[3, 3, 0, 0]}
                hide={hiddenSeries?.isHidden('depthWeightedIndex')}
              />
              </BarChart>
            </ResponsiveContainer>
          </CycleStressSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
