import { Link2, MapPin, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, MetricValue, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { JourneyFragmentationSectionProps } from './_types';

export function JourneyDirectory({ result }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const { formatDistance, formatDuration } = useUnits();
  const journeys = [...result.journeys]
    .sort((first, second) => second.fragments - first.fragments || second.distanceM - first.distanceM)
    .slice(0, 8);
  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <div>
        <Text as="h2" variant="panelTitle">{t('journeyFragmentation.directory.title', 'Ranked observed journey directory')}</Text>
        <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.directory.subtitle', 'Top chains by included drive count, then distance. This is a directory of records, not a recommendation list.')}</Text>
      </div>
      {journeys.length === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ icon={<MapPin className="h-7 w-7" />} message={t('journeyFragmentation.directory.empty', 'No observed journeys are available for the directory.')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {journeys.map((journey, index) => (
            <div key={journey.driveIds.join('-')} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {index === 0 ? <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" /> : <Link2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  <Text as="p" variant="label">{t('journeyFragmentation.directory.rank', 'Rank {{rank}}', { rank: index + 1 })}</Text>
                </div>
                <Text as="p" variant="caption">{t('journeyFragmentation.directory.fragments', '{{count}} drives', { count: journey.fragments })}</Text>
              </div>
              <MetricValue>{formatDistance(journey.distanceM, { precision: 1 })}</MetricValue>
              <Text as="p" variant="caption">
                {journey.startAddress ?? t('journeyFragmentation.directory.unknownStart', 'Unlocated start')}
                {' → '}
                {journey.endAddress ?? t('journeyFragmentation.directory.unknownEnd', 'Unlocated end')}
              </Text>
              <Text as="p" variant="caption">{formatDuration(journey.drivingSeconds + journey.observedParkingSeconds, { precision: 1 })} · {t('journeyFragmentation.directory.gaps', '{{count}} linked gaps', { count: journey.parkingGapsMin.length })}</Text>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
