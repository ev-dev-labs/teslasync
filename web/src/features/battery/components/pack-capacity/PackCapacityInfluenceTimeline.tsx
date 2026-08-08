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

interface PackCapacityInfluenceTimelineProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  energyUnit: EnergyUnitPref;
}

export function PackCapacityInfluenceTimeline({
  result,
  state,
  locale,
  energyUnit,
}: PackCapacityInfluenceTimelineProps) {
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
        gain: point.gain * 100,
        innovation: point.standardizedInnovation,
        sigma: convertEnergyFromSI(point.sigmaWh, energyUnit),
      })),
    [energyUnit, locale, result.timeZone, result.timeline],
  );

  return (
    <section data-testid="pack-capacity-influence-timeline">
      <ChartContainer
        title={t(
          'packCapacity.influence.title',
          'Influence and uncertainty timeline',
        )}
        subtitle={t(
          'packCapacity.influence.subtitle',
          'Kalman gain, standardized innovation, and posterior sigma expose how each measurement updates the filter.',
        )}
        ariaLabel={t(
          'packCapacity.influence.aria',
          'Timeline of measurement influence and filter uncertainty',
        )}
        height={340}
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
                yAxisId="score"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
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
              <Line
                yAxisId="score"
                dataKey="gain"
                name={t(
                  'packCapacity.series.gain',
                  'Measurement gain (%)',
                )}
                stroke={chartTokens.series[0]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                yAxisId="score"
                dataKey="innovation"
                name={t(
                  'packCapacity.series.innovation',
                  'Standardized innovation',
                )}
                stroke={chartTokens.series[3]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
              <Line
                yAxisId="energy"
                dataKey="sigma"
                name={t(
                  'packCapacity.series.sigma',
                  'Posterior sigma',
                )}
                stroke={chartTokens.series[4]}
                strokeWidth={2.5}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </PackCapacitySectionBody>
      </ChartContainer>
    </section>
  );
}
