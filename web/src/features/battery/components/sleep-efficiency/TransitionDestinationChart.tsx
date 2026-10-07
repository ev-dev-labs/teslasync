import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
  type ChartDataColumn,
  type ChartDataRow,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { sleepStateLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

interface DestinationDatum extends ChartDataRow {
  state: string;
  count: number;
  share: number | null;
}

export function TransitionDestinationChart({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const data = useMemo<DestinationDatum[]>(
    () =>
      analysis.transitions.states
        .filter((row) => row.count > 0)
        .map((row) => ({
          state: sleepStateLabel(t, row.state),
          count: row.count,
          share:
            row.countShare != null ? row.countShare * 100 : null,
        })),
    [analysis.transitions.states, t],
  );
  const columns = useMemo<ChartDataColumn[]>(
    () => [
      {
        key: 'state',
        label: t('sleep.transitionChart.state', 'Destination state'),
      },
      {
        key: 'count',
        label: t('sleep.transitionChart.count', 'Transition count'),
        format: (value) => fmtInt(value),
      },
      {
        key: 'share',
        label: t('sleep.transitionChart.share', 'Count share'),
        format: (value) =>
          value == null
            ? '—'
            : t('sleep.transitionChart.percent', '{{value}}%', {
                value: fmtNumber(value),
              }),
      },
    ],
    [t],
  );

  return (
    <section data-testid="sleep-efficiency-transition-distribution">
      <ChartContainer
        title={t(
          'sleep.transitionChart.title',
          'Transition destination count distribution',
        )}
        subtitle={t(
          'sleep.transitionChart.subtitle',
          'FSM destination counts; total_minutes is never substituted for count',
        )}
        ariaLabel={t(
          'sleep.transitionChart.aria',
          'Bar chart of valid vehicle FSM transition destination counts by state',
        )}
        height={320}
        data={data}
        dataColumns={columns}
        exportData={data}
      >
        <SleepEfficiencySectionBody state={state} skeletonHeight={240}>
          {data.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data}>
                {chartGrid}
                <XAxis
                  dataKey="state"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="count"
                  name={t(
                    'sleep.transitionChart.count',
                    'Transition count',
                  )}
                  fill="#00f0ff"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            // no-action: transition counts arrive from the selected vehicle and range
            <EmptyState
              className="py-8"
              icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sleep.transitionChart.empty',
                'No positive valid transition destination counts are available for this window.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </ChartContainer>
    </section>
  );
}
