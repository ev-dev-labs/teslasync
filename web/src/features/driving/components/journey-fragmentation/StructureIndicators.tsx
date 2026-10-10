import { Footprints } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { JourneyFragmentationSectionProps, percent } from './_types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function StructureIndicators({ result }: JourneyFragmentationSectionProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();
  const shortDistance = result.shortFragmentDistanceM > 0
    ? formatDistance(result.shortFragmentDistanceM)
    : '—';
  const observedDistance = convertDistanceFromSI(result.totalDistanceM, unitPrefs.distance);
  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <div>
        <Text as="h2" variant="panelTitle">{t('journeyFragmentation.structure.title', 'Short-fragment and chain structure')}</Text>
        <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.structure.subtitle', 'Structural indicators describe the returned records; they are not route or intent recommendations.')}</Text>
      </div>
      {result.includedDrives === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ icon={<Footprints className="h-7 w-7" />} message={t('journeyFragmentation.structure.empty', 'No included drives are available for structural indicators.')} />
      ) : (
        <NestedDrivingBrief title={t('journeyFragmentation.brief.structureTitle', 'Observed chain quantities')}
          description={t('journeyFragmentation.structure.subtitle', 'Structural indicators describe the returned records; they are not route or intent recommendations.')}
          period={{ kind: 'unknown', label: t('journeyFragmentation.structure.title', 'Short-fragment and chain structure'),
            reason: t('journeyFragmentation.structure.compactHint', 'Multi-drive, short linked gaps, and within the configured distance rule') }}
          metrics={[
            { metricId: 'count', occurrenceId: 'short-fragments', rawValue: result.shortFragmentCount,
              display: { countTotal: result.shortFragmentDenominator },
              label: t('journeyFragmentation.structure.shortIndicator', 'Short-fragment indicator'),
              context: t('journeyFragmentation.brief.shortDistance', '{{distance}} · {{share}} of observed distance', {
                distance: shortDistance, share: percent(result.shortFragmentDistanceShare),
              }) },
            { metricId: 'count', occurrenceId: 'compact-chains', rawValue: result.compactObservedChainCount,
              label: t('journeyFragmentation.structure.compact', 'Compact observed chains'),
              context: t('journeyFragmentation.structure.compactHint', 'Multi-drive, short linked gaps, and within the configured distance rule') },
            { metricId: 'distance', occurrenceId: 'included-distance', rawValue: result.totalDistanceM,
              label: t('journeyFragmentation.structure.distance', 'Included distance'),
              display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
              context: t('journeyFragmentation.structure.distanceBoundary', '{{distance}} at the display-unit render boundary', {
                distance: `${fmtNumber(observedDistance)} ${unitPrefs.distance}`,
              }) },
          ]} />
      )}
    </GlassPanel>
  );
}
