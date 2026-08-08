import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  ChartContainer,
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
import { cycleStressDurationBandLabel } from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressDurationProfileProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
}

export function CycleStressDurationProfile({
  result,
  state,
}: CycleStressDurationProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.durationProfile.map((point) => ({
        band: point.band,
        label: cycleStressDurationBandLabel(t, point.band),
        weightedCycles: point.weightedCycles,
        meanDepthPct: point.meanDepthPct,
        equivalentFullCycles: point.equivalentFullCycles,
        depthWeightedIndex: point.depthWeightedIndex,
      })),
    [result.durationProfile, t],
  );

  return (
    <section data-testid="cycle-stress-duration-profile">
      <ChartContainer
        title={t(
          'cycleStress.duration.title',
          'Cycle closure-duration profile',
        )}
        subtitle={t(
          'cycleStress.duration.subtitle',
          'Elapsed time from the first range endpoint through closure; long durations can include multiple observed events.',
        )}
        ariaLabel={t(
          'cycleStress.duration.aria',
          'Chart of cycle count and mean depth by closure duration',
        )}
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
            label: t(
              'cycleStress.columns.durationBand',
              'Closure duration',
            ),
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
                interval={0}
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
              <Bar
                yAxisId="count"
                dataKey="weightedCycles"
                name={t(
                  'cycleStress.series.weightedCycles',
                  'Weighted cycles',
                )}
                fill={chartTokens.series[3]}
                fillOpacity={0.78}
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="depth"
                type="monotone"
                dataKey="meanDepthPct"
                name={t(
                  'cycleStress.series.meanDepth',
                  'Mean depth',
                )}
                stroke={chartTokens.series[0]}
                strokeWidth={2}
                dot={{ r: 4 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CycleStressSectionBody>
      </ChartContainer>
    </section>
  );
}
