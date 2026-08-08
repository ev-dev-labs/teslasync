import type { TFunction } from 'i18next';

import type {
  DepartureDisposition,
  DepartureRegime,
  EvidenceLevel,
} from '../../lib/preconditioningEffectiveness';

export function preconditioningEvidenceLabel(
  t: TFunction,
  level: EvidenceLevel,
): string {
  if (level === 'strong') {
    return t(
      'preconditioningEffectiveness.evidence.strong',
      'Strong observational support',
    );
  }
  if (level === 'moderate') {
    return t(
      'preconditioningEffectiveness.evidence.moderate',
      'Moderate observational support',
    );
  }
  if (level === 'limited') {
    return t(
      'preconditioningEffectiveness.evidence.limited',
      'Low-confidence observational support',
    );
  }
  return t(
    'preconditioningEffectiveness.evidence.none',
    'Insufficient support for comparison',
  );
}

export function preconditioningEvidenceVariant(
  level: EvidenceLevel,
): 'success' | 'info' | 'warning' | 'neutral' {
  if (level === 'strong') return 'success';
  if (level === 'moderate') return 'info';
  if (level === 'limited') return 'warning';
  return 'neutral';
}

export function preconditioningRegimeLabel(
  t: TFunction,
  regime: DepartureRegime | 'all',
): string {
  if (regime === 'hot') {
    return t('preconditioningEffectiveness.regime.hot', 'Hot-start stratum');
  }
  if (regime === 'cold') {
    return t('preconditioningEffectiveness.regime.cold', 'Cold-start stratum');
  }
  return t('preconditioningEffectiveness.regime.all', 'All classified departures');
}

export function preconditioningDispositionLabel(
  t: TFunction,
  disposition: DepartureDisposition,
): string {
  const labels: Record<DepartureDisposition, string> = {
    outside_climate_coverage: t(
      'preconditioningEffectiveness.disposition.outsideCoverage',
      'Outside climate coverage',
    ),
    no_window_rows: t(
      'preconditioningEffectiveness.disposition.emptyWindow',
      'Empty pre-drive window',
    ),
    insufficient_thermal_samples: t(
      'preconditioningEffectiveness.disposition.insufficientSamples',
      'Insufficient thermal samples',
    ),
    insufficient_observation_span: t(
      'preconditioningEffectiveness.disposition.insufficientSpan',
      'Insufficient observation span',
    ),
    stale_departure_sample: t(
      'preconditioningEffectiveness.disposition.staleFinal',
      'Stale final sample',
    ),
    target_shift: t(
      'preconditioningEffectiveness.disposition.targetShift',
      'Material target shift',
    ),
    initial_in_band: t(
      'preconditioningEffectiveness.disposition.initialInBand',
      'Initial cabin already in band',
    ),
    ambiguous_hvac: t(
      'preconditioningEffectiveness.disposition.ambiguousHvac',
      'Unknown HVAC evidence',
    ),
    conditioned: t(
      'preconditioningEffectiveness.groups.observedActive',
      'Observed HVAC-active pre-drive',
    ),
    unconditioned: t(
      'preconditioningEffectiveness.groups.explicitOff',
      'Explicitly HVAC-off control',
    ),
  };
  return labels[disposition];
}

export function preconditioningDispositionVariant(
  disposition: DepartureDisposition,
): 'success' | 'info' | 'warning' | 'neutral' {
  if (disposition === 'conditioned') return 'info';
  if (disposition === 'unconditioned') return 'success';
  if (
    disposition === 'target_shift'
    || disposition === 'stale_departure_sample'
    || disposition === 'ambiguous_hvac'
  ) {
    return 'warning';
  }
  return 'neutral';
}
