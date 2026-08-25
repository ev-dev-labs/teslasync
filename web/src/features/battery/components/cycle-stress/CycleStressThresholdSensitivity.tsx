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

interface CycleStressThresholdSensitivityProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
}

export function CycleStressThresholdSensitivity({
  result,
  state,
}: CycleStressThresholdSensitivityProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.thresholdSensitivity.map((point) => ({
        thresholdPct: point.thresholdPct,
        label: `${point.thresholdPct}%+`,
        weightedSharePct:
          point.weightedShare == null
            ? null
            : point.weightedShare * 100,
        equivalentFullCycles: point.equivalentFullCycles,
        depthWeightedIndex: point.depthWeightedIndex,
      })),
    [result.thresholdSensitivity],
  );

  return (
    <section data-testid="cycle-stress-threshold-sensitivity">
      <ChartContainer
        title={t(
          'cycleStress.threshold.title',
          'Depth-threshold sensitivity',
        )}
        subtitle={t(
          'cycleStress.threshold.subtitle',
          'How the observed share and EFC contribution change when the descriptive deep-cycle cutoff moves.',
        )}
        ariaLabel={t(
          'cycleStress.threshold.aria',
          'Sensitivity chart of cycle share and equivalent full cycles at depth thresholds',
        )}
        chartKey="cycle-stress-threshold-sensitivity"
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
            key: 'thresholdPct',
            label: t(
              'cycleStress.columns.thresholdPct',
              'Depth threshold (%)',
            ),
          },
          {
            key: 'weightedSharePct',
            label: t('cycleStress.columns.cycleSharePct', 'Cycle share (%)'),
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
                yAxisId="index"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="share"
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
                yAxisId="index"
                dataKey="equivalentFullCycles"
                name={t(
                  'cycleStress.series.efcAtOrAbove',
                  'EFC at or above',
                )}
                fill={chartTokens.series[1]}
                fillOpacity={0.78}
                radius={[3, 3, 0, 0]}
                hide={hiddenSeries?.isHidden('equivalentFullCycles')}
              />
              <Line
                yAxisId="share"
                type="monotone"
                dataKey="weightedSharePct"
                name={t(
                  'cycleStress.series.cycleShare',
                  'Cycle share',
                )}
                stroke={chartTokens.series[2]}
                strokeWidth={2}
                dot={{ r: 4 }}
                hide={hiddenSeries?.isHidden('weightedSharePct')}
              />
              </ComposedChart>
            </ResponsiveContainer>
          </CycleStressSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
