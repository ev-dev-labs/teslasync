import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { archetypeQualityLabel, archetypeStatusLabel } from '../drive-archetypes/labels';
import { ArchetypeQueryStatus } from '../drive-archetypes/ArchetypeQueryStatus';
import type { ArchetypeSectionProps } from '../drive-archetypes/types';

export function ArchetypeEvidenceBrief({ summary, state }: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtScientificNumber, fmtPercent } = useNumberFormatting();
  const resolved = state.isResolved && !state.error;
  const clustered = resolved && summary.status === 'clustered';
  const ambiguous = summary.clusters.reduce((total, cluster) => total + cluster.ambiguousAssignments, 0);
  const awaiting = t('archetypes.kpis.awaiting', 'Awaiting drive evidence');
  const notPublished = t('archetypes.kpis.notPublished', 'Not published');
  const countDisplay = { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) };
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'archetypes-returned', rawValue: resolved ? summary.source.returnedRows : null,
      label: t('archetypes.kpis.returned', 'Returned rows'), display: countDisplay,
      context: resolved ? t('archetypes.kpis.windowHint', 'Bounded at {{limit}} newest rows', { limit: fmtInt(summary.coverage.historyLimit) }) : awaiting },
    { metricId: 'count', occurrenceId: 'archetypes-eligible', rawValue: resolved ? summary.analyzedDrives : null,
      label: t('archetypes.kpis.eligible', 'Eligible drives'), display: countDisplay,
      context: resolved ? t('archetypes.kpis.skippedHint', '{{count}} rows excluded', { count: summary.skippedDrives }) : awaiting },
    { metricId: 'count', occurrenceId: 'archetypes-clusters', rawValue: resolved ? summary.k : null,
      label: t('archetypes.kpis.clusters', 'Published clusters'), display: countDisplay,
      context: resolved ? t('archetypes.kpis.collisionsHint', '{{count}} repeated heuristic labels', { count: summary.labelCollisionCount }) : awaiting },
    { metricId: 'status', occurrenceId: 'archetypes-status', rawValue: resolved ? archetypeStatusLabel(t, summary.status) : null,
      label: t('archetypes.kpis.status', 'Model status'),
      context: resolved ? t('archetypes.kpis.dimensionsHint', '{{active}} of 6 feature dimensions active', { active: fmtInt(summary.activeFeatureDimensions) }) : awaiting },
    { metricId: 'number', occurrenceId: 'archetypes-separation', rawValue: clustered ? summary.silhouette : null,
      label: t('archetypes.kpis.separation', 'Silhouette separation'),
      display: { formatter: raw => ({ value: fmtScientificNumber(raw, 3), unit: '' }) },
      context: clustered ? archetypeQualityLabel(t, summary.quality) : notPublished },
    { metricId: 'count', occurrenceId: 'archetypes-ambiguous', rawValue: clustered ? ambiguous : null,
      label: t('archetypes.kpis.ambiguous', 'Boundary-ambiguous drives'), display: countDisplay,
      context: clustered ? t('archetypes.kpis.ambiguousHint', '{{share}} of assignments', {
        share: fmtPercent(summary.analyzedDrives > 0 ? ambiguous / summary.analyzedDrives * 100 : 0) }) : notPublished },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const coverage = t('archetypes.coverage.subtitle', 'Coverage describes the returned history window, never lifetime driving behavior.');
  return <section data-testid="drive-archetypes-kpis"
    aria-label={t('archetypes.kpis.aria', 'Drive archetype KPI and evidence ledger')}>
    <OperationalBrief compact metrics={operationalMetrics} loading={state.isLoading}
      eyebrow={t('archetypes.title', 'Drive archetypes')}
      title={t('archetypes.kpis.title', 'KPI and evidence ledger')} description={coverage}
      statusLabel={state.isLoading ? t('analytics.brief.loading', 'Loading evidence')
        : !resolved ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : state.refreshError || state.refreshPaused ? t('analytics.brief.retained', 'Retained evidence')
            : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!resolved || state.refreshError || state.refreshPaused ? 'warning' : 'neutral'}
      scope={<span>{t('archetypes.coverage.sourcePeriod', 'Returned drive-history window')}</span>}
      provenance={coverage}
    />
    <ArchetypeQueryStatus summary={summary} state={state} />
  </section>;
}
