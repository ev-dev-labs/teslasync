import { UnfoldHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity } from './labels';
import type { ArchetypeSectionProps } from './types';

export function ArchetypeSeparation({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="drive-archetypes-separation">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <UnfoldHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('archetypes.separation.title', 'Cohesion and nearest-cluster separation')}
        </PanelTitle>
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
                [t('archetypes.separation.meanDistance', 'Mean assignment distance'), fmtNumber(cluster.meanAssignmentDistance, 3)],
                [t('archetypes.separation.p90Distance', 'P90 assignment distance'), fmtNumber(cluster.p90AssignmentDistance, 3)],
                [t('archetypes.separation.nearestDistance', 'Nearest centroid distance'), cluster.nearestCentroidDistance != null ? fmtNumber(cluster.nearestCentroidDistance, 3) : '—'],
                [t('archetypes.separation.medianMargin', 'Median assignment margin'), fmtPercent(cluster.medianAssignmentMargin * 100, 1)],
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
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {metrics.map(([label, value]) => (
                      <div key={label}>
                        <MetricLabel>{label}</MetricLabel>
                        <Text as="p" variant="bodySm" className="mt-1">{value}</Text>
                      </div>
                    ))}
                  </div>
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
      </GlassPanel>
    </section>
  );
}
