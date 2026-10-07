import { Clock4 } from 'lucide-react';
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
import { fmtNumber } from '@/lib/numberFormat';
import { sleepStateLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

interface DwellDatum extends ChartDataRow {
  state: string;
  minutes: number;
  share: number | null;
}

export function DwellDurationChart({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const data = useMemo<DwellDatum[]>(
    () =>
      analysis.transitions.states.map((row) => ({
        state: sleepStateLabel(t, row.state),
        minutes: row.totalMinutes,
        share:
          row.durationShare != null ? row.durationShare * 100 : null,
      })),
    [analysis.transitions.states, t],
  );
  const columns = useMemo<ChartDataColumn[]>(
    () => [
      {
        key: 'state',
        label: t('sleep.dwellChart.state', 'State'),
      },
      {
        key: 'minutes',
        label: t('sleep.dwellChart.minutes', 'Dwell minutes'),
        format: (value) => fmtNumber(value),
      },
      {
        key: 'share',
        label: t('sleep.dwellChart.share', 'Duration share'),
        format: (value) =>
          value == null
            ? '—'
            : t('sleep.dwellChart.percent', '{{value}}%', {
                value: fmtNumber(value),
              }),
      },
    ],
    [t],
  );

  return (
    <section data-testid="sleep-efficiency-dwell-distribution">
      <ChartContainer
        title={t(
          'sleep.dwellChart.title',
          'Dwell-duration distribution',
        )}
        subtitle={t(
          'sleep.dwellChart.subtitle',
          'Populates only from positive reconstructed total_minutes evidence',
        )}
        ariaLabel={t(
          'sleep.dwellChart.aria',
          'Bar chart of reconstructed dwell minutes by state when available',
        )}
        height={320}
        data={analysis.dwell.available ? data : []}
        dataColumns={columns}
        exportData={analysis.dwell.available ? data : []}
      >
        <SleepEfficiencySectionBody state={state} skeletonHeight={240}>
          {analysis.dwell.available ? (
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
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="minutes"
                  name={t('sleep.dwellChart.minutes', 'Dwell minutes')}
                  fill="#a855f7"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            // no-action: dwell reconstruction must be supplied by backend evidence
            <EmptyState
              className="py-8"
              icon={<Clock4 className="h-8 w-8" aria-hidden="true" />}
              title={t(
                'sleep.dwellChart.unavailableTitle',
                'Dwell reconstruction unavailable',
              )}
              message={t(
                'sleep.dwellChart.unavailable',
                'Unavailable pending dwell reconstruction. Zero total_minutes rows are retained as valid rows but do not establish duration evidence.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </ChartContainer>
    </section>
  );
}
