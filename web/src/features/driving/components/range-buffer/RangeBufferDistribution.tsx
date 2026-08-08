import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import {
  CRITICAL_RANGE_BUFFER_THRESHOLD_PCT,
  type RangeBufferResult,
} from '../../lib/rangeBuffer';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferDistributionProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
}

export function RangeBufferDistribution({
  result,
  state,
}: RangeBufferDistributionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.buckets.map((bucket) => ({
        key: String(bucket.fromPct),
        label: `${bucket.fromPct}-${bucket.toPct}%`,
        fromPct: bucket.fromPct,
        count: bucket.count,
        sharePct:
          bucket.share == null ? null : Math.round(bucket.share * 1_000) / 10,
      })),
    [result.buckets],
  );
  const colorFor = (fromPct: number) => {
    if (fromPct < CRITICAL_RANGE_BUFFER_THRESHOLD_PCT) {
      return chartTokens.series[3];
    }
    if (fromPct < result.config.thresholdPct) {
      return chartTokens.series[2];
    }
    return chartTokens.series[1];
  };

  return (
    <section data-testid="range-buffer-distribution">
      <ChartContainer
        title={t(
          'rangeBuffer.distribution.title',
          'Arrival SoC distribution',
        )}
        subtitle={t(
          'rangeBuffer.distribution.subtitle',
          'Drive-weighted 10-point bands; rose covers 0-10%, while amber marks bands whose lower edge is below the selected threshold.',
        )}
        ariaLabel={t(
          'rangeBuffer.distribution.aria',
          'Histogram of included drive arrivals by end battery percentage',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
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
            label: t('rangeBuffer.columns.arrivalBand', 'Arrival band'),
          },
          {
            key: 'count',
            label: t('rangeBuffer.columns.arrivals', 'Arrivals'),
          },
          {
            key: 'sharePct',
            label: t('rangeBuffer.columns.sharePct', 'Share (%)'),
          },
        ]}
      >
        <RangeBufferSectionBody
          result={result}
          state={state}
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
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="count"
                name={t('rangeBuffer.series.arrivals', 'Arrivals')}
                radius={[4, 4, 0, 0]}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.key}
                    fill={colorFor(row.fromPct)}
                    fillOpacity={0.82}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </RangeBufferSectionBody>
      </ChartContainer>
    </section>
  );
}
