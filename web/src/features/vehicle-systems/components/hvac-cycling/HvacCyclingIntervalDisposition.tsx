import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import { MetricLabel, MetricValue, Text } from '@/components/ui';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingIntervalDispositionProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

function Disposition({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const { fmtInt } = useNumberFormatting();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <MetricValue className="mt-1">{fmtInt(value)}</MetricValue>
    </div>
  );
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
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <Disposition
              label={t('hvacCycling.intervals.candidates', 'Candidate adjacent pairs')}
              value={interval.candidateAdjacentPairs}
            />
            <Disposition
              label={t('hvacCycling.intervals.observed', 'Observed intervals')}
              value={interval.observedIntervals}
            />
            <Disposition
              label={t('hvacCycling.intervals.longGap', 'Long-gap exclusions')}
              value={interval.longGapExclusions}
            />
            <Disposition
              label={t('hvacCycling.intervals.unknown', 'Unknown-state barriers')}
              value={interval.unknownStateBarriers}
            />
            <Disposition
              label={t('hvacCycling.intervals.nonpositive', 'Nonpositive pairs')}
              value={interval.nonpositiveIntervals}
            />
            <Disposition
              label={t('hvacCycling.intervals.duplicates', 'Duplicates removed first')}
              value={interval.duplicatesRemovedBeforePairing}
            />
            <Disposition
              label={t('hvacCycling.intervals.terminal', 'Terminal samples')}
              value={interval.terminalSamples}
            />
            <Disposition
              label={t('hvacCycling.intervals.runIntervals', 'Intervals represented in runs')}
              value={summary.runs.reduce((sum, run) => sum + run.intervals, 0)}
            />
          </Grid>
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
