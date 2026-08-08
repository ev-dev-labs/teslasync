import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  Line,
  LineChart,
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
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityEstimateTimelineProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  energyUnit: EnergyUnitPref;
}

export function PackCapacityEstimateTimeline({
  result,
  state,
  locale,
  energyUnit,
}: PackCapacityEstimateTimelineProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.timeline.map((point) => ({
        date: new Intl.DateTimeFormat(locale, {
          month: 'short',
          day: 'numeric',
          year: '2-digit',
          timeZone: result.timeZone,
        }).format(new Date(point.tsMs)),
        raw: convertEnergyFromSI(point.observedWh, energyUnit),
        filtered: convertEnergyFromSI(point.capacityWh, energyUnit),
        lower: convertEnergyFromSI(
          point.capacityWh - point.sigmaWh,
          energyUnit,
        ),
        upper: convertEnergyFromSI(
          point.capacityWh + point.sigmaWh,
          energyUnit,
        ),
      })),
    [energyUnit, locale, result.timeZone, result.timeline],
  );

  return (
    <section data-testid="pack-capacity-estimate-timeline">
      <ChartContainer
        title={t(
          'packCapacity.timeline.title',
          'Capacity estimate timeline',
        )}
        subtitle={t(
          'packCapacity.timeline.subtitle',
          'Raw implied capacity, filtered posterior, and one-sigma envelope in the selected display unit.',
        )}
        ariaLabel={t(
          'packCapacity.timeline.aria',
          'Timeline of raw and filtered capacity estimates',
        )}
        height={360}
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
            <LineChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="date"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit={` ${energyUnit}`}
                width={72}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="raw"
                name={t('packCapacity.series.raw', 'Raw estimate')}
                stroke={chartTokens.series[3]}
                strokeOpacity={0.5}
                strokeWidth={1.5}
                dot={{ r: 2 }}
              />
              <Line
                type="monotone"
                dataKey="lower"
                name={t(
                  'packCapacity.series.lower',
                  'Posterior minus one sigma',
                )}
                stroke={chartTokens.series[4]}
                strokeOpacity={0.45}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="upper"
                name={t(
                  'packCapacity.series.upper',
                  'Posterior plus one sigma',
                )}
                stroke={chartTokens.series[4]}
                strokeOpacity={0.45}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="filtered"
                name={t(
                  'packCapacity.series.filtered',
                  'Filtered estimate',
                )}
                stroke={chartTokens.series[1]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </PackCapacitySectionBody>
      </ChartContainer>
    </section>
  );
}
