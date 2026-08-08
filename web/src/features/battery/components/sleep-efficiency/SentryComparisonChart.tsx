import { Eye } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartTooltip,
  Legend,
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
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

interface SentryDatum extends ChartDataRow {
  mode: string;
  count: number;
  drainRate: number | null;
  batteryLost: number | null;
  durationHours: number | null;
}

export function SentryComparisonChart({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const data = useMemo<SentryDatum[]>(
    () =>
      [analysis.sentry.on, analysis.sentry.off]
        .filter((group) => group.available && group.count != null)
        .map((group) => ({
          mode:
            group.mode === 'on'
              ? t('sleep.sentryChart.on', 'Sentry on')
              : t('sleep.sentryChart.off', 'Sentry off'),
          count: group.count ?? 0,
          drainRate: group.avgDrainRate,
          batteryLost: group.avgBatteryLost,
          durationHours: group.avgDurationHours,
        })),
    [analysis.sentry.off, analysis.sentry.on, t],
  );
  const columns = useMemo<ChartDataColumn[]>(
    () => [
      {
        key: 'mode',
        label: t('sleep.sentryChart.mode', 'Group'),
      },
      {
        key: 'count',
        label: t('sleep.sentryChart.samples', 'Samples'),
        format: (value) => fmtInt(value),
      },
      {
        key: 'drainRate',
        label: t(
          'sleep.sentryChart.drainRate',
          'Average drain rate (%/hr)',
        ),
        format: (value) => (value == null ? '—' : fmtNumber(value)),
      },
      {
        key: 'batteryLost',
        label: t(
          'sleep.sentryChart.batteryLost',
          'Average battery lost (%)',
        ),
        format: (value) => (value == null ? '—' : fmtNumber(value)),
      },
      {
        key: 'durationHours',
        label: t(
          'sleep.sentryChart.duration',
          'Average duration (hours)',
        ),
        format: (value) => (value == null ? '—' : fmtNumber(value)),
      },
    ],
    [t],
  );

  return (
    <section data-testid="sleep-efficiency-sentry-comparison">
      <ChartContainer
        title={t(
          'sleep.sentryChart.title',
          'Sentry on/off comparison',
        )}
        subtitle={t(
          'sleep.sentryChart.subtitle',
          'A group is evidence-bearing only when count is positive',
        )}
        ariaLabel={t(
          'sleep.sentryChart.aria',
          'Grouped bar chart comparing count-bearing Sentry on and off samples',
        )}
        height={320}
        data={analysis.sentry.comparisonAvailable ? data : []}
        dataColumns={columns}
        exportData={analysis.sentry.comparisonAvailable ? data : []}
        chartKey="sleep-efficiency-sentry-comparison"
      >
        <SleepEfficiencySectionBody state={state} skeletonHeight={240}>
          {analysis.sentry.comparisonAvailable ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data}>
                {chartGrid}
                <XAxis
                  dataKey="mode"
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
                <Legend />
                <Bar
                  dataKey="drainRate"
                  name={t(
                    'sleep.sentryChart.drainRateShort',
                    'Drain rate (%/hr)',
                  )}
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="batteryLost"
                  name={t(
                    'sleep.sentryChart.batteryLostShort',
                    'Battery lost (%)',
                  )}
                  fill="#a855f7"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            // no-action: qualifying count-bearing groups arrive from backend reconstruction
            <EmptyState
              className="py-8"
              icon={<Eye className="h-8 w-8" aria-hidden="true" />}
              title={t(
                'sleep.sentryChart.unavailableTitle',
                'Sentry comparison unavailable',
              )}
              message={t(
                'sleep.sentryChart.unavailable',
                'No complete on/off pair has positive sample counts. Empty groups are unavailable; count-bearing zero rates would remain valid evidence.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </ChartContainer>
    </section>
  );
}
