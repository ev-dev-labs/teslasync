import { Footprints, Layers3, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, MetricValue, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { JourneyFragmentationSectionProps, percent } from './_types';

export function StructureIndicators({ result }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();
  const shortDistance = result.shortFragmentDistanceM > 0
    ? formatDistance(result.shortFragmentDistanceM, { precision: 1 })
    : '—';
  const observedDistance = convertDistanceFromSI(result.totalDistanceM, unitPrefs.distance);
  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <div>
        <Text as="h2" variant="panelTitle">{t('journeyFragmentation.structure.title', 'Short-fragment and chain structure')}</Text>
        <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.structure.subtitle', 'Structural indicators describe the returned records; they are not route or intent recommendations.')}</Text>
      </div>
      {result.includedDrives === 0 ? (
        <EmptyState icon={<Footprints className="h-7 w-7" />} message={t('journeyFragmentation.structure.empty', 'No included drives are available for structural indicators.')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Footprints className="mb-2 h-5 w-5 text-amber-300" aria-hidden="true" />
            <Text as="p" variant="label">{t('journeyFragmentation.structure.shortIndicator', 'Short-fragment indicator')}</Text>
            <MetricValue>{result.shortFragmentCount} / {result.shortFragmentDenominator}</MetricValue>
            <Text as="p" variant="caption">{shortDistance} · {percent(result.shortFragmentDistanceShare)} of observed distance</Text>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Layers3 className="mb-2 h-5 w-5 text-purple-300" aria-hidden="true" />
            <Text as="p" variant="label">{t('journeyFragmentation.structure.compact', 'Compact observed chains')}</Text>
            <MetricValue>{result.compactObservedChainCount}</MetricValue>
            <Text as="p" variant="caption">{t('journeyFragmentation.structure.compactHint', 'Multi-drive, short linked gaps, and within the configured distance rule')}</Text>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Route className="mb-2 h-5 w-5 text-cyan-300" aria-hidden="true" />
            <Text as="p" variant="label">{t('journeyFragmentation.structure.distance', 'Included distance')}</Text>
            <MetricValue>{formatDistance(result.totalDistanceM, { precision: 1 })}</MetricValue>
            <Text as="p" variant="caption">
              {t('journeyFragmentation.structure.distanceBoundary', '{{distance}} at the display-unit render boundary', {
                distance: `${observedDistance.toFixed(1)} ${unitPrefs.distance}`,
              })}
            </Text>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
