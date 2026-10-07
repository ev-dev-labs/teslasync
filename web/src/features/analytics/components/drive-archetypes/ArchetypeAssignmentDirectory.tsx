import { MapPin, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import { archetypeIdentity } from './labels';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeAssignmentDirectoryProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeAssignmentDirectory({
  summary,
  state,
  display,
}: ArchetypeAssignmentDirectoryProps) {
  const { t } = useTranslation();
  const items = summary.directory.items ?? [];

  return (
    <section data-testid="drive-archetypes-directory">
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <Route className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              {t('archetypes.directory.title', 'Representative and recent assignment directory')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'archetypes.directory.subtitle',
                'Newest-first eligible assignments, capped for display without changing assignment totals.',
              )}
            </Text>
          </div>
          <Badge variant="info">
            {t(
              'archetypes.directory.badge',
              '{{displayed}} of {{total}} shown',
              {
                displayed: fmtInt(summary.directory.displayed),
                total: fmtInt(summary.directory.total),
              },
            )}
          </Badge>
        </div>
        <ArchetypeSectionBody summary={summary} state={state} requirement="directory">
          <ul className="space-y-3">
            {items.map((assignment) => {
              const cluster = summary.clusters.find(
                (candidate) => candidate.index === assignment.clusterIndex,
              );
              const representative =
                cluster?.representativeDriveIds.includes(assignment.driveId)
                ?? false;
              const start = assignment.startAddress
                ?? t('archetypes.directory.unknownStart', 'Unknown start');
              const end = assignment.endAddress
                ?? t('archetypes.directory.unknownEnd', 'Unknown destination');
              const metrics = [
                [t('archetypes.directory.distance', 'Distance'), display.formatDistance(assignment.distanceM)],
                [t('archetypes.directory.speed', 'Average speed'), display.formatSpeed(assignment.speedMps)],
                [t('archetypes.directory.duration', 'Duration'), display.formatDuration(assignment.durationS)],
                [t('archetypes.directory.energy', 'Energy used'), display.formatEnergy(assignment.energyUsedWh)],
                [t('archetypes.directory.efficiency', 'Efficiency'), display.formatEfficiency(assignment.efficiencyWhPerM)],
                [t('archetypes.directory.temperature', 'Clustering temperature'), display.formatTemperature(assignment.tempC)],
                [t('archetypes.directory.assignmentDistance', 'Assignment distance'), fmtNumber(assignment.assignmentDistance, 3)],
                [t('archetypes.directory.secondDistance', 'Second-centroid distance'), assignment.secondClusterDistance != null ? fmtNumber(assignment.secondClusterDistance, 3) : '—'],
                [t('archetypes.directory.margin', 'Relative margin'), fmtPercent(assignment.assignmentMargin * 100, 1)],
              ] as const;
              return (
                <li
                  key={assignment.driveId}
                  data-testid={`drive-archetype-assignment-${assignment.driveId}`}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Text as="h4" variant="label">
                        {t('archetypes.directory.driveTitle', 'Drive {{id}}', {
                          id: fmtInt(assignment.driveId),
                        })}
                      </Text>
                      <Text as="p" variant="caption" className="mt-1">
                        {display.formatDateTime(assignment.departureMs)}
                      </Text>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {representative && (
                        <Badge variant="success">
                          {t('archetypes.directory.representative', 'Representative')}
                        </Badge>
                      )}
                      <Badge variant={assignment.tempImputed ? 'warning' : 'info'}>
                        {assignment.tempImputed
                          ? t('archetypes.directory.imputedTemperature', 'Temperature imputed')
                          : t('archetypes.directory.measuredTemperature', 'Temperature measured')}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    <Text as="p" variant="bodySm">
                      {t('archetypes.directory.route', '{{start}} → {{end}}', {
                        start,
                        end,
                      })}
                    </Text>
                  </div>
                  <Text as="p" variant="caption" className="mt-2">
                    {cluster
                      ? archetypeIdentity(t, cluster.index, cluster.label)
                      : t('archetypes.directory.clusterUnavailable', 'Cluster identity unavailable')}
                  </Text>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-9">
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
          {summary.directory.omitted > 0 && (
            <Text as="p" variant="caption" className="mt-4">
              {t(
                'archetypes.directory.omitted',
                '{{count}} older assignments are omitted by the {{cap}}-row display cap.',
                {
                  count: summary.directory.omitted,
                  cap: fmtInt(summary.directory.cap),
                },
              )}
            </Text>
          )}
        </ArchetypeSectionBody>
      </GlassPanel>
    </section>
  );
}
