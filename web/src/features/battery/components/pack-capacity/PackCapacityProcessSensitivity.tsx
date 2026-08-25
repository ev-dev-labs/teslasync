import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartLegend,
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

interface PackCapacityProcessSensitivityProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  energyUnit: EnergyUnitPref;
}

export function PackCapacityProcessSensitivity({
  result,
  state,
  energyUnit,
}: PackCapacityProcessSensitivityProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      result.processSensitivity.map((point) => ({
        noise: point.processNoiseWhPerSqrtDay,
        current:
          point.currentWh == null
            ? null
            : convertEnergyFromSI(point.currentWh, energyUnit),
        sigma:
          point.currentSigmaWh == null
            ? null
            : convertEnergyFromSI(point.currentSigmaWh, energyUnit),
      })),
    [energyUnit, result.processSensitivity],
  );

  return (
    <section data-testid="pack-capacity-process-sensitivity">
      <ChartContainer
        title={t(
          'packCapacity.processSensitivity.title',
          'Process-noise sensitivity',
        )}
        subtitle={t(
          'packCapacity.processSensitivity.subtitle',
          'Re-runs the same measurements under alternative random-walk assumptions.',
        )}
        ariaLabel={t(
          'packCapacity.processSensitivity.aria',
          'Capacity estimate sensitivity to process uncertainty',
        )}
        size="standard"
        loading={state.isLoading}
        empty={false}
        exportable={state.isResolved && !state.error}
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'noise',
            label: t('packCapacity.columns.processNoise', 'Process noise (Wh / square-root day)'),
          },
          {
            key: 'current',
            label: `${t('packCapacity.series.current', 'Current estimate')} (${energyUnit})`,
          },
          {
            key: 'sigma',
            label: `${t('packCapacity.series.sigma', 'Posterior sigma')} (${energyUnit})`,
          },
        ]}
        chartKey="pack-capacity-process-sensitivity"
      >
        {({ hiddenSeries }) => (
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
                dataKey="noise"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit=" Wh"
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                unit={` ${energyUnit}`}
                width={72}
              />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Line
                dataKey="current"
                name={t(
                  'packCapacity.series.current',
                  'Current estimate',
                )}
                stroke={chartTokens.series[1]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                hide={hiddenSeries?.isHidden('current')}
              />
              <Line
                dataKey="sigma"
                name={t(
                  'packCapacity.series.sigma',
                  'Posterior sigma',
                )}
                stroke={chartTokens.series[4]}
                strokeWidth={2}
                dot={{ r: 3 }}
                hide={hiddenSeries?.isHidden('sigma')}
              />
              </LineChart>
            </ResponsiveContainer>
          </PackCapacitySectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
