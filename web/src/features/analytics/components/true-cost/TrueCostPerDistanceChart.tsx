import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
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

export function TrueCostPerDistanceChart({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const ev = analysis.metrics.costPerKmEv.value;
  const gas = analysis.metrics.costPerKmIce.value;
  const rows = useMemo(
    () => ev != null && gas != null && analysis.gates.fuelComparison
      ? [
        {
          category: t('tco.perDistance.ev', 'Recorded EV'),
          cost: display.costPerDistanceValue(ev),
          fill: '#22d3ee',
        },
        {
          category: t('tco.perDistance.gas', 'Modeled gas'),
          cost: display.costPerDistanceValue(gas),
          fill: '#fb7185',
        },
      ]
      : [],
    [analysis.gates.fuelComparison, display, ev, gas, t],
  );
  const ready = state.enabled && state.hasData && state.isResolved && rows.length > 0;
  const exportRows = ready ? [
    { category: 'ev', cost_per_km: ev },
    { category: 'modeled_gas', cost_per_km: gas },
  ] : undefined;

  return (
    <section
      data-testid="tco-cost-per-distance"
      aria-label={t('tco.perDistance.sectionAria', 'Cost per selected display distance comparison')}
    >
      <ChartContainer
        title={t('tco.perDistance.title', 'Cost per {{unit}}', {
          unit: display.distanceUnit,
        })}
        subtitle={t('tco.perDistance.subtitle', 'Canonical API cost/km converted at this display boundary')}
        ariaLabel={t('tco.perDistance.aria', 'Recorded EV and modeled gas cost per {{unit}} bar chart', {
          unit: display.distanceUnit,
        })}
        ariaDescription={t('tco.perDistance.description', 'Both values use lifetime positive-drive distance as their denominator.')}
        exportable={ready}
        exportFilename="true-cost-per-distance"
        exportData={exportRows}
        data={ready ? rows : undefined}
        dataColumns={[
          { key: 'category', label: t('tco.perDistance.category', 'Category') },
          {
            key: 'cost',
            label: t('tco.perDistance.costColumn', 'Cost per {{unit}}', {
              unit: display.distanceUnit,
            }),
            format: (value) => display.formatCurrency(
              typeof value === 'number' ? value : null,
              4,
            ),
          },
        ]}
        height={300}
      >
        <TrueCostSectionBody state={state} skeletonHeight={260}>
          {rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                {chartGrid}
                <XAxis dataKey="category" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => display.formatCurrency(value, 3)}
                />
                <Tooltip
                  content={<ChartTooltip valueFormatter={(value) =>
                    display.formatCurrency(Number(value), 4)} />}
                />
                <Bar dataKey="cost" name={t('tco.perDistance.series', 'Cost per {{unit}}', {
                  unit: display.distanceUnit,
                })} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('tco.perDistance.empty', 'A supported fuel comparison is required for cost-per-distance evidence.')} />
          )}
        </TrueCostSectionBody>
      </ChartContainer>
    </section>
  );
}
