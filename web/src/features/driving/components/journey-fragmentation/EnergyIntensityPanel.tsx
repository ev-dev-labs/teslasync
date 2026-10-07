import { BatteryMedium, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, MetricValue, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import type { EnergyGroupSummary } from '../../lib/journeyFragmentation';
import { JourneyFragmentationSectionProps, percent } from './_types';

function groupLabel(group: EnergyGroupSummary, t: (key: string, fallback: string, options?: Record<string, unknown>) => string) {
  return t('journeyFragmentation.energy.coverage', '{{complete}} complete-energy journeys of {{total}} ({{coverage}} distance coverage)', {
    complete: group.completeEnergyJourneys,
    total: group.journeys,
    coverage: percent(group.distanceCoverage),
  });
}

export function EnergyIntensityPanel({ result }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();
  const displayIntensity = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return '—';
    const metersPerDisplayUnit = 1 / convertDistanceFromSI(1, unitPrefs.distance);
    return `${formatEnergy(value * metersPerDisplayUnit, { precision: 2 })} / ${unitPrefs.distance}`;
  };
  const comparison = result.energyComparison;
  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <div>
        <Text as="h2" variant="panelTitle">{t('journeyFragmentation.energy.title', 'Observed energy-intensity comparison')}</Text>
        <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.energy.subtitle', 'Distance-weighted whole-journey intensity with complete-energy coverage shown for each group.')}</Text>
      </div>
      {result.journeyCount === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ icon={<BatteryMedium className="h-7 w-7" />} message={t('journeyFragmentation.energy.empty', 'No observed journeys are available for energy comparison.')} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { key: 'single', label: t('journeyFragmentation.energy.single', 'Single-drive journeys'), group: comparison.singleDrive },
              { key: 'multi', label: t('journeyFragmentation.energy.multi', 'Multi-drive journeys'), group: comparison.multiDrive },
            ].map(({ key, label, group }) => (
              <div key={key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <Text as="p" variant="label">{label}</Text>
                <MetricValue>{displayIntensity(group.energyIntensityWhPerM)}</MetricValue>
                <Text as="p" variant="caption">{groupLabel(group, t)}</Text>
                <Text as="p" variant="caption">
                  {t('journeyFragmentation.energy.completeDistance', '{{distance}} complete-energy distance', {
                    distance: group.completeEnergyDistanceM > 0
                      ? formatDistance(group.completeEnergyDistanceM, { precision: 1 })
                      : '—',
                  })}
                </Text>
              </div>
            ))}
            <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
              <Info className="mb-2 h-5 w-5 text-cyan-300" aria-hidden="true" />
              <Text as="p" variant="label">{t('journeyFragmentation.energy.difference', 'Observed energy-intensity difference')}</Text>
              <MetricValue>{displayIntensity(comparison.observedDifferenceWhPerM)}</MetricValue>
              <Text as="p" variant="caption">{t('journeyFragmentation.energy.support', 'Support band: {{band}}; recommended minimum: {{count}} complete-energy journeys per group', { band: comparison.supportBand, count: comparison.minimumSupportedJourneys })}</Text>
            </div>
          </div>
          <Text as="p" variant="caption">
            {t('journeyFragmentation.energy.limit', 'Missing energy is excluded from intensity calculations, never treated as zero. The difference is descriptive and does not establish a cause.')}
          </Text>
        </>
      )}
    </GlassPanel>
  );
}
