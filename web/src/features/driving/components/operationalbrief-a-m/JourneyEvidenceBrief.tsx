import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { EvidenceBand } from '../journey-fragmentation/EvidenceBand';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof EvidenceBand> & { available: boolean; retained: boolean };

export function JourneyEvidenceBrief({ result, loading = false, hasVehicle, error, onRetry, available, retained }: Props) {
  const { t } = useTranslation();
  const ready = hasVehicle && available && !loading;
  const evidenceBandLabel = {
    none: t('journeyFragmentation.evidence.band.none', 'No returned rows'),
    thin: t('journeyFragmentation.evidence.band.thin', 'Thin observed window'),
    observed: t('journeyFragmentation.evidence.band.observed', 'Observed window'),
    capped: t('journeyFragmentation.evidence.band.capped', 'Capped observed window'),
  }[result.evidenceBand];
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'journeys', rawValue: ready ? result.journeyCount : null,
      label: t('journeyFragmentation.kpi.journeys', 'Observed journeys'),
      description: ready ? t('journeyFragmentation.kpi.journeysHint', '{{count}} included drives', { count: result.includedDrives })
        : t('driving.brief.pending', 'Drive evidence is not available yet.') },
    { metricId: 'count', occurrenceId: 'linked-pairs', rawValue: ready ? result.linkedPairs : null,
      label: t('journeyFragmentation.kpi.linkedPairs', 'Linked pairs'),
      description: ready ? t('journeyFragmentation.kpi.linkedPairsHint', 'of {{count}} adjacent pairs', { count: result.pairAccounting.totalAdjacentPairs })
        : t('driving.brief.pending', 'Drive evidence is not available yet.') },
    { metricId: 'percent', occurrenceId: 'multi-drive', rawValue: ready && result.multiDriveShare != null ? result.multiDriveShare * 100 : null,
      label: t('journeyFragmentation.kpi.multiDrive', 'Multi-drive journeys'),
      description: ready ? t('journeyFragmentation.kpi.multiDriveHint', '{{count}} observed chains', { count: result.multiDriveJourneys })
        : t('driving.brief.pending', 'Drive evidence is not available yet.'), display: { precision: 0 } },
    { metricId: 'count', occurrenceId: 'short-fragments', rawValue: ready ? result.shortFragmentCount : null,
      label: t('journeyFragmentation.kpi.shortFragments', 'Short-fragment indicator'),
      description: ready ? t('journeyFragmentation.kpi.shortFragmentsHint', 'of {{count}} included drives', { count: result.shortFragmentDenominator })
        : t('driving.brief.pending', 'Drive evidence is not available yet.') },
    { metricId: 'count', occurrenceId: 'active-days', rawValue: ready ? result.activeDays : null,
      label: t('journeyFragmentation.kpi.activeDays', 'Active local days'),
      description: ready ? t('journeyFragmentation.kpi.activeWeeks', '{{count}} local weeks', { count: result.activeWeeks })
        : t('driving.brief.pending', 'Drive evidence is not available yet.') },
  ];
  return <section>
    <DrivingSummaryBrief metrics={metrics}
      eyebrow={t('journeyFragmentation.evidence.eyebrow', 'Observed history window')}
      title={t('journeyFragmentation.evidence.aria', 'Journey evidence and summary')}
      description={hasVehicle
        ? t('journeyFragmentation.evidence.scope', 'Descriptive continuity analysis; this is not lifetime history.')
        : t('journeyFragmentation.evidence.noVehicle', 'Choose a vehicle to populate this observed history window.')}
      scope={ready ? <>
        <span>{evidenceBandLabel}</span>{' · '}
        {t('journeyFragmentation.evidence.rowsSummary', '{{included}} included of {{returned}} returned rows', { included: result.includedDrives, returned: result.returnedRows })}
        {' · '}{result.capReached
          ? t('journeyFragmentation.evidence.capReached', 'The 1,000-row history cap was reached.')
          : t('journeyFragmentation.evidence.belowCap', 'The returned history is below the 1,000-row cap.')}
      </> : t('driving.brief.pending', 'Drive evidence is not available yet.')}
      provenance={t('journeyFragmentation.brief.source', 'Returned drive-history continuity at the selected parking-gap threshold, using local days and weeks.')}
      statusLabel={!hasVehicle ? t('driving.brief.noVehicle', 'Choose a vehicle')
        : !available && !loading && error == null ? t('driving.brief.unavailable', 'Source unavailable') : undefined}
      loading={loading} error={error} retained={retained} onRetry={onRetry} />
  </section>;
}
