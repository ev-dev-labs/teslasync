import type { TFunction } from 'i18next';

import { convertTempFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { TemperatureUnitPref } from '@/lib/unitConversion';
import type {
  AcceptanceFunnelStage,
  CabinRowExclusionReason,
  CandidateRejectionReason,
  ThermalDirection,
} from '../../lib/cabinThermal';

export function cabinRejectionLabel(
  t: TFunction,
  reason: CandidateRejectionReason,
): string {
  switch (reason) {
    case 'insufficient_samples':
      return t('cabinThermal.reasons.insufficientSamples', 'Insufficient samples');
    case 'below_minimum_duration':
      return t('cabinThermal.reasons.shortDuration', 'Below minimum duration');
    case 'initial_gap_below_threshold':
      return t('cabinThermal.reasons.smallInitialGap', 'Initial gap below threshold');
    case 'ambient_crossing':
      return t('cabinThermal.reasons.ambientCrossing', 'Ambient crossing');
    case 'regression_unavailable':
      return t('cabinThermal.reasons.regressionUnavailable', 'Regression unavailable');
    case 'non_relaxing_gap':
      return t(
        'cabinThermal.reasons.nonRelaxing',
        'Non-relaxing or widening gap (solar/HVAC-like)',
      );
    case 'r2_below_gate':
      return t('cabinThermal.reasons.lowR2', 'R² below gate');
    case 'invalid_tau':
      return t('cabinThermal.reasons.invalidTau', 'Invalid τ');
  }
}

export function cabinRowExclusionLabel(
  t: TFunction,
  reason: CabinRowExclusionReason,
): string {
  switch (reason) {
    case 'missing_timestamp':
      return t('cabinThermal.rows.missingTimestamp', 'Missing timestamp');
    case 'invalid_timestamp':
      return t('cabinThermal.rows.invalidTimestamp', 'Invalid timestamp');
    case 'missing_inside_temperature':
      return t('cabinThermal.rows.missingInside', 'Missing inside temperature');
    case 'nonfinite_inside_temperature':
      return t('cabinThermal.rows.nonfiniteInside', 'Nonfinite inside temperature');
    case 'missing_outside_temperature':
      return t('cabinThermal.rows.missingOutside', 'Missing outside temperature');
    case 'nonfinite_outside_temperature':
      return t('cabinThermal.rows.nonfiniteOutside', 'Nonfinite outside temperature');
    case 'duplicate_timestamp':
      return t('cabinThermal.rows.duplicate', 'Duplicate timestamp');
  }
}

export function cabinFunnelLabel(
  t: TFunction,
  stage: AcceptanceFunnelStage,
): string {
  switch (stage) {
    case 'candidates':
      return t('cabinThermal.funnel.candidates', 'Candidate windows');
    case 'sample_gate':
      return t('cabinThermal.funnel.sampleGate', 'Passed sample gate');
    case 'duration_gate':
      return t('cabinThermal.funnel.durationGate', 'Passed duration gate');
    case 'initial_gap_gate':
      return t('cabinThermal.funnel.gapGate', 'Passed initial-gap gate');
    case 'crossing_gate':
      return t('cabinThermal.funnel.crossingGate', 'Stayed on one side');
    case 'regression_gate':
      return t('cabinThermal.funnel.regressionGate', 'Regression available');
    case 'relaxation_gate':
      return t('cabinThermal.funnel.relaxationGate', 'Relaxing toward ambient');
    case 'r2_gate':
      return t('cabinThermal.funnel.r2Gate', 'Passed R² gate');
    case 'tau_gate':
      return t('cabinThermal.funnel.tauGate', 'Accepted fit');
  }
}

export function cabinDirectionLabel(
  t: TFunction,
  direction: ThermalDirection,
): string {
  switch (direction) {
    case 'cooling':
      return t('cabinThermal.direction.cooling', 'Cooling');
    case 'warming':
      return t('cabinThermal.direction.warming', 'Warming');
    case 'indeterminate':
      return t('cabinThermal.direction.indeterminate', 'Indeterminate');
  }
}

/** Temperature differences convert without Fahrenheit's absolute offset. */
export function formatTemperatureDelta(
  deltaC: number | null,
  unit: TemperatureUnitPref,
  locale: string,
  precision = 1,
): string {
  if (deltaC == null || !Number.isFinite(deltaC)) return '—';
  const converted =
    convertTempFromSI(deltaC, unit) - convertTempFromSI(0, unit);
  return `${fmtNumber(converted, precision, locale)}${unit}`;
}
