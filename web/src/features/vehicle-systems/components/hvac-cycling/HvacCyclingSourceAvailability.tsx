import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { SourceAvailabilityBrief } from '../operationalbrief-all/SourceAvailabilityBrief';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingSourceAvailabilityProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

export function HvacCyclingSourceAvailability({
  summary,
  state,
}: HvacCyclingSourceAvailabilityProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const signal = summary.signals;

  return (
    <section data-testid="hvac-cycling-source-availability">
      <LayoutCard title={t('hvacCycling.sources.title', 'Source and signal availability')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.sources.subtitle',
            'Interpretable signal presence among unique timestamp-valid rows; availability does not imply an independent measurement.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <SourceAvailabilityBrief id="hvac-cycling-source-summary"
            title={t('hvacCycling.sources.title', 'Source and signal availability')}
            denominator={signal.denominatorRows}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('hvacCycling.sources.subtitle', 'Interpretable signal presence among unique timestamp-valid rows; availability does not imply an independent measurement.') }}
            items={[
              { id: 'power', label: t('hvacCycling.sources.power', 'HVAC power'), count: signal.hvacPowerRows },
              { id: 'ac', label: t('hvacCycling.sources.ac', 'A/C state'), count: signal.acRows },
              { id: 'fan-speed', label: t('hvacCycling.sources.fanSpeed', 'Fan speed'), count: signal.fanSpeedRows },
              { id: 'fan-status', label: t('hvacCycling.sources.fanStatus', 'Fan status'), count: signal.fanStatusRows },
              { id: 'any', label: t('hvacCycling.sources.any', 'Any interpretable input'), count: signal.anySignalRows,
                note: t('hvacCycling.sources.anyHint', 'Required for a known HVAC state') },
              { id: 'conflicts', label: t('hvacCycling.sources.conflicts', 'Mixed on/off inputs'), count: signal.anyConflictRows,
                note: t('hvacCycling.sources.conflictHint', '{{power}} power/A/C · {{fan}} fan-pair conflicts', {
                  power: fmtInt(signal.powerAcConflictRows), fan: fmtInt(signal.fanConflictRows),
                }) },
            ]}
          />
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
