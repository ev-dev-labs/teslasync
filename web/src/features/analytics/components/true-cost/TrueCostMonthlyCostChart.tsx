import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
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

const EV_COLOR = '#22d3ee';
const GAS_COLOR = '#fb7185';

export function TrueCostMonthlyCostChart({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => analysis.eligibleMonthly
      .filter((row) =>
        row.month && row.evCost.value != null && row.gasCost.value != null)
      .map((row) => ({
        month: row.month!,
        monthLabel: display.formatMonth(row.month!),
        evCost: row.evCost.value!,
        gasCost: row.gasCost.value!,
      })),
    [analysis.eligibleMonthly, display],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      month: row.month,
      ev_cost: row.evCost,
      equiv_gas_cost: row.gasCost,
    })),
    [rows],
  );
  const ready = state.enabled && state.hasData && state.isResolved && rows.length > 0;

  return (
    <section
      data-testid="tco-monthly-cost-comparison"
      aria-label={t('tco.charts.monthlyCost.sectionAria', 'Monthly EV and modeled gas comparison')}
    >
      <ChartContainer
        title={t('tco.charts.monthlyCost.title', 'Monthly recorded EV vs modeled gas')}
        subtitle={t('tco.charts.monthlyCost.subtitle', 'Only returned months with positive recorded charging cost')}
        ariaLabel={t('tco.charts.monthlyCost.aria', 'Monthly recorded EV charging cost and energy-derived gas equivalent bars')}
        ariaDescription={t('tco.charts.monthlyCost.description', 'Monthly gas rows estimate distance from charged energy using lifetime efficiency or the endpoint fallback.')}
        exportable={ready}
        exportFilename="true-cost-monthly-ev-vs-gas"
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
            key: 'gasCost',
            label: t('tco.columns.gasCost', 'Modeled gas equivalent'),
            format: (value) => display.formatCurrency(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        chartKey="true-cost-monthly-cost"
        height={330}
      >
        {({ hiddenSeries }) => (
          <TrueCostSectionBody state={state} skeletonHeight={290}>
            {rows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                  {chartGrid}
                  <XAxis dataKey="monthLabel" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => display.formatCurrency(value, 0)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <Bar
                    dataKey="evCost"
                    name={t('tco.charts.monthlyCost.evSeries', 'Recorded EV cost')}
                    fill={EV_COLOR}
                    radius={[4, 4, 0, 0]}
                    hide={hiddenSeries?.isHidden('evCost')}
                  />
                  <Bar
                    dataKey="gasCost"
                    name={t('tco.charts.monthlyCost.gasSeries', 'Modeled gas equivalent')}
                    fill={GAS_COLOR}
                    radius={[4, 4, 0, 0]}
                    hide={hiddenSeries?.isHidden('gasCost')}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('tco.charts.monthlyCost.empty', 'No month has supported EV and modeled gas values.')} />
            )}
          </TrueCostSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
