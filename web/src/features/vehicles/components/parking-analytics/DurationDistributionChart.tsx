import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
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
  chartGrid,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertDurationFromSI } from '@/lib/unitConversion';

import type { ParkingDurationBandKey, ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';

interface DurationDistributionChartProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  className?: string;
}

/** Stint-count distribution with observed dwell credited to each band. */
export function DurationDistributionChart({
  summary,
  state,
  className,
}: DurationDistributionChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const durationUnit = unitPrefs.duration;
  const labels: Record<ParkingDurationBandKey, string> = {
    under1h: t('parking.durationBands.under1h', 'Under 1 h'),
    '1to4h': t('parking.durationBands.1to4h', '1–4 h'),
    '4to12h': t('parking.durationBands.4to12h', '4–12 h'),
    '12to24h': t('parking.durationBands.12to24h', '12–24 h'),
    '1to3d': t('parking.durationBands.1to3d', '1–3 d'),
    '3dPlus': t('parking.durationBands.3dPlus', '3 d+'),
  };
  const rows = summary.durationBands.map((band) => ({
    band: labels[band.key],
    stints: band.stints,
    dwell:
      Math.round(
        convertDurationFromSI(band.totalMs / 1_000, durationUnit) * 10,
      ) / 10,
  }));
  const hasData = summary.stints.length > 0;
  const chartRows = hasData ? rows : [];
  const countName = t('parking.durationDistribution.countSeries', 'Stints');
  const dwellName = t(
    'parking.durationDistribution.dwellSeries',
    'Observed dwell ({{unit}})',
    { unit: durationUnit },
  );

  return (
    <section
      className={className}
      aria-label={t(
        'parking.sections.duration',
        'Parking duration distribution',
      )}
      data-testid="parking-duration"
    >
      <ChartContainer
        className="h-full"
        title={t(
          'parking.durationDistribution.title',
          'Parking Duration Distribution',
        )}
        subtitle={t(
          'parking.durationDistribution.subtitle',
          '{{count}} reconstructed stints; final observed stints may be right-censored.',
          { count: summary.stints.length },
        )}
        ariaLabel={t(
          'parking.durationDistribution.aria',
          'Bar and line chart of parking stint counts and observed dwell by duration band',
        )}
        loading={state.isLoading}
        height={320}
        chartKey="parking-duration-distribution"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="parking-duration-distribution"
        data={state.error ? [] : chartRows}
        dataColumns={[
          {
            key: 'band',
            label: t('parking.durationDistribution.band', 'Duration band'),
          },
          {
            key: 'stints',
            label: countName,
            format: (value) => fmtInt(value),
          },
          {
            key: 'dwell',
            label: dwellName,
            format: (value) => fmtNumber(value, 1),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <ParkingSectionBody state={state} className="h-full min-h-0">
            {!hasData ? (
              <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
                className="h-full"
                icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'parking.durationDistribution.empty',
                  'No positive parking gaps are available to distribute in this window.',
                )}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  margin={{ top: 12, right: 4, left: -12, bottom: 0 }}
                >
                  {chartGrid}
                  <XAxis
                    dataKey="band"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="count"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={36}
                  />
                  <YAxis
                    yAxisId="dwell"
                    orientation="right"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => fmtNumber(value, 0)}
                    width={42}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueFormatter={(value, name) =>
                          name === countName
                            ? fmtInt(value)
                            : `${fmtNumber(value, 1)} ${durationUnit}`
                        }
                      />
                    }
                  />
                  <ChartLegend verticalAlign="top" align="right" />
                  <Bar
                    yAxisId="count"
                    dataKey="stints"
                    name={countName}
                    fill={CHART_COLORS[0]}
                    radius={[5, 5, 0, 0]}
                    maxBarSize={40}
                    hide={hiddenSeries?.isHidden('stints') ?? false}
                  />
                  <Line
                    yAxisId="dwell"
                    type="monotone"
                    dataKey="dwell"
                    name={dwellName}
                    stroke={CHART_COLORS[3]}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    hide={hiddenSeries?.isHidden('dwell') ?? false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ParkingSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
