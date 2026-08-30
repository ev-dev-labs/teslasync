import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ComposedChart,
  EmbeddedChart,
  type ChartDataColumn,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';

export type RangeBufferProfileChartRow = {
  key: string;
  label: string;
  samples: number;
  p10Pct: number | null;
  medianPct: number | null;
  p90Pct: number | null;
  contextPct?: number | null;
};

interface RangeBufferPercentileChartProps {
  rows: RangeBufferProfileChartRow[];
  samplesName: string;
  p10Name: string;
  medianName: string;
  p90Name: string;
  contextName?: string;
  /** Passed from parent for backwards-compatibility; context state takes precedence. */
  hiddenSeries?: HiddenSeriesState | null;
  ariaLabel?: string;
}

export function RangeBufferPercentileChart({
  rows,
  samplesName,
  p10Name,
  medianName,
  p90Name,
  contextName,
  hiddenSeries: externalHiddenSeries,
  ariaLabel,
}: RangeBufferPercentileChartProps) {
  const { t } = useTranslation();

  const effectiveAriaLabel =
    ariaLabel ??
    t(
      'rangeBuffer.percentileAria',
      'Range buffer percentile distribution across driving profile categories',
    );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'label', label: t('rangeBuffer.colLabel', 'Category') },
      { key: 'samples', label: samplesName, format: (v) => String(v ?? 0) },
      { key: 'p10Pct', label: p10Name, format: (v) => (v != null ? `${v}%` : '—') },
      { key: 'medianPct', label: medianName, format: (v) => (v != null ? `${v}%` : '—') },
      { key: 'p90Pct', label: p90Name, format: (v) => (v != null ? `${v}%` : '—') },
      ...(contextName
        ? [{ key: 'contextPct', label: contextName, format: (v: unknown) => (v != null ? `${v}%` : '—') }]
        : []),
    ],
    [t, samplesName, p10Name, medianName, p90Name, contextName],
  );

  return (
    <EmbeddedChart
      chartKey="range-buffer-percentile"
      title={t('rangeBuffer.percentileTitle', 'Range Buffer Percentile')}
      ariaLabel={effectiveAriaLabel}
      data={rows}
      dataColumns={dataColumns}
    >
      {({ hiddenSeries: contextSeries }) => {
        const hs = contextSeries ?? externalHiddenSeries ?? null;
        return (
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
                yAxisId="percent"
                domain={[0, 100]}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend verticalAlign="top" align="right" />
              <Bar
                yAxisId="count"
                dataKey="samples"
                name={samplesName}
                fill={CHART_COLORS[4]}
                fillOpacity={0.3}
                radius={[3, 3, 0, 0]}
                hide={hs?.isHidden('samples') ?? false}
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="p10Pct"
                name={p10Name}
                stroke={CHART_COLORS[3]}
                strokeWidth={2}
                connectNulls={false}
                hide={hs?.isHidden('p10Pct') ?? false}
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="medianPct"
                name={medianName}
                stroke={CHART_COLORS[0]}
                strokeWidth={2.5}
                connectNulls={false}
                hide={hs?.isHidden('medianPct') ?? false}
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="p90Pct"
                name={p90Name}
                stroke={CHART_COLORS[2]}
                strokeWidth={2}
                connectNulls={false}
                hide={hs?.isHidden('p90Pct') ?? false}
              />
              {contextName ? (
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey="contextPct"
                  name={contextName}
                  stroke={CHART_COLORS[5]}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  connectNulls={false}
                  hide={hs?.isHidden('contextPct') ?? false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        );
      }}
    </EmbeddedChart>
  );
}
