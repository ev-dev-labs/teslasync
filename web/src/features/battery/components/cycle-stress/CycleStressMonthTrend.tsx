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
import { cycleStressMonthLabel } from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressMonthTrendProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

export function CycleStressMonthTrend({
  result,
  state,
  locale,
}: CycleStressMonthTrendProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.monthTrend.map((point) => ({
        monthKey: point.monthKey,
        label: cycleStressMonthLabel(point.monthKey, locale),
        equivalentFullCycles: point.equivalentFullCycles,
        depthWeightedIndex: point.depthWeightedIndex,
        meanDepthPct: point.meanDepthPct,
        weightedCycles: point.weightedCycles,
      })),
    [locale, result.monthTrend],
  );

  return (
    <section data-testid="cycle-stress-month-trend">
      <ChartContainer
        title={t(
          'cycleStress.month.title',
          'Vehicle-local monthly reconstruction',
        )}
        subtitle={t(
          'cycleStress.month.subtitle',
          'Cycles are attributed to their closure month in the vehicle timezone; zero-evidence months remain visible.',
        )}
        ariaLabel={t(
          'cycleStress.month.aria',
          'Monthly chart of equivalent full cycles, depth-weighted index, and mean cycle depth',
        )}
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
            key: 'monthKey',
            label: t('cycleStress.columns.localMonth', 'Local month'),
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
          {
            key: 'meanDepthPct',
            label: t(
              'cycleStress.columns.meanDepthPct',
              'Mean depth (%)',
            ),
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
              />
              <YAxis
                yAxisId="index"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="percent"
                orientation="right"
                domain={[0, 100]}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                yAxisId="index"
                dataKey="equivalentFullCycles"
                name={t(
                  'cycleStress.series.efc',
                  'Equivalent full cycles',
                )}
                fill={chartTokens.series[1]}
                fillOpacity={0.72}
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="index"
                type="monotone"
                dataKey="depthWeightedIndex"
                name={t(
                  'cycleStress.series.depthIndex',
                  'Depth-weighted index',
                )}
                stroke={chartTokens.series[4]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="meanDepthPct"
                name={t(
                  'cycleStress.series.meanDepth',
                  'Mean depth',
                )}
                stroke={chartTokens.series[2]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CycleStressSectionBody>
      </ChartContainer>
    </section>
  );
}
