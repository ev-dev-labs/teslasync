import { Clock3, ParkingCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, MetricValue, Text } from '@/components/ui';
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
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Clock3 className="mb-2 h-5 w-5 text-cyan-300" aria-hidden="true" />
            <Text as="p" variant="label">{t('journeyFragmentation.elapsed.driving', 'Driving time')}</Text>
            <MetricValue>{loading ? '—' : formatDuration(result.drivingSeconds, { precision: 1 })}</MetricValue>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <ParkingCircle className="mb-2 h-5 w-5 text-amber-300" aria-hidden="true" />
            <Text as="p" variant="label">{t('journeyFragmentation.elapsed.parking', 'Observed parking time')}</Text>
            <MetricValue>{loading ? '—' : formatDuration(result.observedParkingSeconds, { precision: 1 })}</MetricValue>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Text as="p" variant="label">{t('journeyFragmentation.elapsed.pairs', 'Linked stopovers')}</Text>
            <MetricValue>{loading ? '—' : result.linkedPairs}</MetricValue>
            <Text as="p" variant="caption">{t('journeyFragmentation.elapsed.pairsHint', 'Parking intervals retained inside observed chains')}</Text>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
