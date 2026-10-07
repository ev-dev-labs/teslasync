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
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { TemperatureUnitPref } from '@/lib/unitConversion';
import type {
  CabinThermalSummary,
  CandidateRejectionReason,
} from '../../lib/cabinThermal';
import { formatTemperatureDelta } from './labels';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalThresholdMatrixProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  locale: string;
  temperatureUnit: TemperatureUnitPref;
  formatDuration: UnitFormatter;
}

interface GateCard {
  key: string;
  label: string;
  value: string;
  failures: number;
}

export function CabinThermalThresholdMatrix({
  summary,
  state,
  locale,
  temperatureUnit,
  formatDuration,
}: CabinThermalThresholdMatrixProps) {
  const { t } = useTranslation();
  const threshold = summary.thresholds;
  const rejectedAt = (reason: CandidateRejectionReason) =>
    summary.rejectionReasonCounts.find((item) => item.reason === reason)?.count ?? 0;
  const duration = (minutes: number) =>
    formatDuration(minutes * 60, { precision: 1 });
  const cards: GateCard[] = [
    {
      key: 'gap',
      label: t('cabinThermal.thresholds.maxGap', 'Continuity gap'),
      value: t('cabinThermal.thresholds.atMost', '≤ {{value}}', {
        value: duration(threshold.maxGapMin),
      }),
      failures: summary.coverage.longGapCount,
    },
    {
      key: 'samples',
      label: t('cabinThermal.thresholds.minSamples', 'Minimum samples'),
      value: t('cabinThermal.thresholds.atLeast', '≥ {{value}}', {
        value: fmtInt(threshold.minSamples),
      }),
      failures: rejectedAt('insufficient_samples'),
    },
    {
      key: 'duration',
      label: t('cabinThermal.thresholds.minDuration', 'Minimum duration'),
      value: t('cabinThermal.thresholds.atLeast', '≥ {{value}}', {
        value: duration(threshold.minDurationMin),
      }),
      failures: rejectedAt('below_minimum_duration'),
    },
    {
      key: 'delta',
      label: t('cabinThermal.thresholds.minDelta', 'Initial gap magnitude'),
      value: t('cabinThermal.thresholds.atLeast', '≥ {{value}}', {
        value: formatTemperatureDelta(threshold.minDeltaC, temperatureUnit, locale),
      }),
      failures: rejectedAt('initial_gap_below_threshold'),
    },
    {
      key: 'crossing',
      label: t('cabinThermal.thresholds.crossing', 'Ambient crossing band'),
      value: t('cabinThermal.thresholds.plusMinus', '±{{value}}', {
        value: formatTemperatureDelta(
          threshold.ambientCrossingToleranceC,
          temperatureUnit,
          locale,
        ),
      }),
      failures: rejectedAt('ambient_crossing'),
    },
    {
      key: 'regression',
      label: t('cabinThermal.thresholds.regression', 'Log-linear regression'),
      value: t('cabinThermal.thresholds.finite', 'Finite and variable'),
      failures: rejectedAt('regression_unavailable'),
    },
    {
      key: 'slope',
      label: t('cabinThermal.thresholds.slope', 'Relaxation slope'),
      value: t('cabinThermal.thresholds.lessThanSlope', '< −{{value}} / min', {
        value: fmtNumber(threshold.relaxingSlopeEpsilon, 6, locale),
      }),
      failures: rejectedAt('non_relaxing_gap'),
    },
    {
      key: 'r2',
      label: t('cabinThermal.thresholds.r2', 'Minimum R²'),
      value: t('cabinThermal.thresholds.atLeast', '≥ {{value}}', {
        value: fmtPercent(threshold.minR2 * 100, 0),
      }),
      failures: rejectedAt('r2_below_gate'),
    },
    {
      key: 'tau',
      label: t('cabinThermal.thresholds.tauRange', 'Valid τ range'),
      value: t('cabinThermal.thresholds.range', '{{min}}–{{max}}', {
        min: duration(threshold.minTauMin),
        max: duration(threshold.maxTauMin),
      }),
      failures: rejectedAt('invalid_tau'),
    },
  ];

  return (
    <section data-testid="cabin-thermal-thresholds">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.thresholds.title', 'Threshold and gate matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.thresholds.subtitle',
            'The exact deterministic thresholds used for this analysis, with split events or first-gate failures.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            {cards.map((card) => (
              <div key={card.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <MetricLabel>{card.label}</MetricLabel>
                <Text
                  as="div"
                  size="base"
                  weight="semibold"
                  color="primary"
                  className="mt-1"
                >
                  {card.value}
                </Text>
                <Text as="p" variant="caption" className="mt-1">
                  {t('cabinThermal.thresholds.affected', '{{count}} affected', {
                    count: card.failures,
                  })}
                </Text>
              </div>
            ))}
          </Grid>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
