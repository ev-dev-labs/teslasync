import {
  Activity,
  Layers3,
  ScanSearch,
  ShieldCheck,
  Split,
  Waypoints,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip, type StatMetric } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';

import { archetypeQualityLabel, archetypeStatusLabel } from './labels';
import { ArchetypeQueryStatus } from './ArchetypeQueryStatus';
import type { ArchetypeSectionProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ArchetypeEvidenceLedger({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { fmtInt, fmtScientificNumber, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const clustered = resolved && summary.status === 'clustered';
  const ambiguous = summary.clusters.reduce(
    (total, cluster) => total + cluster.ambiguousAssignments,
    0,
  );
  const awaiting = t('archetypes.kpis.awaiting', 'Awaiting drive evidence');
  const notPublished = t('archetypes.kpis.notPublished', 'Not published');
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'archetypes-returned',
      label: t('archetypes.kpis.returned', 'Returned rows'),
      rawValue: resolved ? fmtInt(summary.source.returnedRows) : null,
      context: <><Activity className="h-5 w-5" aria-hidden="true" />{resolved
        ? t('archetypes.kpis.windowHint', 'Bounded at {{limit}} newest rows', { limit: fmtInt(summary.coverage.historyLimit) })
        : awaiting}</>,
    },
    {
      metricId: 'text', occurrenceId: 'archetypes-eligible',
      label: t('archetypes.kpis.eligible', 'Eligible drives'),
      rawValue: resolved ? fmtInt(summary.analyzedDrives) : null,
      context: <><ScanSearch className="h-5 w-5" aria-hidden="true" />{resolved
        ? t('archetypes.kpis.skippedHint', '{{count}} rows excluded', { count: summary.skippedDrives })
        : awaiting}</>,
    },
    {
      metricId: 'text', occurrenceId: 'archetypes-clusters',
      label: t('archetypes.kpis.clusters', 'Published clusters'),
      rawValue: resolved ? fmtInt(summary.k) : null,
      context: <><Layers3 className="h-5 w-5" aria-hidden="true" />{resolved
        ? t('archetypes.kpis.collisionsHint', '{{count}} repeated heuristic labels', { count: summary.labelCollisionCount })
        : awaiting}</>,
    },
    {
      metricId: 'text', occurrenceId: 'archetypes-status',
      label: t('archetypes.kpis.status', 'Model status'),
      rawValue: resolved ? archetypeStatusLabel(t, summary.status) : null,
      context: <><Waypoints className="h-5 w-5" aria-hidden="true" />{resolved
        ? t('archetypes.kpis.dimensionsHint', '{{active}} of 6 feature dimensions active', { active: fmtInt(summary.activeFeatureDimensions) })
        : awaiting}</>,
    },
    {
      metricId: 'text', occurrenceId: 'archetypes-separation',
      label: t('archetypes.kpis.separation', 'Silhouette separation'),
      rawValue: clustered ? fmtScientificNumber(summary.silhouette, 3) : null,
      context: <><Split className="h-5 w-5" aria-hidden="true" />{clustered
        ? archetypeQualityLabel(t, summary.quality) : notPublished}</>,
    },
    {
      metricId: 'text', occurrenceId: 'archetypes-ambiguous',
      label: t('archetypes.kpis.ambiguous', 'Boundary-ambiguous drives'),
      rawValue: clustered ? fmtInt(ambiguous) : null,
      context: <><ShieldCheck className="h-5 w-5" aria-hidden="true" />{clustered
        ? t('archetypes.kpis.ambiguousHint', '{{share}} of assignments', {
          share: fmtPercent(summary.analyzedDrives > 0 ? (ambiguous / summary.analyzedDrives) * 100 : 0),
        }) : notPublished}</>,
    },
  ];

  return (
    <section
      data-testid="drive-archetypes-kpis"
      aria-label={t(
        'archetypes.kpis.aria',
        'Drive archetype KPI and evidence ledger',
      )}
    >
      <LayoutCard
        title={t('archetypes.kpis.title', 'KPI and evidence ledger')}
        actions={<ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <StatStrip
          id="archetype-evidence-metrics"
          variant="embedded"
          metrics={metrics}
          period={{
            kind: 'unknown',
            label: t('archetypes.coverage.sourcePeriod', 'Returned drive-history window'),
            reason: t('archetypes.coverage.subtitle', 'Coverage describes the returned history window, never lifetime driving behavior.'),
          }}
        />
        <ArchetypeQueryStatus summary={summary} state={state} />
      </LayoutCard>
    </section>
  );
}
