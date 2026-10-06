import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import {
  Badge,
  Text,
} from '@/components/ui';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

interface ComfortConsistencyDataAvailabilityProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
}

interface Availability {
  key: string;
  label: string;
  available: boolean;
  support: number | null;
}

export function ComfortConsistencyDataAvailability({
  summary,
  state,
}: ComfortConsistencyDataAvailabilityProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const items: Availability[] = [
    {
      key: 'rows',
      label: t('comfortConsistency.availability.rows', 'Endpoint rows'),
      available: summary.rows.returnedRows > 0,
      support: summary.rows.returnedRows,
    },
    {
      key: 'timestamps',
      label: t('comfortConsistency.availability.timestamps', 'Chronological timeline'),
      available: summary.rows.uniqueTimestampRows > 0,
      support: summary.rows.uniqueTimestampRows,
    },
    {
      key: 'thermal',
      label: t('comfortConsistency.availability.thermal', 'Thermally complete rows'),
      available: summary.sources.thermallyCompleteRows > 0,
      support: summary.sources.thermallyCompleteRows,
    },
    {
      key: 'samples',
      label: t('comfortConsistency.availability.samples', 'Active sample metrics'),
      available: summary.analyzedSamples > 0,
      support: summary.analyzedSamples,
    },
    {
      key: 'intervals',
      label: t('comfortConsistency.availability.intervals', 'Duration-weighted metrics'),
      available: summary.intervals.observedActiveIntervals > 0,
      support: summary.intervals.observedActiveIntervals,
    },
    {
      key: 'agreement',
      label: t('comfortConsistency.availability.agreement', 'Setpoint agreement'),
      available: summary.meanSetpointDisagreementC != null,
      support: summary.pairedSetpointAnalyzedSamples,
    },
    {
      key: 'windows',
      label: t('comfortConsistency.availability.windows', 'Stabilization windows'),
      available: summary.stabilizationWindows.length > 0,
      support: summary.stabilizationWindows.length,
    },
    {
      key: 'score',
      label: t('comfortConsistency.availability.score', 'Adjusted consistency score'),
      available: summary.consistencyScore != null,
      support: summary.consistencyScore,
    },
  ];

  return (
    <section data-testid="comfort-consistency-availability">
      <LayoutCard title={t('comfortConsistency.availability.title', 'Data-availability matrix')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.availability.subtitle',
            'Each analytical layer is published only when its own evidence gate is met.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <VehicleOperationalBrief embedded id="comfort-consistency-availability-summary"
            title={t('comfortConsistency.availability.title', 'Data-availability matrix')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.availability.subtitle', 'Each analytical layer is published only when its own evidence gate is met.') }}
            metrics={items.map(item => ({
              metricId: item.key === 'score' ? 'number' as const : 'count' as const,
              occurrenceId: item.key, label: item.label, rawValue: item.support,
              display: { formatter: (raw: number) => ({ value: item.key === 'score' ? String(raw) : fmtInt(raw), unit: '' }) },
              context: <Badge variant={item.available ? 'success' : 'neutral'}>
                {item.available ? t('comfortConsistency.availability.available', 'Available')
                  : t('comfortConsistency.availability.withheld', 'Withheld')}
              </Badge>,
            }))}
          />
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
