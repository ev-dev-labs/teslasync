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
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencyExactAccountingProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
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
            ? t('comfortConsistency.accounting.balanced', 'Balances')
            : t('comfortConsistency.accounting.mismatch', 'Mismatch')}
        </Badge>
      </div>
      <Text as="p" variant="bodySm" className="mt-2">{equation}</Text>
    </div>
  );
}

export function ComfortConsistencyExactAccounting({
  summary,
  state,
  formatDuration,
}: ComfortConsistencyExactAccountingProps) {
  const { t } = useTranslation();
  const rows = summary.rows;
  const intervals = summary.intervals;
  const composition = summary.intervalComposition;
  const boundaries = [
    [t('comfortConsistency.accounting.dataset', 'Dataset edge'), summary.boundaryAccounting.datasetEdges],
    [t('comfortConsistency.accounting.inactive', 'HVAC inactive'), summary.boundaryAccounting.hvacInactiveBoundaries],
    [t('comfortConsistency.accounting.missing', 'Missing evidence'), summary.boundaryAccounting.missingEvidenceBoundaries],
    [t('comfortConsistency.accounting.gap', 'Long gap'), summary.boundaryAccounting.longGapBoundaries],
    [t('comfortConsistency.accounting.target', 'Target shift'), summary.boundaryAccounting.targetShiftBoundaries],
  ] as const;

  return (
    <section data-testid="comfort-consistency-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.accounting.title', 'Exact source, interval, and window accounting')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.accounting.subtitle',
            'Independent identities keep returned rows, timestamps, intervals, duration, fragments, and stabilization outcomes distinct.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <Grid cols={{ default: 1, xl: 2 }} gap={3}>
            <Identity
              label={t('comfortConsistency.accounting.rowIdentity', 'Returned-row identity')}
              equation={t(
                'comfortConsistency.accounting.rowEquation',
                '{{returned}} rows = {{invalid}} invalid + {{missingTime}} missing time + {{badTime}} bad time + {{duplicates}} duplicates + {{unknown}} unknown HVAC + {{off}} inactive + {{cabin}} no cabin + {{target}} no target + {{analyzed}} analyzed.',
                {
                  returned: fmtInt(rows.returnedRows),
                  invalid: fmtInt(rows.invalidRowRows),
                  missingTime: fmtInt(rows.missingTimestampRows),
                  badTime: fmtInt(rows.invalidTimestampRows),
                  duplicates: fmtInt(rows.duplicateTimestampRows),
                  unknown: fmtInt(rows.unknownHvacRows),
                  off: fmtInt(rows.hvacOffRows),
                  cabin: fmtInt(rows.missingInsideTempRows),
                  target: fmtInt(rows.missingSetpointRows),
                  analyzed: fmtInt(rows.analyzedRows),
                },
              )}
              balanced={summary.identities.rowsBalanced}
            />
            <Identity
              label={t('comfortConsistency.accounting.timestampIdentity', 'Timestamp identity')}
              equation={t(
                'comfortConsistency.accounting.timestampEquation',
                '{{valid}} timestamp-valid rows = {{unique}} unique + {{duplicates}} duplicates.',
                {
                  valid: fmtInt(rows.timestampValidRows),
                  unique: fmtInt(rows.uniqueTimestampRows),
                  duplicates: fmtInt(rows.duplicateTimestampRows),
                },
              )}
              balanced={summary.identities.timestampsBalanced}
            />
            <Identity
              label={t('comfortConsistency.accounting.timelineIdentity', 'Timeline identity')}
              equation={t(
                'comfortConsistency.accounting.timelineEquation',
                '{{unique}} unique timestamps = {{pairs}} adjacent pairs + {{terminal}} terminal sample.',
                {
                  unique: fmtInt(rows.uniqueTimestampRows),
                  pairs: fmtInt(intervals.candidateAdjacentPairs),
                  terminal: fmtInt(intervals.terminalSamples),
                },
              )}
              balanced={summary.identities.timelineBalanced}
            />
            <Identity
              label={t('comfortConsistency.accounting.intervalIdentity', 'Pair-disposition identity')}
              equation={t(
                'comfortConsistency.accounting.intervalEquation',
                '{{pairs}} pairs = {{observed}} observed + {{gaps}} gaps + {{inactive}} inactive + {{barriers}} barriers + {{nonpositive}} nonpositive.',
                {
                  pairs: fmtInt(intervals.candidateAdjacentPairs),
                  observed: fmtInt(intervals.observedActiveIntervals),
                  gaps: fmtInt(intervals.longGapExclusions),
                  inactive: fmtInt(intervals.inactiveStartIntervals),
                  barriers: fmtInt(intervals.evidenceBarrierIntervals),
                  nonpositive: fmtInt(intervals.nonpositiveIntervals),
                },
              )}
              balanced={summary.identities.intervalsBalanced}
            />
            <Identity
              label={t('comfortConsistency.accounting.durationIdentity', 'Observed-duration identity')}
              equation={t(
                'comfortConsistency.accounting.durationEquation',
                '{{total}} observed = {{below}} below + {{within}} within + {{above}} above.',
                {
                  total: formatDuration(composition.observedActiveS, { precision: 2 }),
                  below: formatDuration(composition.belowBandS, { precision: 2 }),
                  within: formatDuration(composition.withinBandS, { precision: 2 }),
                  above: formatDuration(composition.aboveBandS, { precision: 2 }),
                },
              )}
              balanced={summary.identities.intervalDurationBalanced}
            />
            <Identity
              label={t('comfortConsistency.accounting.fragmentIdentity', 'Active-fragment identity')}
              equation={t(
                'comfortConsistency.accounting.fragmentEquation',
                '{{runs}} active fragments = {{inBand}} in-band-first + {{outside}} outside-band-first.',
                {
                  runs: fmtInt(summary.activeRunCount),
                  inBand: fmtInt(summary.insideBandStartRuns),
                  outside: fmtInt(summary.stabilizationWindows.length),
                },
              )}
              balanced={summary.identities.activeFragmentsBalanced}
            />
            <Identity
              label={t('comfortConsistency.accounting.windowIdentity', 'Window-outcome identity')}
              equation={t(
                'comfortConsistency.accounting.windowEquation',
                '{{windows}} outside-band fragments = {{stabilized}} sustained-band observed + {{notObserved}} not observed stabilized.',
                {
                  windows: fmtInt(summary.stabilizationWindows.length),
                  stabilized: fmtInt(summary.stabilizedWindows),
                  notObserved: fmtInt(summary.unstabilizedWindows),
                },
              )}
              balanced={summary.identities.windowOutcomesBalanced}
            />
          </Grid>
          <Text as="h4" variant="label" className="mb-3 mt-5">
            {t('comfortConsistency.accounting.boundaries', 'Active-fragment boundary counts')}
          </Text>
          <Grid cols={{ default: 2, md: 5 }} gap={3}>
            {boundaries.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1">{fmtInt(value)}</MetricValue>
              </div>
            ))}
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
