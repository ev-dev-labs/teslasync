import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyIntervalCompositionProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

function IntervalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
    </div>
  );
}

export function ComfortConsistencyIntervalComposition({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyIntervalCompositionProps) {
  const { t } = useTranslation();
  const intervals = summary.intervals;
  const composition = summary.intervalComposition;

  return (
    <section data-testid="comfort-consistency-interval-composition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.intervals.title', 'Active interval comfort composition')}
        </PanelTitle>
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
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <IntervalMetric
              label={t('comfortConsistency.intervals.observed', 'Observed active duration')}
              value={formatDuration(composition.observedActiveS, { precision: 1 })}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.within', 'Within-band duration')}
              value={formatDuration(composition.withinBandS, { precision: 1 })}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.above', 'Above-target duration')}
              value={formatDuration(composition.aboveBandS, { precision: 1 })}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.below', 'Below-target duration')}
              value={formatDuration(composition.belowBandS, { precision: 1 })}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.share', 'Duration within band')}
              value={composition.withinBandShare != null
                ? fmtPercent(composition.withinBandShare * 100, 1)
                : '—'}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.weightedDeviation', 'Weighted mean deviation')}
              value={formatDelta(composition.durationWeightedMeanAbsDeviationC)}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.support', 'Observed / candidate pairs')}
              value={t(
                'comfortConsistency.intervals.pair',
                '{{observed}} / {{candidate}}',
                {
                  observed: fmtInt(intervals.observedActiveIntervals),
                  candidate: fmtInt(intervals.candidateAdjacentPairs),
                },
              )}
            />
            <IntervalMetric
              label={t('comfortConsistency.intervals.excluded', 'Gap / inactive / barrier')}
              value={t(
                'comfortConsistency.intervals.exclusionPair',
                '{{gap}} / {{inactive}} / {{barrier}}',
                {
                  gap: fmtInt(intervals.longGapExclusions),
                  inactive: fmtInt(intervals.inactiveStartIntervals),
                  barrier: fmtInt(intervals.evidenceBarrierIntervals),
                },
              )}
            />
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
