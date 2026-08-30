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
import { fmtNumber } from '@/lib/numberFormat';

export interface DestinationTransitionProfileRow {
  [key: string]: string | number | null | undefined;
  label: string;
  samples: number;
  origins: number;
  destinations: number;
  concentration: number | null;
  leadingShare: number | null;
  support: string;
}

interface DestinationTransitionProfilePlotProps {
  rows: DestinationTransitionProfileRow[];
  locale: string;
  countSeriesName: string;
  concentrationSeriesName: string;
  hiddenCount?: boolean;
  hiddenConcentration?: boolean;
  ariaLabel?: string;
}

export function DestinationTransitionProfilePlot({
  rows,
  locale,
  countSeriesName,
  concentrationSeriesName,
  hiddenCount = false,
  hiddenConcentration = false,
  ariaLabel,
}: DestinationTransitionProfilePlotProps) {
  const { t } = useTranslation();

  const effectiveAriaLabel =
    ariaLabel ??
    t(
      'destinationTransitions.profileAria',
      'Destination transition profile showing sample count and concentration',
    );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'label', label: t('destinationTransitions.colLabel', 'Category') },
      {
        key: 'samples',
        label: countSeriesName,
        format: (v) => String(v ?? 0),
      },
      {
        key: 'concentration',
        label: concentrationSeriesName,
        format: (v) => (v != null ? fmtNumber(v as number, 1, locale) : '—'),
      },
    ],
    [t, countSeriesName, concentrationSeriesName, locale],
  );

  return (
    <EmbeddedChart
      chartKey="destination-transition-profile"
      title={t('destinationTransitions.profileTitle', 'Destination Transition Profile')}
      ariaLabel={effectiveAriaLabel}
      data={rows}
      dataColumns={dataColumns}
    >
      {({ hiddenSeries }) => (
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
              yAxisId="index"
              orientation="right"
              domain={[0, 100]}
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
              name={countSeriesName}
              fill={CHART_COLORS[0]}
              radius={[3, 3, 0, 0]}
              hide={(hiddenSeries?.isHidden('samples') ?? false) || hiddenCount}
            />
            <Line
              yAxisId="index"
              type="monotone"
              connectNulls={false}
              dataKey="concentration"
              name={concentrationSeriesName}
              stroke={CHART_COLORS[3]}
              strokeWidth={2}
              hide={
                (hiddenSeries?.isHidden('concentration') ?? false) ||
                hiddenConcentration
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );
}
