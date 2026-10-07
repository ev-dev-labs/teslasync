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
import type { ArchetypeSectionProps } from './types';

export function ArchetypeHourlyProfile({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      summary.hourlyProfile.map((bucket) => {
        const row: Record<string, string | number> = {
          hour: `${String(bucket.hour).padStart(2, '0')}:00`,
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
    [summary.clusters, summary.hourlyProfile],
  );
  const columns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'hour', label: t('archetypes.hourly.hour', 'Local start hour') },
      {
        key: 'total',
        label: t('archetypes.hourly.total', 'All assignments'),
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
    <section data-testid="drive-archetypes-hourly">
      <ChartContainer
        title={t('archetypes.hourly.title', 'Hourly archetype profile')}
        subtitle={t(
          'archetypes.hourly.subtitle',
          'Newest-window assignments by local departure hour and distinct cluster.',
        )}
        ariaLabel={t(
          'archetypes.hourly.aria',
          'Stacked assignment counts for each drive archetype cluster across local departure hours',
        )}
        height={360}
        exportable={summary.assignments.length > 0}
        exportFilename="drive-archetype-hourly-profile"
        exportData={rows}
        chartKey="drive-archetype-hourly-profile"
        data={rows}
        dataColumns={columns}
      >
        {({ hiddenSeries }) => (
          <ArchetypeSectionBody summary={summary} state={state} className="h-full" skeletonHeight={310}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
                <XAxis dataKey="hour" tick={axisTick} interval={2} tickLine={false} axisLine={false} />
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
