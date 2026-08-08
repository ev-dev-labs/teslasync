import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyThresholdGateMatrixProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

function Gate({
  label,
  value,
  affected,
}: {
  label: string;
  value: string;
  affected: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" className="mt-1">{value}</Text>
      <Text as="p" variant="caption" className="mt-1">
        {t('comfortConsistency.thresholds.affected', '{{count}} affected', {
          count: affected,
        })}
      </Text>
    </div>
  );
}

export function ComfortConsistencyThresholdGateMatrix({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyThresholdGateMatrixProps) {
  const { t } = useTranslation();
  const thresholds = summary.thresholds;

  return (
    <section data-testid="comfort-consistency-thresholds">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.thresholds.title', 'Threshold and gate matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.thresholds.subtitle',
            'Every analytical cutoff and its observed impact is explicit.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <Gate
              label={t('comfortConsistency.thresholds.band', 'Comfort band')}
              value={t('comfortConsistency.thresholds.plusMinus', '+/- {{value}}', {
                value: formatDelta(thresholds.comfortBandC),
              })}
              affected={summary.analyzedSamples}
            />
            <Gate
              label={t('comfortConsistency.thresholds.maxGap', 'Maximum interval gap')}
              value={t('comfortConsistency.thresholds.atMost', '<= {{value}}', {
                value: formatDuration(thresholds.maxGapS, { precision: 2 }),
              })}
              affected={summary.intervals.longGapExclusions}
            />
            <Gate
              label={t('comfortConsistency.thresholds.sustain', 'Sustained-band samples')}
              value={fmtInt(thresholds.sustainSamples)}
              affected={summary.stabilizationWindows.length}
            />
            <Gate
              label={t('comfortConsistency.thresholds.targetShift', 'Material target shift')}
              value={t('comfortConsistency.thresholds.over', '> {{value}}', {
                value: formatDelta(thresholds.maxTargetShiftC),
              })}
              affected={summary.boundaryAccounting.targetShiftBoundaries / 2}
            />
            <Gate
              label={t('comfortConsistency.thresholds.disagreement', 'Setpoint disagreement gate')}
              value={t('comfortConsistency.thresholds.over', '> {{value}}', {
                value: formatDelta(thresholds.setpointDisagreementC),
              })}
              affected={
                summary.disagreementSampleShare != null
                  ? Math.round(
                      summary.disagreementSampleShare
                      * summary.pairedSetpointAnalyzedSamples,
                    )
                  : 0
              }
            />
            <Gate
              label={t('comfortConsistency.thresholds.hvac', 'HVAC eligibility')}
              value={t('comfortConsistency.thresholds.activeOnly', 'Observed active only')}
              affected={summary.rows.hvacOffRows + summary.rows.unknownHvacRows}
            />
            <Gate
              label={t('comfortConsistency.thresholds.duplicate', 'Duplicate timestamp policy')}
              value={t('comfortConsistency.thresholds.first', 'First returned row retained')}
              affected={summary.rows.duplicateTimestampRows}
            />
            <Gate
              label={t('comfortConsistency.thresholds.directory', 'Window display cap')}
              value={fmtInt(thresholds.windowDisplayLimit)}
              affected={summary.windowDirectory.omitted}
            />
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
