import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  Cell,
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
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferThresholdSensitivityProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
}

export function RangeBufferThresholdSensitivity({
  result,
  state,
}: RangeBufferThresholdSensitivityProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.thresholdSensitivity.map((point) => ({
        key: String(point.thresholdPct),
        label: `<${point.thresholdPct}%`,
        thresholdPct: point.thresholdPct,
        count: point.count,
        sharePct:
          point.share == null ? null : Math.round(point.share * 1_000) / 10,
      })),
    [result.thresholdSensitivity],
  );

  return (
    <section data-testid="range-buffer-threshold-sensitivity">
      <ChartContainer
        title={t(
          'rangeBuffer.sensitivity.title',
          'Planning-threshold sensitivity',
        )}
        subtitle={t(
          'rangeBuffer.sensitivity.subtitle',
          'How the same included arrivals classify under several strict less-than thresholds.',
        )}
        ariaLabel={t(
          'rangeBuffer.sensitivity.aria',
          'Chart of arrival counts and shares below alternative battery thresholds',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
        chartKey="range-buffer-threshold-sensitivity"
        exportable={
          state.isResolved
          && !state.error
          && result.accounting.includedRows > 0
        }
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'label',
            label: t('rangeBuffer.columns.threshold', 'Threshold'),
          },
          {
            key: 'count',
            label: t('rangeBuffer.columns.belowCount', 'Below count'),
          },
          {
            key: 'sharePct',
            label: t('rangeBuffer.columns.belowSharePct', 'Below share (%)'),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <RangeBufferSectionBody
            result={result}
            state={state}
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
                  allowDecimals={false}
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
                />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="count"
                  dataKey="count"
                  name={t(
                    'rangeBuffer.series.belowCount',
                    'Below-threshold arrivals',
                  )}
                  radius={[4, 4, 0, 0]}
                  hide={hiddenSeries?.isHidden('count') ?? false}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.key}
                      fill={
                        row.thresholdPct === result.config.thresholdPct
                          ? CHART_COLORS[3]
                          : CHART_COLORS[4]
                      }
                      fillOpacity={
                        row.thresholdPct === result.config.thresholdPct
                          ? 0.85
                          : 0.35
                      }
                    />
                  ))}
                </Bar>
                <Line
                  yAxisId="share"
                  type="monotone"
                  dataKey="sharePct"
                  name={t(
                    'rangeBuffer.series.belowShare',
                    'Below-threshold share (%)',
                  )}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2.5}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('sharePct') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </RangeBufferSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
