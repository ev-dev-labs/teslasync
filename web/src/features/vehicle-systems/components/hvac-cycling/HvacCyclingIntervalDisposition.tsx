import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingIntervalDispositionProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

export function HvacCyclingIntervalDisposition({
  summary,
  state,
}: HvacCyclingIntervalDispositionProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const interval = summary.intervals;

  return (
    <section data-testid="hvac-cycling-interval-disposition">
      <LayoutCard title={t('hvacCycling.intervals.title', 'Interval disposition')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.intervals.subtitle',
            'Every adjacent unique-timestamp pair receives one outcome before runs are formed.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <VehicleOperationalBrief embedded id="hvac-cycling-interval-summary"
            title={t('hvacCycling.intervals.title', 'Interval disposition')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('hvacCycling.intervals.subtitle', 'Every adjacent unique-timestamp pair receives one outcome before runs are formed.') }}
            metrics={[
              { key: 'candidates', label: t('hvacCycling.intervals.candidates', 'Candidate adjacent pairs'), value: interval.candidateAdjacentPairs },
              { key: 'observed', label: t('hvacCycling.intervals.observed', 'Observed intervals'), value: interval.observedIntervals },
              { key: 'gaps', label: t('hvacCycling.intervals.longGap', 'Long-gap exclusions'), value: interval.longGapExclusions },
              { key: 'unknown', label: t('hvacCycling.intervals.unknown', 'Unknown-state barriers'), value: interval.unknownStateBarriers },
              { key: 'nonpositive', label: t('hvacCycling.intervals.nonpositive', 'Nonpositive pairs'), value: interval.nonpositiveIntervals },
              { key: 'duplicates', label: t('hvacCycling.intervals.duplicates', 'Duplicates removed first'), value: interval.duplicatesRemovedBeforePairing },
              { key: 'terminal', label: t('hvacCycling.intervals.terminal', 'Terminal samples'), value: interval.terminalSamples },
              { key: 'runs', label: t('hvacCycling.intervals.runIntervals', 'Intervals represented in runs'), value: summary.runs.reduce((sum, run) => sum + run.intervals, 0) },
            ].map(fact => ({
              metricId: 'count' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
              display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
            }))}
          />
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'hvacCycling.intervals.identity',
              '{{pairs}} pairs = {{observed}} observed + {{gaps}} long gaps + {{unknown}} unknown barriers + {{nonpositive}} nonpositive.',
              {
                pairs: fmtInt(interval.candidateAdjacentPairs),
                observed: fmtInt(interval.observedIntervals),
                gaps: fmtInt(interval.longGapExclusions),
                unknown: fmtInt(interval.unknownStateBarriers),
                nonpositive: fmtInt(interval.nonpositiveIntervals),
              },
            )}
          </Text>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
