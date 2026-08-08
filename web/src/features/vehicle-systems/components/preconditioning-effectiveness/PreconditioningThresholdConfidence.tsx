import { ShieldQuestion, SlidersHorizontal } from 'lucide-react';
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
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import {
  preconditioningEvidenceLabel,
  preconditioningEvidenceVariant,
} from './labels';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface PreconditioningThresholdConfidenceProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningThresholdConfidence({
  summary,
  state,
  formatDuration,
  formatDelta,
}: PreconditioningThresholdConfidenceProps) {
  const { t } = useTranslation();
  const threshold = summary.thresholds;
  const gates = [
    [t('preconditioningEffectiveness.thresholds.window', 'Pre-drive window'), formatDuration(threshold.preDriveWindowS, { precision: 2 }), summary.driveRows.uniqueValidDrives],
    [t('preconditioningEffectiveness.thresholds.initial', 'Minimum initial gap'), formatDelta(threshold.minInitialDeltaC), summary.departureAccounting.initialInBand],
    [t('preconditioningEffectiveness.thresholds.samples', 'Minimum thermal samples'), fmtInt(threshold.minThermalSamples), summary.departureAccounting.insufficientThermalSamples],
    [t('preconditioningEffectiveness.thresholds.span', 'Minimum observation span'), formatDuration(threshold.minObservationSpanS, { precision: 2 }), summary.departureAccounting.insufficientObservationSpan],
    [t('preconditioningEffectiveness.thresholds.age', 'Maximum final-sample age'), formatDuration(threshold.maxDepartureSampleAgeS, { precision: 2 }), summary.departureAccounting.staleDepartureSample],
    [t('preconditioningEffectiveness.thresholds.target', 'Maximum target shift'), formatDelta(threshold.maxTargetShiftC), summary.departureAccounting.targetShiftExclusions],
    [t('preconditioningEffectiveness.thresholds.cap', 'Directory display cap'), fmtInt(threshold.directoryLimit), summary.directory.omitted],
  ] as const;
  const comparison = summary.overall;
  const confidence = [
    [t('preconditioningEffectiveness.thresholds.balanceCount', 'Balanced-pair support'), fmtInt(comparison.balanceCount)],
    [t('preconditioningEffectiveness.thresholds.volumeCount', 'Classified volume'), fmtInt(comparison.volumeCount)],
    [t('preconditioningEffectiveness.thresholds.balanceConfidence', 'Balance confidence'), fmtPercent(comparison.balanceConfidence * 100, 0)],
    [t('preconditioningEffectiveness.thresholds.volumeConfidence', 'Volume confidence'), fmtPercent(comparison.volumeConfidence * 100, 0)],
    [t('preconditioningEffectiveness.thresholds.combinedConfidence', 'Combined confidence'), comparison.evidence !== 'none' ? fmtPercent(comparison.confidence * 100, 0) : '—'],
  ] as const;

  return (
    <section data-testid="preconditioning-threshold-confidence">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.thresholds.title',
            'Threshold and confidence matrix',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.thresholds.subtitle',
            'All qualification cutoffs and the multiplicative balance-by-volume confidence calculation are disclosed.',
          )}
        </Text>
        <PreconditioningSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 4, xl: 7 }} gap={3}>
            {gates.map(([label, value, affected]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1">{value}</MetricValue>
                <Text as="p" variant="caption" className="mt-1">
                  {t(
                    'preconditioningEffectiveness.thresholds.affected',
                    '{{count}} applicable or excluded',
                    { count: affected },
                  )}
                </Text>
              </div>
            ))}
          </Grid>
          <div className="mb-3 mt-5 flex flex-wrap items-center justify-between gap-2">
            <Text as="h4" variant="label" className="flex items-center gap-2">
              <ShieldQuestion className="h-4 w-4" aria-hidden="true" />
              {t(
                'preconditioningEffectiveness.thresholds.confidenceTitle',
                'Overall comparison support',
              )}
            </Text>
            <Badge variant={preconditioningEvidenceVariant(comparison.evidence)}>
              {preconditioningEvidenceLabel(t, comparison.evidence)}
            </Badge>
          </div>
          <Grid cols={{ default: 2, md: 5 }} gap={3}>
            {confidence.map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--border-subtle)] p-3"
              >
                <MetricLabel>{label}</MetricLabel>
                <MetricValue className="mt-1">{value}</MetricValue>
              </div>
            ))}
          </Grid>
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'preconditioningEffectiveness.thresholds.confidenceMethod',
              'Confidence is descriptive support, not statistical significance: balance confidence times volume confidence, with comparative effects withheld when either group count is zero.',
            )}
          </Text>
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
