import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ComfortConsistencySetpointAgreementProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

export function ComfortConsistencySetpointAgreement({
  summary,
  state,
  formatDelta,
}: ComfortConsistencySetpointAgreementProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();

  return (
    <section data-testid="comfort-consistency-setpoint-agreement">
      <LayoutCard title={t('comfortConsistency.setpoints.title', 'Front-row setpoint agreement')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.setpoints.subtitle',
            'Cabin deviation uses the mean when both front-row setpoints exist and the available side when only one exists.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="samples"
        >
          <VehicleOperationalBrief embedded id="comfort-consistency-setpoint-summary"
            title={t('comfortConsistency.setpoints.title', 'Front-row setpoint agreement')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.setpoints.note', 'Agreement statistics use only analyzed active samples with both setpoints; one-sided rows still support cabin-to-target deviation.') }}
            metrics={[
              { metricId: 'count', occurrenceId: 'paired', label: t('comfortConsistency.setpoints.paired', 'Analyzed paired-setpoint samples'), rawValue: summary.pairedSetpointAnalyzedSamples, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'single', label: t('comfortConsistency.setpoints.single', 'Analyzed one-sided samples'), rawValue: summary.singleSetpointAnalyzedSamples, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
              ...[
                { key: 'mean', label: t('comfortConsistency.setpoints.mean', 'Mean disagreement'), value: summary.meanSetpointDisagreementC },
                { key: 'median', label: t('comfortConsistency.setpoints.median', 'Median disagreement'), value: summary.medianSetpointDisagreementC },
                { key: 'p90', label: t('comfortConsistency.setpoints.p90', 'P90 disagreement'), value: summary.p90SetpointDisagreementC },
              ].map(fact => ({
                metricId: 'number' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: formatDelta(raw), unit: '' }) },
              })),
              { metricId: 'percent', occurrenceId: 'share', label: t('comfortConsistency.setpoints.overThreshold', 'Paired samples above gate'), rawValue: summary.disagreementSampleShare != null ? summary.disagreementSampleShare * 100 : null,
                display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
            ]}
          />
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'comfortConsistency.setpoints.note',
              'Agreement statistics use only analyzed active samples with both setpoints; one-sided rows still support cabin-to-target deviation.',
            )}
          </Text>
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
