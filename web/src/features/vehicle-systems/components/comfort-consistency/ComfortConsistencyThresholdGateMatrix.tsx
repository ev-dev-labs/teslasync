import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
    <div data-app-part="metric" data-app-metric="tile" data-surface-variant="standalone" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel data-app-part="metric-label">{label}</MetricLabel>
      <div data-app-part="metric-reading" className="mt-1">
        <Text data-app-part="metric-value" as="p" variant="bodySm">{value}</Text>
      </div>
      <Text data-app-part="metric-context" as="p" variant="caption" className="mt-1">
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
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const thresholds = summary.thresholds;

  return (
    <section data-testid="comfort-consistency-thresholds">
      <LayoutCard title={t('comfortConsistency.thresholds.title', 'Threshold and gate matrix')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.thresholds.subtitle',
            'Every analytical cutoff and its observed impact is explicit.',
          )}
        </Text>
        <ComfortConsistencySectionBody summary={summary} state={state}>
          <div data-app-part="metric-grid" className="grid min-w-0 grid-cols-2 items-stretch gap-3 xl:grid-cols-4 [&>*]:min-w-0">
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
                value: formatDuration(thresholds.maxGapS),
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
          </div>
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
