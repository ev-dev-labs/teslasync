import { Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity, archetypeLabel } from './labels';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeProfilesProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeProfiles({
  summary,
  state,
  display,
}: ArchetypeProfilesProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="drive-archetypes-profiles">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('archetypes.profiles.title', 'Detailed archetype profiles')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'archetypes.profiles.subtitle',
            'Centroids summarize model inputs; each cluster remains identified by number even when heuristic labels repeat.',
          )}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state}>
          <AlertBanner
            className="mb-4"
            variant={summary.labelCollisionCount > 0 ? 'warning' : 'info'}
          >
            {t(
              'archetypes.profiles.collisionDisclosure',
              '{{count}} repeated-label collisions are present. A repeated heuristic label may describe multiple distinct clusters.',
              { count: summary.labelCollisionCount },
            )}
          </AlertBanner>
          <ul className="grid gap-3 xl:grid-cols-2">
            {summary.clusters.map((cluster) => {
              const metrics = [
                [t('archetypes.profiles.centroidDistance', 'Centroid distance'), display.formatDistance(cluster.centroid.distanceM)],
                [t('archetypes.profiles.centroidSpeed', 'Centroid average speed'), display.formatSpeed(cluster.centroid.speedMps)],
                [t('archetypes.profiles.centroidHour', 'Centroid local start'), display.formatHour(cluster.centroid.hour)],
                [t('archetypes.profiles.centroidEfficiency', 'Centroid efficiency'), display.formatEfficiency(cluster.centroid.efficiencyWhPerM)],
                [t('archetypes.profiles.medianEfficiency', 'Median member efficiency'), display.formatEfficiency(cluster.medianEfficiencyWhPerM)],
                [t('archetypes.profiles.centroidTemperature', 'Modeled centroid temperature'), display.formatTemperature(cluster.centroid.tempC)],
                [t('archetypes.profiles.totalDistance', 'Observed total distance'), display.formatDistance(cluster.totalDistanceM)],
                [t('archetypes.profiles.totalEnergy', 'Observed total energy'), display.formatEnergy(cluster.totalEnergyWh)],
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
                        {t(
                          'archetypes.profiles.membership',
                          '{{count}} drives · {{share}} membership',
                          {
                            count: cluster.size,
                            share: fmtPercent(cluster.share * 100, 1),
                          },
                        )}
                      </Text>
                    </div>
                    <Badge variant="info">
                      {archetypeLabel(t, cluster.label)}
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
                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                    <Text as="p" variant="caption">
                      {t(
                        'archetypes.profiles.representatives',
                        'Representative drive IDs: {{ids}}',
                        {
                          ids: cluster.representativeDriveIds
                            .map((id) => fmtInt(id))
                            .join(', '),
                        },
                      )}
                    </Text>
                    <Text as="p" variant="caption" className="mt-1">
                      {t(
                        'archetypes.profiles.temperatureCaution',
                        'Centroid temperature is a model input average and may include disclosed median-imputed values.',
                      )}
                    </Text>
                  </div>
                </li>
              );
            })}
          </ul>
        </ArchetypeSectionBody>
      </GlassPanel>
    </section>
  );
}
