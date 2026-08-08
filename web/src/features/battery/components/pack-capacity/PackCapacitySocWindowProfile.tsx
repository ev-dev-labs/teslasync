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
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacitySocWindowProfileProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  energyUnit: EnergyUnitPref;
}

export function PackCapacitySocWindowProfile({
  result,
  state,
  energyUnit,
}: PackCapacitySocWindowProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.socWindowProfile.map((point) => ({
        window: `${point.lowerPct}–${point.upperPct}%`,
        samples: point.samples,
        median:
          point.medianObservedWh == null
            ? null
            : convertEnergyFromSI(point.medianObservedWh, energyUnit),
        relativeSigma:
          point.meanRelativeSigma == null
            ? null
            : point.meanRelativeSigma * 100,
      })),
    [energyUnit, result.socWindowProfile],
  );

  return (
    <section data-testid="pack-capacity-soc-window-profile">
      <ChartContainer
        title={t(
          'packCapacity.socProfile.title',
          'SoC-window quality profile',
        )}
        subtitle={t(
          'packCapacity.socProfile.subtitle',
          'Qualified measurements grouped by observed SoC gain; wider windows should carry less quantization uncertainty.',
        )}
        ariaLabel={t(
          'packCapacity.socProfile.aria',
          'Measurement count and uncertainty by state of charge window',
        )}
        height={320}
        loading={state.isLoading}
        empty={false}
        exportable={state.isResolved && !state.error}
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
                dataKey="window"
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
              <YAxis
                yAxisId="percent"
                domain={[0, 100]}
                hide
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
                fillOpacity={0.58}
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="energy"
                dataKey="median"
                name={t(
                  'packCapacity.series.binMedian',
                  'Median implied capacity',
                )}
                stroke={chartTokens.series[1]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="percent"
                dataKey="relativeSigma"
                name={t(
                  'packCapacity.series.binSigma',
                  'Mean relative sigma (%)',
                )}
                stroke={chartTokens.series[4]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </PackCapacitySectionBody>
      </ChartContainer>
    </section>
  );
}
