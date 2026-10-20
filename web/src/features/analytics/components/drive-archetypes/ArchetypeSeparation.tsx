import { UnfoldHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout';

import {
  Badge,
  MetricLabel,
  Table,
  Text,
} from '@/components/ui';

import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity } from './labels';
import type { ArchetypeSectionProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ArchetypeSeparation({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { fmtScientificNumber, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();

  return (
    <section data-testid="drive-archetypes-separation">
      <LayoutCard
        title={t('archetypes.separation.title', 'Cohesion and nearest-cluster separation')}
        actions={<UnfoldHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'archetypes.separation.subtitle',
            'Distances are dimensionless Euclidean distances in the standardized active-feature space.',
          )}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state}>
          <ul className="grid gap-3 lg:grid-cols-2">
            {summary.clusters.map((cluster) => {
              const nearest = summary.clusters.find(
                (candidate) => candidate.index === cluster.nearestClusterIndex,
              );
              const metrics = [
                [t('archetypes.separation.meanDistance', 'Mean assignment distance'), fmtScientificNumber(cluster.meanAssignmentDistance, 3)],
                [t('archetypes.separation.p90Distance', 'P90 assignment distance'), fmtScientificNumber(cluster.p90AssignmentDistance, 3)],
                [t('archetypes.separation.nearestDistance', 'Nearest centroid distance'), cluster.nearestCentroidDistance != null ? fmtScientificNumber(cluster.nearestCentroidDistance, 3) : '—'],
                [t('archetypes.separation.medianMargin', 'Median assignment margin'), fmtPercent(cluster.medianAssignmentMargin * 100)],
              ] as const;
              return (
                <li
                  key={cluster.index}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Text as="h4" variant="label">
                        {archetypeIdentity(t, cluster.index, cluster.label)}
                      </Text>
                      <Text as="p" variant="caption" className="mt-1">
                        {nearest
                          ? t(
                              'archetypes.separation.nearest',
                              'Nearest: {{cluster}}',
                              {
                                cluster: archetypeIdentity(
                                  t,
                                  nearest.index,
                                  nearest.label,
                                ),
                              },
                            )
                          : t('archetypes.separation.nearestUnavailable', 'Nearest cluster unavailable')}
                      </Text>
                    </div>
                    <Badge variant={cluster.ambiguousAssignments > 0 ? 'warning' : 'success'}>
                      {t(
                        'archetypes.separation.ambiguousBadge',
                        '{{count}} ambiguous',
                        { count: cluster.ambiguousAssignments },
                      )}
                    </Badge>
                  </div>
                  <Table className="mt-4" aria-label={archetypeIdentity(t, cluster.index, cluster.label)}>
                    <tbody>
                    {metrics.map(([label, value]) => (
                      <tr key={label}>
                        <th scope="row"><MetricLabel>{label}</MetricLabel></th>
                        <td className="text-right"><Text as="p" variant="bodySm">{value}</Text></td>
                      </tr>
                    ))}
                    </tbody>
                  </Table>
                </li>
              );
            })}
          </ul>
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'archetypes.separation.interpretation',
              'Lower within-cluster distance indicates tighter composition. Larger nearest-centroid distance indicates more geometric separation, not greater truth.',
            )}
          </Text>
        </ArchetypeSectionBody>
      </LayoutCard>
    </section>
  );
}
