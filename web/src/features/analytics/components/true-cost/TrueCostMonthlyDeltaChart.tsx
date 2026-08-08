import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartTooltip,
  ReferenceLine,
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

const DELTA_COLOR = '#f59e0b';

export function TrueCostMonthlyDeltaChart({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => analysis.eligibleMonthly
      .filter((row) => row.month && row.derivedFuelDelta != null)
      .map((row) => ({
        month: row.month!,
        monthLabel: display.formatMonth(row.month!),
        derivedFuelDelta: row.derivedFuelDelta!,
        apiSavings: row.apiSavings.value,
      })),
    [analysis.eligibleMonthly, display],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      month: row.month,
      derived_fuel_delta: row.derivedFuelDelta,
      api_savings: row.apiSavings,
    })),
    [rows],
  );
  const ready = state.enabled && state.hasData && state.isResolved && rows.length > 0;

  return (
    <section
      data-testid="tco-monthly-fuel-delta"
      aria-label={t('tco.charts.monthlyDelta.sectionAria', 'Monthly fuel savings and loss evidence')}
    >
      <ChartContainer
        title={t('tco.charts.monthlyDelta.title', 'Monthly fuel savings / loss')}
        subtitle={t('tco.charts.monthlyDelta.subtitle', 'Derived gas equivalent minus recorded EV cost')}
        ariaLabel={t('tco.charts.monthlyDelta.aria', 'Monthly derived fuel savings and loss bar chart around a zero line')}
        ariaDescription={t('tco.charts.monthlyDelta.description', 'Positive bars are modeled fuel savings; negative bars are modeled fuel losses.')}
        exportable={ready}
        exportFilename="true-cost-monthly-fuel-delta"
        exportData={ready ? exportRows : undefined}
        data={ready ? rows : undefined}
        dataColumns={[
          { key: 'monthLabel', label: t('tco.columns.month', 'Month') },
          {
            key: 'derivedFuelDelta',
            label: t('tco.columns.derivedDelta', 'Derived fuel delta'),
            format: (value) => display.formatSignedCurrency(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        height={320}
      >
        <TrueCostSectionBody state={state} skeletonHeight={280}>
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
                <Tooltip
                  content={<ChartTooltip valueFormatter={(value) =>
                    display.formatSignedCurrency(Number(value))} />}
                />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar
                  dataKey="derivedFuelDelta"
                  name={t('tco.charts.monthlyDelta.series', 'Derived fuel savings / loss')}
                  fill={DELTA_COLOR}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('tco.charts.monthlyDelta.empty', 'No supported monthly fuel deltas are available.')} />
          )}
        </TrueCostSectionBody>
      </ChartContainer>
    </section>
  );
}
