import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type { PreconditioningQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PreconditioningDepartureDispositionProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
}

export function PreconditioningDepartureDisposition({
  summary,
  state,
}: PreconditioningDepartureDispositionProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const a = summary.departureAccounting;
  const outcomes = [
    {
      key: 'outside',
      label: t('preconditioningEffectiveness.departures.outside', 'Outside climate coverage'),
      detail: t('preconditioningEffectiveness.departures.outsideDetail', 'The pre-drive window does not overlap the returned climate span.'),
      value: a.outsideClimateCoverage,
    },
    {
      key: 'empty',
      label: t('preconditioningEffectiveness.departures.empty', 'Empty window inside coverage'),
      detail: t('preconditioningEffectiveness.departures.emptyDetail', 'Coverage overlaps, but no climate row falls inside this departure window.'),
      value: a.noWindowRows,
    },
    {
      key: 'samples',
      label: t('preconditioningEffectiveness.departures.samples', 'Insufficient distinct cabin states'),
      detail: t('preconditioningEffectiveness.departures.samplesDetail', 'Too few cabin-value transitions contain a front-row target; repeated forward-filled values do not count again.'),
      value: a.insufficientThermalSamples,
    },
    {
      key: 'span',
      label: t('preconditioningEffectiveness.departures.span', 'Insufficient observation span'),
      detail: t('preconditioningEffectiveness.departures.spanDetail', 'Distinct cabin states exist, but their elapsed span is below the gate.'),
      value: a.insufficientObservationSpan,
    },
    {
      key: 'stale',
      label: t('preconditioningEffectiveness.departures.stale', 'Stale final sample'),
      detail: t('preconditioningEffectiveness.departures.staleDetail', 'The last distinct cabin-state transition is too old to represent departure readiness.'),
      value: a.staleDepartureSample,
    },
    {
      key: 'target',
      label: t('preconditioningEffectiveness.departures.target', 'Material target shift'),
      detail: t('preconditioningEffectiveness.departures.targetDetail', 'The front-row target changed beyond the configured comparability gate.'),
      value: a.targetShiftExclusions,
    },
    {
      key: 'band',
      label: t('preconditioningEffectiveness.departures.band', 'Initial cabin already in band'),
      detail: t('preconditioningEffectiveness.departures.bandDetail', 'There was too little initial cabin-to-target gap to assess improvement.'),
      value: a.initialInBand,
    },
    {
      key: 'unknown',
      label: t('preconditioningEffectiveness.departures.unknown', 'Ambiguous HVAC evidence'),
      detail: t('preconditioningEffectiveness.departures.unknownDetail', 'No active row exists, but at least one window row has unknown HVAC state.'),
      value: a.ambiguousHvac,
    },
    {
      key: 'active',
      label: t('preconditioningEffectiveness.groups.observedActive', 'Observed HVAC-active pre-drive'),
      detail: t('preconditioningEffectiveness.departures.activeDetail', 'At least one row in the qualified window reports HVAC active.'),
      value: a.conditioned,
    },
    {
      key: 'control',
      label: t('preconditioningEffectiveness.groups.explicitOff', 'Explicitly HVAC-off control'),
      detail: t('preconditioningEffectiveness.departures.controlDetail', 'Every row in the qualified window explicitly reports HVAC off.'),
      value: a.unconditioned,
    },
  ];

  return (
    <section data-testid="preconditioning-departure-disposition">
      <LayoutCard title={t('preconditioningEffectiveness.departures.title', 'Departure disposition')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.departures.subtitle',
            'Ordered gates assign every unique valid drive to exactly one exclusion or observational group.',
          )}
        </Text>
        <PreconditioningSectionBody summary={summary} state={state}>
          <VehicleOperationalBrief embedded id="preconditioning-departure-disposition-summary"
            title={t('preconditioningEffectiveness.departures.title', 'Departure disposition')}
            retained={Boolean(state.climate.refreshError) || Boolean(state.drives.refreshError)
              || state.climate.isPaused || state.drives.isPaused}
            period={{ kind: 'unknown', label: t('preconditioningEffectiveness.coverage.title', 'Source and temporal coverage'),
              reason: t('preconditioningEffectiveness.departures.subtitle', 'Ordered gates assign every unique valid drive to exactly one exclusion or observational group.') }}
            metrics={outcomes.map(outcome => ({
              metricId: 'count', occurrenceId: outcome.key, label: outcome.label, rawValue: outcome.value,
              description: outcome.detail,
              display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
            }))}
          />
        </PreconditioningSectionBody>
      </LayoutCard>
    </section>
  );
}
