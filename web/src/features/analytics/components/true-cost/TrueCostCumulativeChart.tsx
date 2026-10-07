import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

const DELTA_COLOR = '#818cf8';

export function TrueCostCumulativeChart({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => analysis.eligibleMonthly
      .filter((row) => row.month && row.derivedCumulativeDelta != null)
      .map((row) => ({
        month: row.month!,
        monthLabel: display.formatMonth(row.month!),
        derivedCumulativeDelta: row.derivedCumulativeDelta!,
        derivedFuelDelta: row.derivedFuelDelta,
        apiSavings: row.apiSavings.value,
        apiCumulative: row.apiCumulative.value,
      })),
    [analysis.eligibleMonthly, display],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      month: row.month,
      derived_fuel_delta: row.derivedFuelDelta,
      derived_cumulative_delta: row.derivedCumulativeDelta,
      api_savings: row.apiSavings,
      api_cumulative_savings: row.apiCumulative,
    })),
    [rows],
  );
  const ready = state.enabled && state.hasData && state.isResolved && rows.length > 0;

  return (
    <section
      data-testid="tco-cumulative-delta"
      aria-label={t('tco.charts.cumulative.sectionAria', 'Cumulative monthly fuel delta evidence')}
    >
      <ChartContainer
        title={t('tco.charts.cumulative.title', 'Cumulative fuel savings / loss')}
        subtitle={t('tco.charts.cumulative.subtitle', 'Derived sum of supported monthly gas-minus-EV rows')}
        ariaLabel={t('tco.charts.cumulative.aria', 'Cumulative derived monthly fuel savings or loss area chart')}
        ariaDescription={t('tco.charts.cumulative.description', 'Months are backend database calendar labels. Gaps mean no positive-cost monthly row was returned.')}
        exportable={ready}
        exportFilename="true-cost-cumulative-fuel-delta"
        exportData={ready ? exportRows : undefined}
        data={ready ? rows : undefined}
        dataColumns={[
          { key: 'monthLabel', label: t('tco.columns.month', 'Month') },
          {
            key: 'derivedCumulativeDelta',
            label: t('tco.columns.derivedCumulative', 'Derived cumulative delta'),
            format: (value) => display.formatSignedCurrency(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        height={330}
      >
        <TrueCostSectionBody state={state} skeletonHeight={290}>
          {rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
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
                <Area
                  type="monotone"
                  dataKey="derivedCumulativeDelta"
                  name={t('tco.charts.cumulative.series', 'Derived cumulative fuel delta')}
                  stroke={DELTA_COLOR}
                  fill={DELTA_COLOR}
                  fillOpacity={0.16}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('tco.charts.cumulative.empty', 'No supported monthly fuel deltas are available.')} />
          )}
        </TrueCostSectionBody>
      </ChartContainer>
    </section>
  );
}
