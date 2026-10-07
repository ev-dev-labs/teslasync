import {
  Activity,
  Layers3,
  ScanSearch,
  ShieldCheck,
  Split,
  Waypoints,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { archetypeQualityLabel, archetypeStatusLabel } from './labels';
import { ArchetypeQueryStatus } from './ArchetypeQueryStatus';
import type { ArchetypeSectionProps } from './types';

export function ArchetypeEvidenceLedger({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const clustered = resolved && summary.status === 'clustered';
  const ambiguous = summary.clusters.reduce(
    (total, cluster) => total + cluster.ambiguousAssignments,
    0,
  );

  return (
    <section
      data-testid="drive-archetypes-kpis"
      aria-label={t(
        'archetypes.kpis.aria',
        'Drive archetype KPI and evidence ledger',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('archetypes.kpis.title', 'KPI and evidence ledger')}
        </PanelTitle>
        <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
          <MetricCard
            label={t('archetypes.kpis.returned', 'Returned rows')}
            value={resolved ? fmtInt(summary.source.returnedRows) : '—'}
            subtitle={resolved
              ? t(
                  'archetypes.kpis.windowHint',
                  'Bounded at {{limit}} newest rows',
                  { limit: fmtInt(summary.coverage.historyLimit) },
                )
              : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}
            icon={<Activity className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('archetypes.kpis.eligible', 'Eligible drives')}
            value={resolved ? fmtInt(summary.analyzedDrives) : '—'}
            subtitle={resolved
              ? t('archetypes.kpis.skippedHint', '{{count}} rows excluded', {
                  count: summary.skippedDrives,
                })
              : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}
            icon={<ScanSearch className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('archetypes.kpis.clusters', 'Published clusters')}
            value={resolved ? fmtInt(summary.k) : '—'}
            subtitle={resolved
              ? t(
                  'archetypes.kpis.collisionsHint',
                  '{{count}} repeated heuristic labels',
                  { count: summary.labelCollisionCount },
                )
              : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}
            icon={<Layers3 className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('archetypes.kpis.status', 'Model status')}
            value={resolved ? archetypeStatusLabel(t, summary.status) : '—'}
            subtitle={resolved
              ? t(
                  'archetypes.kpis.dimensionsHint',
                  '{{active}} of 6 feature dimensions active',
                  { active: fmtInt(summary.activeFeatureDimensions) },
                )
              : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}
            icon={<Waypoints className="h-5 w-5" />}
            color={clustered ? 'green' : 'amber'}
          />
          <MetricCard
            label={t('archetypes.kpis.separation', 'Silhouette separation')}
            value={clustered ? fmtNumber(summary.silhouette, 3) : '—'}
            subtitle={clustered
              ? archetypeQualityLabel(t, summary.quality)
              : t('archetypes.kpis.notPublished', 'Not published')}
            icon={<Split className="h-5 w-5" />}
            color={summary.quality === 'strong' ? 'green' : 'amber'}
          />
          <MetricCard
            label={t('archetypes.kpis.ambiguous', 'Boundary-ambiguous drives')}
            value={clustered ? fmtInt(ambiguous) : '—'}
            subtitle={clustered
              ? t('archetypes.kpis.ambiguousHint', '{{share}} of assignments', {
                  share: fmtPercent(
                    summary.analyzedDrives > 0
                      ? (ambiguous / summary.analyzedDrives) * 100
                      : 0,
                    1,
                  ),
                })
              : t('archetypes.kpis.notPublished', 'Not published')}
            icon={<ShieldCheck className="h-5 w-5" />}
            color="amber"
          />
        </Grid>
        <ArchetypeQueryStatus summary={summary} state={state} />
      </GlassPanel>
    </section>
  );
}
