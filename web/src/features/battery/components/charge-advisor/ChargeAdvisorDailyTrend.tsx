import { Activity, LineChart as LineChartIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorDailyTrend({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const rows = analysis.dailyTrend.map((day) => ({
    date: day.localDate,
    drop: day.dropPct,
    drives: day.driveCount,
  }));

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.trend.title', 'Daily drive-associated SoC-drop trend')}
      subtitle={t(
        'chargeAdvisor.trend.subtitle',
        'Multiple drives on one local day are summed; this is not total energy use or a battery-condition assessment.',
      )}
      icon={<LineChartIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-trend"
    >
      {rows.length === 0 ? (
        <Text as="p" variant="bodySm" className="py-12 text-center">
          {t('chargeAdvisor.trend.empty', 'No qualified local-day SoC-drop observations yet.')}
        </Text>
      ) : (
        <ChartContainer
          title={t('chargeAdvisor.trend.chartTitle', 'Observed daily use')}
          ariaLabel={t(
            'chargeAdvisor.trend.aria',
            'Observed daily drive-associated state-of-charge drops across the returned history window',
          )}
          data={rows}
          dataColumns={[
            { key: 'date', label: t('chargeAdvisor.chart.date', 'Local date') },
            { key: 'drop', label: t('chargeAdvisor.chart.drop', 'SoC drop') },
            { key: 'drives', label: t('chargeAdvisor.chart.drives', 'Drives') },
          ]}
          chartKey="charge-advisor-daily-trend"
          height={270}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid stroke={chartTokens.gridStroke} strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="drop"
                name={t('chargeAdvisor.trend.series', 'Drive-associated SoC drop')}
                stroke={chartTokens.series[5]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
      <Text as="p" variant="caption" className="mt-3">
        <Activity className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        {t(
          'chargeAdvisor.trend.note',
          'Days without a completed qualified drive remain in weekday denominators even though this trend only plots active days.',
        )}
      </Text>
    </ChargeAdvisorSection>
  );
}
