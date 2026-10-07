import { GitCompareArrows } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

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
  const { t } = useTranslation();
  const interval = summary.intervals;

  return (
    <section data-testid="hvac-cycling-interval-disposition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.intervals.title', 'Interval disposition')}
        </PanelTitle>
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
      </GlassPanel>
    </section>
  );
}
