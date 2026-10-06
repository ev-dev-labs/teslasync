import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ArchetypeSectionBody } from '../drive-archetypes/ArchetypeSectionBody';
import type { ArchetypeSectionProps } from '../drive-archetypes/types';

export function ArchetypeSourceBrief({ summary, state }: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const source = summary.source;
  const resolved = state.isResolved && !state.error;
  const dispositions = [
    [t('archetypes.source.invalidRow', 'Invalid row'), source.invalidRowRows],
    [t('archetypes.source.invalidId', 'Invalid drive ID'), source.invalidIdRows],
    [t('archetypes.source.duplicate', 'Duplicate drive ID'), source.duplicateDriveRows],
    [t('archetypes.source.missingStart', 'Missing start time'), source.missingStartRows],
    [t('archetypes.source.invalidStart', 'Invalid start time'), source.invalidStartRows],
    [t('archetypes.source.invalidDistance', 'Invalid distance'), source.invalidDistanceRows],
    [t('archetypes.source.shortDistance', 'Below distance floor'), source.shortDistanceRows],
    [t('archetypes.source.missingEnergy', 'Missing energy'), source.missingEnergyRows],
    [t('archetypes.source.invalidEnergy', 'Invalid energy'), source.invalidEnergyRows],
    [t('archetypes.source.missingSpeed', 'Missing average speed'), source.missingSpeedRows],
    [t('archetypes.source.invalidSpeed', 'Invalid average speed'), source.invalidSpeedRows],
    [t('archetypes.source.observedTemp', 'Eligible · measured temperature'), source.eligibleObservedTempRows],
    [t('archetypes.source.imputedTemp', 'Eligible · imputed temperature'), source.eligibleImputedTempRows],
  ] as const;
  const description = t('archetypes.source.subtitle', 'Every returned row receives exactly one terminal disposition.');
  const metrics: StatMetric[] = dispositions.map(([label, count], index) => ({
    metricId: 'count', occurrenceId: `archetype-disposition-${index}`, label, rawValue: resolved ? count : null,
    description, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
    context: <Badge variant={index >= dispositions.length - 2 ? 'success' : 'neutral'}>
      {index >= dispositions.length - 2 ? t('archetypes.source.eligible', 'Eligible') : t('archetypes.source.excluded', 'Excluded')}
    </Badge>,
  }));
  const operationalMetrics = useOperationalMetrics(metrics);
  return <section data-testid="drive-archetypes-source">
    <OperationalBrief compact metrics={operationalMetrics} loading={state.isLoading}
      eyebrow={t('archetypes.title', 'Drive archetypes')}
      title={t('archetypes.source.title', 'Source eligibility disposition')} description={description}
      statusLabel={state.isLoading ? t('analytics.brief.loading', 'Loading evidence')
        : !resolved ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : state.refreshError || state.refreshPaused ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!resolved || state.refreshError || state.refreshPaused ? 'warning' : 'neutral'}
      scope={<span>{t('archetypes.coverage.sourcePeriod', 'Returned drive-history window')}</span>}
      freshness={<span>{resolved ? t('archetypes.source.returnedBadge', '{{count}} returned', { count: source.returnedRows })
        : t('archetypes.kpis.awaiting', 'Awaiting drive evidence')}</span>}
      provenance={t('archetypes.coverage.subtitle', 'Coverage describes the returned history window, never lifetime driving behavior.')} />
    <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">{null}</ArchetypeSectionBody>
  </section>;
}
