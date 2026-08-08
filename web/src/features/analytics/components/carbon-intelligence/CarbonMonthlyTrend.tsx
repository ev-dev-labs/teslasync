import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
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
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

const COLOR_CO2 = '#f59e0b';
const COLOR_ENERGY = '#22d3ee';

export function CarbonMonthlyTrend({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const co2Series = t('carbon.monthly.co2Series', 'Attributed CO₂');
  const energySeries = t('carbon.monthly.energySeries', 'Charging energy');
  const chartRows = useMemo(
    () => analysis.period.monthly.map((row) => ({
      month: row.month,
      monthLabel: display.formatMonth(row.month),
      co2Kg: row.co2Kg,
      energy: display.energyValue(row.energyWh),
      energyWh: row.energyWh,
    })),
    [analysis.period.monthly, display],
  );
  const exportRows = useMemo(
    () => chartRows.map((row) => ({
      month: row.month,
      co2_kg: row.co2Kg,
      energy_wh: row.energyWh,
      [`energy_${display.energyUnit.toLowerCase()}`]: row.energy,
    })),
    [chartRows, display.energyUnit],
  );

  return (
    <section
      data-testid="carbon-monthly-trend"
      aria-label={t(
        'carbon.monthly.sectionAria',
        'Selected-period monthly carbon and energy trend',
      )}
    >
      <ChartContainer
        title={t(
          'carbon.monthly.title',
          'Selected-period monthly CO₂ and energy',
        )}
        subtitle={t(
          'carbon.monthly.subtitle',
          'Only monthly rows returned by the selected-period summary',
        )}
        ariaLabel={t(
          'carbon.monthly.aria',
          'Monthly selected-period attributed carbon dioxide bars and charging energy line',
        )}
        ariaDescription={t(
          'carbon.monthly.description',
          'The chart does not substitute lifetime monthly rows when selected-period data is unavailable.',
        )}
        exportable
        exportFilename="selected-period-carbon-monthly"
        exportData={exportRows}
        data={chartRows}
        dataColumns={[
          {
            key: 'monthLabel',
            label: t('carbon.monthly.month', 'Month'),
          },
          {
            key: 'co2Kg',
            label: t('carbon.monthly.co2Column', 'Attributed CO₂'),
            format: (value) => display.formatKg(
              typeof value === 'number' ? value : null,
            ),
          },
          {
            key: 'energyWh',
            label: t('carbon.monthly.energyColumn', 'Charging energy'),
            format: (value) => display.formatEnergy(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        chartKey="carbon-period-monthly"
        height={340}
      >
        {({ hiddenSeries }) => (
          <CarbonSectionBody state={states.period} skeletonHeight={300}>
            {chartRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartRows}
                  margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
                >
                  {chartGrid}
                  <XAxis
                    dataKey="monthLabel"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="co2"
                    width={48}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) =>
                      display.formatNumber(value, 1)}
                  />
                  <YAxis
                    yAxisId="energy"
                    orientation="right"
                    width={48}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) =>
                      display.formatNumber(value, 1)}
                  />
                  <Tooltip
                    content={(
                      <ChartTooltip
                        valueFormatter={(value, name) =>
                          name === energySeries
                            ? t(
                              'carbon.units.energyDisplay',
                              '{{value}} {{unit}}',
                              {
                                value: display.formatNumber(Number(value), 2),
                                unit: display.energyUnit,
                              },
                            )
                            : display.formatKg(Number(value))}
                      />
                    )}
                  />
                  <ChartLegend />
                  <Bar
                    yAxisId="co2"
                    dataKey="co2Kg"
                    name={co2Series}
                    fill={COLOR_CO2}
                    radius={[5, 5, 0, 0]}
                    hide={hiddenSeries?.isHidden('co2Kg')}
                  />
                  <Line
                    yAxisId="energy"
                    dataKey="energy"
                    name={energySeries}
                    stroke={COLOR_ENERGY}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    hide={hiddenSeries?.isHidden('energy')}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                message={t(
                  'carbon.monthly.empty',
                  'The selected-period summary returned no monthly rollup rows.',
                )}
              />
            )}
          </CarbonSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
