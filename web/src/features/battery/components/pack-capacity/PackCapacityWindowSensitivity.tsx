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

interface PackCapacityWindowSensitivityProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  energyUnit: EnergyUnitPref;
}

export function PackCapacityWindowSensitivity({
  result,
  state,
  energyUnit,
}: PackCapacityWindowSensitivityProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.windowSensitivity.map((point) => ({
        threshold: `${point.minSocWindowPct}%`,
        included: point.includedRows,
        current:
          point.currentWh == null
            ? null
            : convertEnergyFromSI(point.currentWh, energyUnit),
        sigma:
          point.currentSigmaWh == null
            ? null
            : convertEnergyFromSI(point.currentSigmaWh, energyUnit),
      })),
    [energyUnit, result.windowSensitivity],
  );

  return (
    <section data-testid="pack-capacity-window-sensitivity">
      <ChartContainer
        title={t(
          'packCapacity.windowSensitivity.title',
          'Minimum-window sensitivity',
        )}
        subtitle={t(
          'packCapacity.windowSensitivity.subtitle',
          'Re-runs eligibility and filtering across minimum SoC-gain thresholds.',
        )}
        ariaLabel={t(
          'packCapacity.windowSensitivity.aria',
          'Capacity estimate sensitivity to minimum state of charge window',
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
                dataKey="threshold"
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
                dataKey="included"
                name={t(
                  'packCapacity.series.included',
                  'Included sessions',
                )}
                fill={chartTokens.series[0]}
                fillOpacity={0.55}
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="energy"
                dataKey="current"
                name={t(
                  'packCapacity.series.current',
                  'Current estimate',
                )}
                stroke={chartTokens.series[1]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="energy"
                dataKey="sigma"
                name={t(
                  'packCapacity.series.sigma',
                  'Posterior sigma',
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
