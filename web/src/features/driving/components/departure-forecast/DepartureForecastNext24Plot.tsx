import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  Cell,
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

export interface DepartureForecastNext24Row {
  slotId: number;
  slot: string;
  likelihood: number;
  cumulative: number;
  departures: number;
  occurrences: number;
  support: string;
  isPeak: boolean;
}

interface DepartureForecastNext24PlotProps {
  rows: DepartureForecastNext24Row[];
  likelihoodName: string;
  cumulativeName: string;
  locale: string;
  /** Passed from parent for backwards-compatibility; context state takes precedence. */
  hiddenSeries?: HiddenSeriesState | null;
  ariaLabel?: string;
}

export function DepartureForecastNext24Plot({
  rows,
  likelihoodName,
  cumulativeName,
  locale,
  hiddenSeries: externalHiddenSeries,
  ariaLabel,
}: DepartureForecastNext24PlotProps) {
  const { t } = useTranslation();

  const effectiveAriaLabel =
    ariaLabel ??
    t(
      'departureForecast.next24Aria',
      'Departure likelihood and cumulative probability forecast for the next 24 hours',
    );

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'slot', label: t('departureForecast.colSlot', 'Time') },
      {
        key: 'likelihood',
        label: likelihoodName,
        format: (v) => `${fmtNumber(v as number, 1, locale)}%`,
      },
      {
        key: 'cumulative',
        label: cumulativeName,
        format: (v) => `${fmtNumber(v as number, 1, locale)}%`,
      },
    ],
    [t, likelihoodName, cumulativeName, locale],
  );
  const chartRows = useMemo(
    () => rows.map(({ slot, likelihood, cumulative }) => ({ slot, likelihood, cumulative })),
    [rows],
  );

  return (
    <EmbeddedChart
      chartKey="departure-forecast-24h"
      title={t('departureForecast.next24Title', 'Next-24h Departure Forecast')}
      ariaLabel={effectiveAriaLabel}
      data={chartRows}
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
                dataKey="slot"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      `${fmtNumber(value, 1, locale)}%`
                    }
                  />
                }
              />
              <ChartLegend verticalAlign="top" align="right" />
              <Bar
                dataKey="likelihood"
                name={likelihoodName}
                radius={[3, 3, 0, 0]}
                hide={hs?.isHidden('likelihood') ?? false}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.slotId}
                    fill={
                      row.isPeak
                        ? CHART_COLORS[3]
                        : row.departures > 0
                          ? CHART_COLORS[0]
                          : CHART_COLORS[4]
                    }
                    fillOpacity={row.departures > 0 ? 0.9 : 0.35}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="cumulative"
                name={cumulativeName}
                stroke={CHART_COLORS[2]}
                strokeWidth={2}
                dot={false}
                hide={hs?.isHidden('cumulative') ?? false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        );
      }}
    </EmbeddedChart>
  );
}
