import {
  Activity,
  Clock3,
  Gauge,
  ShieldCheck,
  Thermometer,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type StatMetric } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencyQueryStatus } from './ComfortConsistencyQueryStatus';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ComfortConsistencyEvidenceKpiLedgerProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function ComfortConsistencyEvidenceKpiLedger({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyEvidenceKpiLedgerProps) {
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unavailable = !state.vehicleSelected
    ? t('comfortConsistency.kpis.selectVehicle', 'Select a vehicle to load evidence.')
    : state.isLoading
      ? t('comfortConsistency.kpis.loading', 'Waiting for climate history...')
      : state.error
        ? t('comfortConsistency.kpis.error', 'Climate history is unavailable.')
        : t('comfortConsistency.kpis.pending', 'Evidence availability is unresolved.');
  const stabilizationShare =
    summary.stabilizationWindows.length > 0
      ? summary.stabilizedWindows / summary.stabilizationWindows.length
      : null;
  const metrics: StatMetric[] = [
    {
      metricId: 'number', occurrenceId: 'consistency-score',
      label: t('comfortConsistency.kpis.score', 'Adjusted consistency score'),
      rawValue: resolved ? summary.consistencyScore ?? null : null,
      display: { formatter: raw => ({ value: String(raw), unit: '' }) },
      context: <><ShieldCheck aria-hidden="true" className={`h-5 w-5 ${
        summary.consistencyScore == null ? 'text-cyan-300'
          : summary.consistencyScore >= 80 ? 'text-emerald-300'
            : summary.consistencyScore >= 60 ? 'text-amber-300' : 'text-rose-300'
      }`} />{resolved ? t('comfortConsistency.kpis.scoreHint', '{{confidence}} evidence confidence', {
        confidence: fmtPercent(summary.confidence * 100),
      }) : unavailable}</>,
    },
    {
      metricId: 'count', occurrenceId: 'analyzed-samples',
      label: t('comfortConsistency.kpis.samples', 'Analyzed active samples'),
      rawValue: resolved ? summary.analyzedSamples : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: <><Activity aria-hidden="true" className="h-5 w-5 text-indigo-300" />{resolved
        ? t('comfortConsistency.kpis.samplesHint', '{{returned}} returned rows', {
            returned: fmtInt(summary.rows.returnedRows),
          }) : unavailable}</>,
    },
    {
      metricId: 'duration', occurrenceId: 'observed-active-duration',
      label: t('comfortConsistency.kpis.observed', 'Observed active duration'),
      rawValue: resolved ? summary.intervalComposition.observedActiveS : null,
      display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) },
      context: <><Clock3 aria-hidden="true" className="h-5 w-5 text-purple-300" />{resolved
        ? t('comfortConsistency.kpis.observedHint', '{{count}} qualified intervals', {
            count: summary.intervals.observedActiveIntervals,
          }) : unavailable}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'within-band-share',
      label: t('comfortConsistency.kpis.inBand', 'Duration within comfort band'),
      rawValue: resolved && summary.intervalComposition.withinBandShare != null
        ? summary.intervalComposition.withinBandShare * 100 : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: <><Gauge aria-hidden="true" className="h-5 w-5 text-cyan-300" />{resolved
        ? t('comfortConsistency.kpis.inBandHint', 'duration-weighted support') : unavailable}</>,
    },
    {
      metricId: 'number', occurrenceId: 'weighted-deviation',
      label: t('comfortConsistency.kpis.deviation', 'Weighted mean deviation'),
      rawValue: resolved && summary.durationWeightedMeanAbsDeviationC != null
        ? summary.durationWeightedMeanAbsDeviationC : null,
      display: { formatter: raw => ({ value: formatDelta(raw), unit: '' }) },
      context: <><Thermometer aria-hidden="true" className="h-5 w-5 text-purple-300" />{resolved
        ? t('comfortConsistency.kpis.deviationHint', 'absolute cabin-to-target gap') : unavailable}</>,
    },
    {
      metricId: 'percent', occurrenceId: 'stabilization-share',
      label: t('comfortConsistency.kpis.stabilized', 'Observed stabilization share'),
      rawValue: resolved && stabilizationShare != null ? stabilizationShare * 100 : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      context: <><TimerReset aria-hidden="true" className="h-5 w-5 text-indigo-300" />{resolved
        ? t('comfortConsistency.kpis.stabilizedHint', '{{count}} outside-band fragments', {
            count: summary.stabilizationWindows.length,
          }) : unavailable}</>,
    },
  ];

  return (
    <section
      data-testid="comfort-consistency-kpis"
      aria-label={t(
        'comfortConsistency.kpis.aria',
        'Comfort consistency evidence ledger',
      )}
    >
        <VehicleOperationalBrief id="comfort-consistency-evidence" metrics={metrics}
          title={t('comfortConsistency.kpis.title', 'Evidence KPI ledger')}
          loading={state.isLoading} available={resolved}
          period={{ kind: 'unknown', label: t('comfortConsistency.kpis.aria', 'Comfort consistency evidence ledger') }}
          retained={Boolean(state.refreshError) || (resolved && Boolean(state.isPaused))}
        />
        <ComfortConsistencyQueryStatus summary={summary} state={state} />
    </section>
  );
}
