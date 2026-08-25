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

export interface OriginConcentrationRow {
  [key: string]: string | number | null | undefined;
  origin: string;
  concentration: number;
  leadingShare: number;
  outgoing: number;
  successors: number;
  supportIndex: number;
  support: string;
}

interface OriginConcentrationPlotProps {
  rows: OriginConcentrationRow[];
  locale: string;
  concentrationName: string;
  leadingName: string;
  hiddenConcentration?: boolean;
  hiddenLeadingShare?: boolean;
  ariaLabel?: string;
}

export function OriginConcentrationPlot({
  rows,
  locale,
  concentrationName,
  leadingName,
  hiddenConcentration = false,
  hiddenLeadingShare = false,
  ariaLabel,
}: OriginConcentrationPlotProps) {
  const { t } = useTranslation();

  const effectiveAriaLabel =
    ariaLabel ??
    t(
      'originConcentration.aria',
      'Origin concentration and leading share by departure location',
    );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'origin', label: t('originConcentration.colOrigin', 'Origin') },
      {
        key: 'concentration',
        label: concentrationName,
        format: (v) => fmtNumber(v as number, 1, locale),
      },
      {
        key: 'leadingShare',
        label: leadingName,
        format: (v) => fmtNumber(v as number, 1, locale),
      },
    ],
    [t, concentrationName, leadingName, locale],
  );

  return (
    <EmbeddedChart
      chartKey="origin-concentration"
      title={t('originConcentration.title', 'Origin Concentration')}
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
              dataKey="origin"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
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
              dataKey="concentration"
              name={concentrationName}
              fill={CHART_COLORS[1]}
              radius={[3, 3, 0, 0]}
              hide={
                (hiddenSeries?.isHidden('concentration') ?? false) ||
                hiddenConcentration
              }
            />
            <Line
              type="monotone"
              dataKey="leadingShare"
              name={leadingName}
              stroke={CHART_COLORS[2]}
              strokeWidth={2}
              hide={
                (hiddenSeries?.isHidden('leadingShare') ?? false) ||
                hiddenLeadingShare
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );
}
