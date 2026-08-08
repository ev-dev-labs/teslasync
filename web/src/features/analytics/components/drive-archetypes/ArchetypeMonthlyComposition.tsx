import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  type ChartDataColumn,
} from '@/components/charts';
import { fmtInt } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity } from './labels';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeMonthlyCompositionProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeMonthlyComposition({
  summary,
  state,
  display,
}: ArchetypeMonthlyCompositionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      summary.monthlyProfile.map((bucket) => {
        const row: Record<string, string | number> = {
          month: display.formatMonth(bucket.month),
          total: bucket.total,
        };
        for (const cluster of summary.clusters) {
          row[`cluster${cluster.index}`] =
            bucket.clusters.find(
              (entry) => entry.clusterIndex === cluster.index,
            )?.count ?? 0;
        }
        return row;
      }),
    [display, summary.clusters, summary.monthlyProfile],
  );
  const columns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'month', label: t('archetypes.monthly.month', 'Month') },
      {
        key: 'total',
        label: t('archetypes.monthly.total', 'All assignments'),
        format: (value) => fmtInt(value),
      },
      ...summary.clusters.map((cluster) => ({
        key: `cluster${cluster.index}`,
        label: archetypeIdentity(t, cluster.index, cluster.label),
        format: (value: unknown) => fmtInt(value),
      })),
    ],
    [summary.clusters, t],
  );

  return (
    <section data-testid="drive-archetypes-monthly">
      <ChartContainer
        title={t('archetypes.monthly.title', 'Monthly archetype composition')}
        subtitle={t(
          'archetypes.monthly.subtitle',
          'Observed assignment mix by calendar month within the bounded history window.',
        )}
        ariaLabel={t(
          'archetypes.monthly.aria',
          'Stacked monthly assignment counts for each distinct drive archetype cluster',
        )}
        height={360}
        exportable={rows.length > 0}
        exportFilename="drive-archetype-monthly-composition"
        exportData={rows}
        chartKey="drive-archetype-monthly-composition"
        data={rows}
        dataColumns={columns}
      >
        {({ hiddenSeries }) => (
          <ArchetypeSectionBody summary={summary} state={state} className="h-full" skeletonHeight={310}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
                <XAxis dataKey="month" tick={axisTick} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={axisTick} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => fmtInt(value)} />} />
                <ChartLegend verticalAlign="top" align="right" />
                {summary.clusters.map((cluster, index) => {
                  const key = `cluster${cluster.index}`;
                  return (
                    <Bar
                      key={cluster.index}
                      dataKey={key}
                      name={archetypeIdentity(t, cluster.index, cluster.label)}
                      stackId="clusters"
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                      isAnimationActive={false}
                      hide={hiddenSeries?.isHidden(key) ?? false}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </ArchetypeSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
