import {
  Activity,
  Gauge,
  Scale,
  ShieldCheck,
  Snowflake,
  ThermometerSun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type StatMetric } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { preconditioningEvidenceLabel } from './labels';
import { PreconditioningQueryStatus } from './PreconditioningQueryStatus';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PreconditioningEvidenceLedgerProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningEvidenceLedger({
  summary,
  state,
  formatDelta,
}: PreconditioningEvidenceLedgerProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const resolved =
    state.climate.isResolved
    && state.drives.isResolved
    && !state.climate.error
    && !state.drives.error;
  const comparisonPublished = resolved && summary.overall.evidence !== 'none';
  const unavailable = !state.vehicleSelected
    ? t(
        'preconditioningEffectiveness.kpis.selectVehicle',
        'Select a vehicle to load both evidence sources.',
      )
    : state.climate.isLoading || state.drives.isLoading
      ? t(
          'preconditioningEffectiveness.kpis.loading',
          'Waiting for climate and drive history...',
        )
      : state.climate.isPaused || state.drives.isPaused
        ? t(
            'preconditioningEffectiveness.kpis.paused',
            'Evidence loading is paused while the network is unavailable.',
          )
      : state.climate.error || state.drives.error
        ? t(
            'preconditioningEffectiveness.kpis.error',
            'A required evidence source is unavailable.',
          )
        : t(
            'preconditioningEffectiveness.kpis.pending',
            'Evidence availability is unresolved.',
          );

  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'classified-departures',
      label: t('preconditioningEffectiveness.kpis.classified', 'Classified departures'),
      rawValue: resolved ? summary.joinedDepartures : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: <><Activity aria-hidden="true" className="h-5 w-5 text-indigo-300" />{resolved
        ? t('preconditioningEffectiveness.kpis.classifiedHint', '{{classified}} of {{valid}} unique valid drives', {
            classified: fmtInt(summary.joinedDepartures), valid: fmtInt(summary.driveRows.uniqueValidDrives),
          }) : unavailable}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'hvac-active-share',
      label: t('preconditioningEffectiveness.kpis.active', 'Observed HVAC-active pre-drive'),
      rawValue: resolved && summary.conditionedShare != null ? summary.conditionedShare * 100 : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: <><ThermometerSun aria-hidden="true" className="h-5 w-5 text-cyan-300" />{resolved
        ? t('preconditioningEffectiveness.kpis.activeHint', '{{count}} classified departures', {
            count: summary.conditionedDepartures,
          }) : unavailable}</>,
    },
    {
      metricId: 'count', occurrenceId: 'hvac-off-control',
      label: t('preconditioningEffectiveness.kpis.control', 'Explicitly HVAC-off control'),
      rawValue: resolved ? summary.unconditionedDepartures : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: <><Snowflake aria-hidden="true" className="h-5 w-5 text-purple-300" />{resolved
        ? t('preconditioningEffectiveness.kpis.controlHint', 'Every joined window row explicitly reported HVAC off')
        : unavailable}</>,
    },
    {
      metricId: 'number', occurrenceId: 'readiness-difference',
      label: t('preconditioningEffectiveness.kpis.readinessDifference', 'Observed readiness difference'),
      rawValue: comparisonPublished && summary.overall.startDeltaAdvantageC != null
        ? summary.overall.startDeltaAdvantageC : null,
      display: { formatter: raw => ({ value: formatDelta(raw, { signed: true }), unit: '' }) },
      context: <><Gauge aria-hidden="true" className="h-5 w-5 text-emerald-300" />{resolved
        ? t('preconditioningEffectiveness.kpis.readinessHint', 'Control median gap minus active median gap')
        : unavailable}</>,
    },
    {
      metricId: 'number', occurrenceId: 'improvement-difference',
      label: t('preconditioningEffectiveness.kpis.improvementDifference', 'Observed improvement difference'),
      rawValue: comparisonPublished && summary.overall.improvementLiftC != null
        ? summary.overall.improvementLiftC : null,
      display: { formatter: raw => ({ value: formatDelta(raw, { signed: true }), unit: '' }) },
      context: <><Scale aria-hidden="true" className="h-5 w-5 text-amber-300" />{resolved
        ? t('preconditioningEffectiveness.kpis.improvementHint', 'Active median improvement minus control median improvement')
        : unavailable}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'comparison-confidence',
      label: t('preconditioningEffectiveness.kpis.confidence', 'Comparison confidence'),
      rawValue: resolved && summary.overall.evidence !== 'none' ? summary.overall.confidence * 100 : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: <><ShieldCheck aria-hidden="true"
        className={`h-5 w-5 ${summary.overall.evidence === 'strong' ? 'text-emerald-300' : 'text-amber-300'}`}
      />{resolved ? preconditioningEvidenceLabel(t, summary.overall.evidence) : unavailable}</>,
    },
  ];

  return (
    <section
      data-testid="preconditioning-kpis"
      aria-label={t(
        'preconditioningEffectiveness.kpis.aria',
        'Preconditioning effectiveness evidence ledger',
      )}
    >
        <VehicleOperationalBrief id="preconditioning-evidence" metrics={metrics}
          title={t('preconditioningEffectiveness.kpis.title', 'KPI and evidence ledger')}
          loading={state.climate.isLoading || state.drives.isLoading} available={resolved}
          period={{ kind: 'unknown', label: t('preconditioningEffectiveness.kpis.aria', 'Preconditioning effectiveness evidence ledger') }}
          retained={Boolean(state.climate.refreshError) || Boolean(state.drives.refreshError)
            || (resolved && (state.climate.isPaused || state.drives.isPaused))}
        />
        <PreconditioningQueryStatus summary={summary} state={state} />
    </section>
  );
}
