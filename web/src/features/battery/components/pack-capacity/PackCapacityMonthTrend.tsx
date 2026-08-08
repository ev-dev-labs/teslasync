import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import {
  convertEnergyFromSI,
  type EnergyUnitPref,
} from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { PackCapacityResult } from '../../lib/packCapacity';
import { packCapacityMonthLabel } from './labels';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityMonthTrendProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  energyUnit: EnergyUnitPref;
}

export function PackCapacityMonthTrend({
  result,
  state,
  locale,
  energyUnit,
}: PackCapacityMonthTrendProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.monthTrend.map((point) => ({
        month: packCapacityMonthLabel(point.monthKey, locale),
        monthKey: point.monthKey,
        samples: point.samples,
        median:
          point.medianObservedWh == null
            ? null
            : convertEnergyFromSI(point.medianObservedWh, energyUnit),
        latest:
          point.latestFilteredWh == null
            ? null
            : convertEnergyFromSI(point.latestFilteredWh, energyUnit),
      })),
    [energyUnit, locale, result.monthTrend],
  );

  return (
    <section data-testid="pack-capacity-month-trend">
      <ChartContainer
        title={t(
          'packCapacity.month.title',
          'Vehicle-local monthly evidence',
        )}
        subtitle={t(
          'packCapacity.month.subtitle',
          'Completion month in the vehicle timezone; zero-measurement months remain visible.',
        )}
        ariaLabel={t(
          'packCapacity.month.aria',
          'Monthly qualified sample count and capacity estimates',
        )}
        height={330}
        loading={state.isLoading}
        empty={false}
        exportable={
          state.isResolved && !state.error && rows.length > 0
        }
        exportData={rows}
        data={rows}
      >
        <PackCapacitySectionBody
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
                dataKey="month"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="count"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="energy"
                orientation="right"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit={` ${energyUnit}`}
                width={72}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                yAxisId="count"
                dataKey="samples"
                name={t(
                  'packCapacity.series.samples',
                  'Qualified samples',
                )}
                fill={chartTokens.series[0]}
                fillOpacity={0.55}
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="energy"
                type="monotone"
                dataKey="median"
                name={t(
                  'packCapacity.series.monthMedian',
                  'Raw monthly median',
                )}
                stroke={chartTokens.series[3]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                yAxisId="energy"
                type="monotone"
                dataKey="latest"
                name={t(
                  'packCapacity.series.monthLatest',
                  'Latest filtered estimate',
                )}
                stroke={chartTokens.series[1]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </PackCapacitySectionBody>
      </ChartContainer>
    </section>
  );
}
