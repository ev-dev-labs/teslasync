import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useUnits } from '@/hooks/useUnits';

import { JourneyFragmentationSectionProps } from './_types';
import { PendingEvidence } from './PendingEvidence';

export function ElapsedComposition({ result, state, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const available = state?.hasData ?? !loading;
  const retained = !!state?.hasData && (
    state.status === 'stale' || state.refreshError != null || state.isRefreshBlocked
  );
  return (
    <div className="space-y-4">
      <div>
        <Text as="h2" variant="panelTitle">{t('journeyFragmentation.elapsed.title', 'Elapsed composition')}</Text>
        <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.elapsed.subtitle', 'Driving time and observed parking time allocated only across linked journey pairs.')}</Text>
      </div>
      {state && !state.hasData ? <PendingEvidence state={state} loading={loading} /> : result.journeyCount === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ icon={<Clock3 className="h-7 w-7" />} message={t('journeyFragmentation.elapsed.empty', 'Elapsed composition will appear when included drives are returned.')} />
      ) : null}
        <NestedDrivingBrief title={t('journeyFragmentation.brief.elapsedTitle', 'Linked journey timing')}
          description={t('journeyFragmentation.elapsed.subtitle', 'Driving time and observed parking time allocated only across linked journey pairs.')}
          loading={loading}
          retained={retained}
          unavailable={!available && !loading}
          period={{ kind: 'unknown', label: t('journeyFragmentation.elapsed.title', 'Elapsed composition'),
            reason: t('journeyFragmentation.elapsed.pairsHint', 'Parking intervals retained inside observed chains') }}
          metrics={[
            { metricId: 'duration', occurrenceId: 'driving-time', rawValue: available ? result.drivingSeconds : null,
              label: t('journeyFragmentation.elapsed.driving', 'Driving time'),
              display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) } },
            { metricId: 'duration', occurrenceId: 'parking-time', rawValue: available ? result.observedParkingSeconds : null,
              label: t('journeyFragmentation.elapsed.parking', 'Observed parking time'),
              display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) } },
            { metricId: 'count', occurrenceId: 'linked-stopovers', rawValue: available ? result.linkedPairs : null,
              label: t('journeyFragmentation.elapsed.pairs', 'Linked stopovers'),
              context: t('journeyFragmentation.elapsed.pairsHint', 'Parking intervals retained inside observed chains') },
          ]} />
    </div>
  );
}
