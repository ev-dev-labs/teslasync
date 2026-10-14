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
  useChartHiddenSeries,
} from '@/components/charts';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const hostSeries = useChartHiddenSeries();

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
        format: (v) => (v != null ? String(v) : '—'),
      },
      {
        key: 'origins',
        label: t('destinationTransitions.twoHour.column.origins', 'Distinct origins'),
      },
      {
        key: 'destinations',
        label: t('destinationTransitions.twoHour.column.destinations', 'Distinct destinations'),
      },
      {
        key: 'concentration',
        label: concentrationSeriesName,
        format: (v) => (typeof v === 'number' ? fmtNumber(v, undefined, locale) : '—'),
      },
      {
        key: 'leadingShare',
        label: t('destinationTransitions.twoHour.column.leadingShare', 'Leading edge share (%)'),
      },
      {
        key: 'support',
        label: t('destinationTransitions.twoHour.column.support', 'Sample support'),
      },
    ],
    [t, countSeriesName, concentrationSeriesName, locale, fmtNumber],
  );

  const renderPlot = ({
    hiddenSeries,
  }: { hiddenSeries: ReturnType<typeof useChartHiddenSeries> }) => (
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
              valueFormatter={(value) =>
                typeof value === 'number' ? fmtNumber(value, undefined, locale) : '—'
              }
            />
          }
        />
        <ChartLegend
          state={hiddenSeries ?? undefined}
          verticalAlign="top"
          align="right"
        />
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
  );

  // Hosted profiles keep their own URL keys, metadata, export and accessible table.
  // The former shared key remains supported only for standalone plots.
  if (hostSeries) return renderPlot({ hiddenSeries: hostSeries });

  return (
    <EmbeddedChart
      chartKey="destination-transition-profile"
      title={t('destinationTransitions.profileTitle', 'Destination transition profile')}
      ariaLabel={effectiveAriaLabel}
      data={rows}
      dataColumns={dataColumns}
    >
      {renderPlot}
    </EmbeddedChart>
  );
}
