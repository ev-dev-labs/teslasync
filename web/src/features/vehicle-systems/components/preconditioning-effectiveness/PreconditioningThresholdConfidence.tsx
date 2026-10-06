import { ShieldQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import { Badge, MetricLabel, MetricValue, Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

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
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const threshold = summary.thresholds;
  const gates = [
    [t('preconditioningEffectiveness.thresholds.window', 'Pre-drive window'), formatDuration(threshold.preDriveWindowS), summary.driveRows.uniqueValidDrives],
    [t('preconditioningEffectiveness.thresholds.initial', 'Minimum initial gap'), formatDelta(threshold.minInitialDeltaC), summary.departureAccounting.initialInBand],
    [t('preconditioningEffectiveness.thresholds.samples', 'Minimum distinct cabin states'), fmtInt(threshold.minThermalSamples), summary.departureAccounting.insufficientThermalSamples],
    [t('preconditioningEffectiveness.thresholds.span', 'Minimum observation span'), formatDuration(threshold.minObservationSpanS), summary.departureAccounting.insufficientObservationSpan],
    [t('preconditioningEffectiveness.thresholds.age', 'Maximum final-state age'), formatDuration(threshold.maxDepartureSampleAgeS), summary.departureAccounting.staleDepartureSample],
    [t('preconditioningEffectiveness.thresholds.target', 'Maximum target shift'), formatDelta(threshold.maxTargetShiftC), summary.departureAccounting.targetShiftExclusions],
    [t('preconditioningEffectiveness.thresholds.cap', 'Directory display cap'), fmtInt(threshold.directoryLimit), summary.directory.omitted],
  ] as const;
  const comparison = summary.overall;
  const confidence = [
    [t('preconditioningEffectiveness.thresholds.balanceCount', 'Balanced-pair support'), comparison.balanceCount, 'count'],
    [t('preconditioningEffectiveness.thresholds.volumeCount', 'Classified volume'), comparison.volumeCount, 'count'],
    [t('preconditioningEffectiveness.thresholds.balanceConfidence', 'Balance confidence'), comparison.balanceConfidence * 100, 'percent'],
    [t('preconditioningEffectiveness.thresholds.volumeConfidence', 'Volume confidence'), comparison.volumeConfidence * 100, 'percent'],
    [t('preconditioningEffectiveness.thresholds.combinedConfidence', 'Combined confidence'), comparison.evidence !== 'none' ? comparison.confidence * 100 : null, 'percent'],
  ] as const;

  return (
    <section data-testid="preconditioning-threshold-confidence">
      <LayoutCard title={t('preconditioningEffectiveness.thresholds.title', 'Threshold and confidence matrix')}>
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
          <VehicleOperationalBrief embedded id="preconditioning-confidence-summary"
            title={t('preconditioningEffectiveness.thresholds.confidenceTitle', 'Overall comparison support')}
            retained={Boolean(state.climate.refreshError) || Boolean(state.drives.refreshError)
              || state.climate.isPaused || state.drives.isPaused}
            period={{ kind: 'unknown', label: t('preconditioningEffectiveness.coverage.title', 'Source and temporal coverage'),
              reason: t('preconditioningEffectiveness.thresholds.confidenceMethod', 'Confidence is descriptive support, not statistical significance: balance confidence times volume confidence over strata containing both groups; effects are withheld without within-stratum overlap.') }}
            metrics={confidence.map(([label, rawValue, metricId], index) => ({
              metricId, occurrenceId: `confidence-${index}`, label, rawValue,
              display: { formatter: raw => ({ value: metricId === 'count' ? fmtInt(raw) : fmtPercent(raw), unit: '' }) },
            }))}
          />
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'preconditioningEffectiveness.thresholds.confidenceMethod',
              'Confidence is descriptive support, not statistical significance: balance confidence times volume confidence over strata containing both groups; effects are withheld without within-stratum overlap.',
            )}
          </Text>
        </PreconditioningSectionBody>
      </LayoutCard>
    </section>
  );
}
