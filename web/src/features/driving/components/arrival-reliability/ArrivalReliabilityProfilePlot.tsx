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
import { fmtNumber } from '@/lib/numberFormat';

export interface ArrivalReliabilityProfileRow
  extends Record<string, string | number | null> {
  key: string;
  label: string;
  normalizedDurationIndex: number | null;
  allowanceShare: number | null;
  samples: number;
}

interface ArrivalReliabilityProfilePlotProps {
  rows: ArrivalReliabilityProfileRow[];
  normalizedName: string;
  allowanceName: string;
  samplesName: string;
  locale: string;
  /** Passed from parent for backwards-compatibility; context state from chartKey takes precedence. */
  hiddenSeries?: HiddenSeriesState | null;
  /** Accessible label; falls back to a translated default. */
  ariaLabel?: string;
}

export function ArrivalReliabilityProfilePlot({
  rows,
  normalizedName,
  allowanceName,
  samplesName,
  locale,
  hiddenSeries: externalHiddenSeries,
  ariaLabel,
}: ArrivalReliabilityProfilePlotProps) {
  const { t } = useTranslation();

  const effectiveAriaLabel =
    ariaLabel ??
    t(
      'arrivalReliability.profileAria',
      'Arrival reliability profile combining sample counts, normalised duration index, and schedule allowance share',
    );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'label', label: t('arrivalReliability.colLabel', 'Category') },
      {
        key: 'normalizedDurationIndex',
        label: normalizedName,
        format: (v) => (v != null ? fmtNumber(v as number, 1, locale) : '—'),
      },
      {
        key: 'allowanceShare',
        label: allowanceName,
        format: (v) => (v != null ? fmtNumber(v as number, 1, locale) : '—'),
      },
      { key: 'samples', label: samplesName, format: (v) => String(v ?? 0) },
    ],
    [t, normalizedName, allowanceName, samplesName, locale],
  );

  return (
    <EmbeddedChart
      chartKey="arrival-reliability-profile"
      title={t('arrivalReliability.profileTitle', 'Arrival Reliability Profile')}
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
                yAxisId="index"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                domain={[0, 'auto']}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                allowDecimals={false}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) => fmtNumber(value, 1, locale)}
                  />
                }
              />
              <ChartLegend verticalAlign="top" align="right" />
              <Bar
                yAxisId="count"
                dataKey="samples"
                name={samplesName}
                fill={CHART_COLORS[4]}
                fillOpacity={0.35}
                radius={[3, 3, 0, 0]}
                hide={hs?.isHidden('samples') ?? false}
              />
              <Line
                yAxisId="index"
                type="monotone"
                dataKey="normalizedDurationIndex"
                name={normalizedName}
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                connectNulls={false}
                hide={hs?.isHidden('normalizedDurationIndex') ?? false}
              />
              <Line
                yAxisId="index"
                type="monotone"
                dataKey="allowanceShare"
                name={allowanceName}
                stroke={CHART_COLORS[2]}
                strokeWidth={2}
                connectNulls={false}
                hide={hs?.isHidden('allowanceShare') ?? false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        );
      }}
    </EmbeddedChart>
  );
}
