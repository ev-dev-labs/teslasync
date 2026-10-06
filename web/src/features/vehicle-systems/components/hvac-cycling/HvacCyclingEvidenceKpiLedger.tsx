import {
  Activity,
  Binary,
  Clock3,
  Database,
  Gauge,
  RotateCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip, type StatMetric } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingQueryStatus } from './HvacCyclingQueryStatus';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingEvidenceKpiLedgerProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

export function HvacCyclingEvidenceKpiLedger({
  summary,
  state,
  formatDuration,
}: HvacCyclingEvidenceKpiLedgerProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unavailable = !state.vehicleSelected
    ? t('hvacCycling.kpis.selectVehicle', 'Select a vehicle to load evidence.')
    : state.isLoading
      ? t('hvacCycling.kpis.loading', 'Waiting for climate history…')
      : state.error
        ? t('hvacCycling.kpis.error', 'Climate history is unavailable.')
        : t('hvacCycling.kpis.pending', 'Evidence availability is unresolved.');

  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'returned-rows',
      label: t('hvacCycling.kpis.returned', 'Returned rows'),
      rawValue: resolved ? fmtInt(summary.rows.returnedRows) : null,
      context: <><Database aria-hidden="true" className="h-5 w-5 text-indigo-300" />{resolved
        ? t('hvacCycling.kpis.returnedHint', 'raw endpoint rows') : unavailable}</>,
    },
    {
      metricId: 'text', occurrenceId: 'known-state-samples',
      label: t('hvacCycling.kpis.known', 'Known-state samples'),
      rawValue: resolved ? fmtInt(summary.rows.validKnownStateRows) : null,
      context: <><Activity aria-hidden="true" className="h-5 w-5 text-cyan-300" />{resolved
        ? t('hvacCycling.kpis.knownHint', '{{count}} unique timestamps', {
            count: summary.rows.uniqueTimestampRows,
          }) : unavailable}</>,
    },
    {
      metricId: 'text', occurrenceId: 'observed-intervals',
      label: t('hvacCycling.kpis.intervals', 'Observed intervals'),
      rawValue: resolved ? fmtInt(summary.intervals.observedIntervals) : null,
      context: <><Binary aria-hidden="true" className="h-5 w-5 text-purple-300" />{resolved
        ? t('hvacCycling.kpis.intervalsHint', '{{count}} candidate pairs', {
            count: summary.intervals.candidateAdjacentPairs,
          }) : unavailable}</>,
    },
    {
      metricId: 'text', occurrenceId: 'observed-duration',
      label: t('hvacCycling.kpis.observed', 'Observed duration'),
      rawValue: resolved ? formatDuration(summary.observedS) : null,
      context: <><Clock3 aria-hidden="true" className="h-5 w-5 text-indigo-300" />{resolved
        ? t('hvacCycling.kpis.observedHint', 'gap-qualified on + off time') : unavailable}</>,
    },
    {
      metricId: 'text', occurrenceId: 'on-duty',
      label: t('hvacCycling.kpis.duty', 'Observed on duty'),
      rawValue: resolved && summary.dutyCycle != null ? fmtPercent(summary.dutyCycle * 100) : null,
      context: <><Gauge aria-hidden="true" className="h-5 w-5 text-cyan-300" />{resolved
        ? t('hvacCycling.kpis.dutyHint', 'duration-weighted denominator') : unavailable}</>,
    },
    {
      metricId: 'text', occurrenceId: 'short-cycle-rate',
      label: t('hvacCycling.kpis.shortRate', 'Qualified short-cycle rate'),
      rawValue: resolved && summary.qualifiedShortCycleRate != null
        ? fmtPercent(summary.qualifiedShortCycleRate * 100) : null,
      context: <><RotateCw aria-hidden="true" className="h-5 w-5 text-amber-300" />{resolved
        ? t('hvacCycling.kpis.shortRateHint', '{{count}} complete active runs', {
            count: summary.completeOnRunCount,
          }) : unavailable}</>,
    },
  ];

  return (
    <section
      data-testid="hvac-cycling-kpis"
      aria-label={t(
        'hvacCycling.kpis.aria',
        'HVAC cycling evidence ledger',
      )}
    >
      <LayoutCard title={t('hvacCycling.kpis.title', 'Evidence KPI ledger')}>
        <StatStrip id="hvac-cycling-evidence" variant="embedded" metrics={metrics}
          period={{ kind: 'unknown', label: t('hvacCycling.kpis.returnedHint', 'raw endpoint rows') }}
          retained={Boolean(state.refreshError) || (resolved && Boolean(state.isPaused))}
        />
        <HvacCyclingQueryStatus summary={summary} state={state} />
      </LayoutCard>
    </section>
  );
}
