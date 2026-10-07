import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
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

interface HvacCyclingExactAccountingProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

function Identity({
  label,
  equation,
  balanced,
}: {
  label: string;
  equation: string;
  balanced: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <MetricLabel>{label}</MetricLabel>
        <Badge variant={balanced ? 'success' : 'danger'}>
          {balanced
            ? t('hvacCycling.accounting.balanced', 'Balances')
            : t('hvacCycling.accounting.mismatch', 'Mismatch')}
        </Badge>
      </div>
      <Text as="p" variant="bodySm" className="mt-2">{equation}</Text>
    </div>
  );
}

export function HvacCyclingExactAccounting({
  summary,
  state,
}: HvacCyclingExactAccountingProps) {
  const { t } = useTranslation();
  const row = summary.rows;
  const interval = summary.intervals;
  const runIntervals = summary.runs.reduce(
    (sum, run) => sum + run.intervals,
    0,
  );
  const outcomes = [
    [t('hvacCycling.accounting.known', 'Valid known-state row'), row.validKnownStateRows],
    [t('hvacCycling.accounting.missing', 'Missing timestamp'), row.missingTimestampRows],
    [t('hvacCycling.accounting.invalid', 'Invalid timestamp or type'), row.invalidTimestampRows],
    [t('hvacCycling.accounting.duplicate', 'Duplicate timestamp'), row.duplicateTimestampRows],
    [t('hvacCycling.accounting.unknown', 'Valid timestamp, unknown state'), row.uninterpretableStateRows],
  ] as const;

  return (
    <section data-testid="hvac-cycling-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.accounting.title', 'Exact source and interval accounting')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.accounting.subtitle',
            'Mutually exclusive row outcomes and pair dispositions keep source rows, samples, intervals, and runs distinct.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 1, xl: 2 }} gap={3}>
            <Identity
              label={t('hvacCycling.accounting.rowIdentity', 'Returned-row identity')}
              equation={t(
                'hvacCycling.accounting.rowEquation',
                '{{returned}} = {{known}} known + {{missing}} missing + {{invalid}} invalid + {{duplicate}} duplicate + {{unknown}} unknown.',
                {
                  returned: fmtInt(row.returnedRows),
                  known: fmtInt(row.validKnownStateRows),
                  missing: fmtInt(row.missingTimestampRows),
                  invalid: fmtInt(row.invalidTimestampRows),
                  duplicate: fmtInt(row.duplicateTimestampRows),
                  unknown: fmtInt(row.uninterpretableStateRows),
                },
              )}
              balanced={summary.identities.rowsBalanced}
            />
            <Identity
              label={t('hvacCycling.accounting.timelineIdentity', 'Timeline identity')}
              equation={t(
                'hvacCycling.accounting.timelineEquation',
                '{{unique}} unique timestamps = {{pairs}} adjacent pairs + {{terminal}} terminal sample.',
                {
                  unique: fmtInt(row.uniqueTimestampRows),
                  pairs: fmtInt(interval.candidateAdjacentPairs),
                  terminal: fmtInt(interval.terminalSamples),
                },
              )}
              balanced={summary.identities.timelineBalanced}
            />
            <Identity
              label={t('hvacCycling.accounting.intervalIdentity', 'Pair-disposition identity')}
              equation={t(
                'hvacCycling.accounting.intervalEquation',
                '{{pairs}} = {{observed}} observed + {{gaps}} gaps + {{barriers}} barriers + {{nonpositive}} nonpositive.',
                {
                  pairs: fmtInt(interval.candidateAdjacentPairs),
                  observed: fmtInt(interval.observedIntervals),
                  gaps: fmtInt(interval.longGapExclusions),
                  barriers: fmtInt(interval.unknownStateBarriers),
                  nonpositive: fmtInt(interval.nonpositiveIntervals),
                },
              )}
              balanced={summary.identities.intervalsBalanced}
            />
            <Identity
              label={t('hvacCycling.accounting.runIdentity', 'Run-support identity')}
              equation={t(
                'hvacCycling.accounting.runEquation',
                '{{observed}} observed intervals = {{represented}} run intervals; observed duration also balances.',
                {
                  observed: fmtInt(interval.observedIntervals),
                  represented: fmtInt(runIntervals),
                },
              )}
              balanced={
                summary.identities.runIntervalsBalanced
                && summary.identities.observedDurationBalanced
              }
            />
          </Grid>
          <Text as="h4" variant="label" className="mb-3 mt-5">
            {t('hvacCycling.accounting.outcomes', 'Mutually exclusive returned-row outcomes')}
          </Text>
          <Grid cols={{ default: 2, md: 5 }} gap={3}>
            {outcomes.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1">{fmtInt(value)}</MetricValue>
              </div>
            ))}
          </Grid>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
