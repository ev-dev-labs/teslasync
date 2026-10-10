import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useUnits } from '@/hooks/useUnits';

import { JourneyFragmentationSectionProps } from './_types';

export function ElapsedComposition({ result, loading = false }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <div>
        <Text as="h2" variant="panelTitle">{t('journeyFragmentation.elapsed.title', 'Elapsed composition')}</Text>
        <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.elapsed.subtitle', 'Driving time and observed parking time allocated only across linked journey pairs.')}</Text>
      </div>
      {result.journeyCount === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ icon={<Clock3 className="h-7 w-7" />} message={t('journeyFragmentation.elapsed.empty', 'Elapsed composition will appear when included drives are returned.')} />
      ) : (
        <NestedDrivingBrief title={t('journeyFragmentation.brief.elapsedTitle', 'Linked journey timing')}
          description={t('journeyFragmentation.elapsed.subtitle', 'Driving time and observed parking time allocated only across linked journey pairs.')}
          loading={loading}
          period={{ kind: 'unknown', label: t('journeyFragmentation.elapsed.title', 'Elapsed composition'),
            reason: t('journeyFragmentation.elapsed.pairsHint', 'Parking intervals retained inside observed chains') }}
          metrics={[
            { metricId: 'duration', occurrenceId: 'driving-time', rawValue: result.drivingSeconds,
              label: t('journeyFragmentation.elapsed.driving', 'Driving time'),
              display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) } },
            { metricId: 'duration', occurrenceId: 'parking-time', rawValue: result.observedParkingSeconds,
              label: t('journeyFragmentation.elapsed.parking', 'Observed parking time'),
              display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) } },
            { metricId: 'count', occurrenceId: 'linked-stopovers', rawValue: result.linkedPairs,
              label: t('journeyFragmentation.elapsed.pairs', 'Linked stopovers'),
              context: t('journeyFragmentation.elapsed.pairsHint', 'Parking intervals retained inside observed chains') },
          ]} />
      )}
    </GlassPanel>
  );
}
