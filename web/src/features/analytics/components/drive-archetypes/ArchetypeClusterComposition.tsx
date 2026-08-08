import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { Badge, Text } from '@/components/ui';
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity } from './labels';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeClusterCompositionProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeClusterComposition({
  summary,
  state,
  display,
}: ArchetypeClusterCompositionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      summary.clusters.map((cluster) => ({
        cluster: archetypeIdentity(t, cluster.index, cluster.label),
        shortCluster: t('archetypes.common.clusterNumber', 'Cluster {{number}}', {
          number: cluster.index + 1,
        }),
        share: cluster.share * 100,
        drives: cluster.size,
        distance: display.distanceValue(cluster.totalDistanceM),
        energy: display.energyValue(cluster.totalEnergyWh),
        distanceText: display.formatDistance(cluster.totalDistanceM),
        energyText: display.formatEnergy(cluster.totalEnergyWh),
      })),
    [display, summary.clusters, t],
  );
  const shareName = t('archetypes.composition.share', 'Eligible-drive share');

  return (
    <section data-testid="drive-archetypes-composition">
      <ChartContainer
        title={t('archetypes.composition.title', 'Cluster share and composition')}
        subtitle={t(
          'archetypes.composition.subtitle',
          'Membership share with observed distance and energy totals for each distinct cluster.',
        )}
        ariaLabel={t(
          'archetypes.composition.aria',
          'Eligible-drive membership percentage for each distinct drive archetype cluster',
        )}
        height={430}
        exportable={rows.length > 0}
        exportFilename="drive-archetype-composition"
        exportData={rows}
        data={rows}
        dataColumns={[
          { key: 'cluster', label: t('archetypes.common.cluster', 'Cluster') },
          { key: 'drives', label: t('archetypes.common.drives', 'Drives'), format: (value) => fmtInt(value) },
          { key: 'share', label: t('archetypes.composition.sharePercent', 'Share (%)'), format: (value) => fmtNumber(value, 1) },
          {
            key: 'distance',
            label: t('archetypes.composition.distanceColumn', 'Total distance ({{unit}})', {
              unit: display.distanceUnit,
            }),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'energy',
            label: t('archetypes.composition.energyColumn', 'Total energy ({{unit}})', {
              unit: display.energyUnit,
            }),
            format: (value) => fmtNumber(value, 1),
          },
        ]}
      >
        <ArchetypeSectionBody
          summary={summary}
          state={state}
          className="flex h-full flex-col gap-3"
          skeletonHeight={380}
        >
          <div className="min-h-56 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-white/10" />
                <XAxis dataKey="shortCluster" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, 100]}
                  tick={axisTick}
                  tickFormatter={(value) => `${fmtNumber(value, 0)}%`}
                />
                <Tooltip
                  content={<ChartTooltip valueFormatter={(value) => fmtPercent(value, 1)} />}
                />
                <Bar dataKey="share" name={shareName} radius={[4, 4, 0, 0]}>
                  {rows.map((row, index) => (
                    <Cell key={row.cluster} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="grid shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li
                key={row.cluster}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <Text variant="label">{row.cluster}</Text>
                  <Badge variant="info">{fmtPercent(row.share, 1)}</Badge>
                </div>
                <Text as="p" variant="caption" className="mt-1">
                  {t(
                    'archetypes.composition.cardDetail',
                    '{{drives}} drives · {{distance}} · {{energy}}',
                    {
                      drives: fmtInt(row.drives),
                      distance: row.distanceText,
                      energy: row.energyText,
                    },
                  )}
                </Text>
              </li>
            ))}
          </ul>
        </ArchetypeSectionBody>
      </ChartContainer>
    </section>
  );
}
