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
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

const COST_COLOR = '#22d3ee';
const ENERGY_COLOR = '#a78bfa';

export function TrueCostEnergyCostTrend({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => analysis.eligibleMonthly
      .filter((row) =>
        row.month && row.evCost.value != null && row.energyWh.value != null)
      .map((row) => ({
        month: row.month!,
        monthLabel: display.formatMonth(row.month!),
        evCost: row.evCost.value!,
        energy: display.energyValue(row.energyWh.value!),
        energyWh: row.energyWh.value!,
      })),
    [analysis.eligibleMonthly, display],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      month: row.month,
      ev_cost: row.evCost,
      energy_wh: row.energyWh,
    })),
    [rows],
  );
  const ready = state.enabled && state.hasData && state.isResolved && rows.length > 0;
  const energySeries = t('tco.charts.energy.energySeries', 'Recorded-cost energy');

  return (
    <section
      data-testid="tco-energy-cost-trend"
      aria-label={t('tco.charts.energy.sectionAria', 'Monthly recorded-cost energy and spend trend')}
    >
      <ChartContainer
        title={t('tco.charts.energy.title', 'Monthly charged energy + recorded cost')}
        subtitle={t('tco.charts.energy.subtitle', 'Both series use only positive recorded-cost session rows')}
        ariaLabel={t('tco.charts.energy.aria', 'Monthly recorded charging cost bars and recorded-cost energy line')}
        ariaDescription={t('tco.charts.energy.description', 'The chart cannot quantify free charging or sessions whose cost is missing.')}
        exportable={ready}
        exportFilename="true-cost-monthly-energy-cost"
        exportData={ready ? exportRows : undefined}
        data={ready ? rows : undefined}
        dataColumns={[
          { key: 'monthLabel', label: t('tco.columns.month', 'Month') },
          {
            key: 'evCost',
            label: t('tco.columns.evCost', 'Recorded EV cost'),
            format: (value) => display.formatCurrency(
              typeof value === 'number' ? value : null,
            ),
          },
          {
            key: 'energyWh',
            label: t('tco.columns.energy', 'Recorded-cost energy'),
            format: (value) => display.formatEnergy(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        chartKey="true-cost-energy-cost"
        height={330}
      >
        {({ hiddenSeries }) => (
          <TrueCostSectionBody state={state} skeletonHeight={290}>
            {rows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows}>
                  {chartGrid}
                  <XAxis dataKey="monthLabel" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="cost"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => display.formatCurrency(value, 0)}
                  />
                  <YAxis
                    yAxisId="energy"
                    orientation="right"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => display.formatNumber(value, 0)}
                  />
                  <Tooltip
                    content={<ChartTooltip valueFormatter={(value, name) =>
                      name === energySeries
                        ? `${display.formatNumber(Number(value), 2)} ${display.energyUnit}`
                        : display.formatCurrency(Number(value))} />}
                  />
                  <ChartLegend />
                  <Bar
                    yAxisId="cost"
                    dataKey="evCost"
                    name={t('tco.charts.energy.costSeries', 'Recorded EV cost')}
                    fill={COST_COLOR}
                    radius={[4, 4, 0, 0]}
                    hide={hiddenSeries?.isHidden('evCost')}
                  />
                  <Line
                    yAxisId="energy"
                    dataKey="energy"
                    name={energySeries}
                    stroke={ENERGY_COLOR}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    hide={hiddenSeries?.isHidden('energy')}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={t('tco.charts.energy.empty', 'No month has both supported recorded cost and energy.')} />
            )}
          </TrueCostSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
