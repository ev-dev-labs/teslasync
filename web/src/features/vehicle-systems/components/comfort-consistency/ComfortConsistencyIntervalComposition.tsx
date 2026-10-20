import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ComfortConsistencyIntervalCompositionProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function ComfortConsistencyIntervalComposition({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyIntervalCompositionProps) {
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const intervals = summary.intervals;
  const composition = summary.intervalComposition;

  return (
    <section data-testid="comfort-consistency-interval-composition">
      <LayoutCard title={t('comfortConsistency.intervals.title', 'Active interval comfort composition')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.intervals.subtitle',
            'Duration weighting uses the state at each qualified interval start and does not bridge long gaps or missing evidence.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="intervals"
        >
          <VehicleOperationalBrief embedded id="comfort-consistency-interval-summary"
            title={t('comfortConsistency.intervals.title', 'Active interval comfort composition')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.intervals.subtitle', 'Duration weighting uses the state at each qualified interval start and does not bridge long gaps or missing evidence.') }}
            metrics={[
              ...[
                { key: 'observed', label: t('comfortConsistency.intervals.observed', 'Observed active duration'), value: composition.observedActiveS },
                { key: 'within', label: t('comfortConsistency.intervals.within', 'Within-band duration'), value: composition.withinBandS },
                { key: 'above', label: t('comfortConsistency.intervals.above', 'Above-target duration'), value: composition.aboveBandS },
                { key: 'below', label: t('comfortConsistency.intervals.below', 'Below-target duration'), value: composition.belowBandS },
              ].map(fact => ({
                metricId: 'duration' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: formatDuration(raw), unit: '' }) },
              })),
              { metricId: 'percent', occurrenceId: 'share', label: t('comfortConsistency.intervals.share', 'Duration within band'), rawValue: composition.withinBandShare != null ? composition.withinBandShare * 100 : null, display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
              { metricId: 'number', occurrenceId: 'deviation', label: t('comfortConsistency.intervals.weightedDeviation', 'Weighted mean deviation'), rawValue: composition.durationWeightedMeanAbsDeviationC, display: { formatter: raw => ({ value: formatDelta(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'support', label: t('comfortConsistency.intervals.support', 'Observed / candidate pairs'), rawValue: intervals.observedActiveIntervals,
                display: { formatter: raw => ({ value: t('comfortConsistency.intervals.pair', '{{observed}} / {{candidate}}', { observed: fmtInt(raw), candidate: fmtInt(intervals.candidateAdjacentPairs) }), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'excluded', label: t('comfortConsistency.intervals.excluded', 'Gap / inactive / barrier'), rawValue: intervals.longGapExclusions,
                display: { formatter: raw => ({ value: t('comfortConsistency.intervals.exclusionPair', '{{gap}} / {{inactive}} / {{barrier}}', { gap: fmtInt(raw), inactive: fmtInt(intervals.inactiveStartIntervals), barrier: fmtInt(intervals.evidenceBarrierIntervals) }), unit: '' }) } },
            ]}
          />
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
