import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { SourceAvailabilityBrief } from '../operationalbrief-all/SourceAvailabilityBrief';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencySourceAvailabilityProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
}

export function ComfortConsistencySourceAvailability({
  summary,
  state,
}: ComfortConsistencySourceAvailabilityProps) {
  const { t } = useTranslation();
  const source = summary.sources;

  return (
    <section data-testid="comfort-consistency-source-availability">
      <LayoutCard title={t('comfortConsistency.sources.title', 'Source and field availability')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.sources.subtitle',
            'Field presence among unique timestamp-valid rows; forward-filled values are timeline evidence, not independent measurements.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <SourceAvailabilityBrief id="comfort-consistency-source-summary"
            title={t('comfortConsistency.sources.title', 'Source and field availability')}
            denominator={source.denominatorRows}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.sources.subtitle', 'Field presence among unique timestamp-valid rows; forward-filled values are timeline evidence, not independent measurements.') }}
            items={[
              { id: 'inside', label: t('comfortConsistency.sources.inside', 'Cabin temperature'), count: source.insideTempRows },
              { id: 'driver', label: t('comfortConsistency.sources.driver', 'Driver setpoint'), count: source.driverSetpointRows },
              { id: 'passenger', label: t('comfortConsistency.sources.passenger', 'Passenger setpoint'), count: source.passengerSetpointRows },
              { id: 'any-target', label: t('comfortConsistency.sources.anyTarget', 'Any front-row setpoint'), count: source.anySetpointRows },
              { id: 'paired', label: t('comfortConsistency.sources.paired', 'Paired front-row setpoints'), count: source.pairedSetpointRows },
              { id: 'known-hvac', label: t('comfortConsistency.sources.knownHvac', 'Known HVAC state'), count: source.knownHvacRows },
              { id: 'active-hvac', label: t('comfortConsistency.sources.activeHvac', 'Observed active HVAC'), count: source.activeHvacRows },
              { id: 'complete', label: t('comfortConsistency.sources.complete', 'Thermally complete rows'), count: source.thermallyCompleteRows,
                note: t('comfortConsistency.sources.completeHint', 'Cabin temperature plus at least one setpoint') },
            ]}
          />
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
