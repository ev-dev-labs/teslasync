import { useTranslation } from 'react-i18next';
import { type StatMetric } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { UnitFormatter } from '@/hooks/useUnits';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalQueryStatus, type CabinThermalQueryState } from '../cabin-thermal';
import { presentCabinThermalLedger } from './ledgerPresenter';

interface CabinThermalEvidenceStatsProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  formatDuration: UnitFormatter;
}

export function CabinThermalEvidenceStats({
  summary,
  state,
  formatDuration,
}: CabinThermalEvidenceStatsProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const resolved = state.isResolved && !state.error;
  const unavailable = !state.vehicleSelected
    ? t('cabinThermal.states.selectVehicleKpi', 'Select a vehicle above to load evidence.')
    : state.isLoading
      ? t('cabinThermal.states.loadingKpi', 'Waiting for climate history…')
      : state.error
        ? t('cabinThermal.states.errorKpi', 'Climate history is unavailable; retry below.')
        : t('cabinThermal.states.pendingKpi', 'Climate-history availability is unresolved.');
  const descriptions = [
    {
      label: t('cabinThermal.kpis.returned', 'Returned rows'),
      hint: t('cabinThermal.kpis.returnedHint', 'raw endpoint rows'),
    },
    {
      label: t('cabinThermal.kpis.normalized', 'Normalized samples'),
      hint: t('cabinThermal.kpis.normalizedHint', '{{count}} rows excluded', {
        count: summary.accounting.excludedRows,
      }),
    },
    {
      label: t('cabinThermal.kpis.candidates', 'Candidate windows'),
      hint: t('cabinThermal.kpis.candidatesHint', 'contiguous HVAC-off segments'),
    },
    {
      label: t('cabinThermal.kpis.accepted', 'Accepted fits'),
      hint: t('cabinThermal.kpis.acceptedHint', 'the only windows supporting τ'),
    },
    {
      label: t('cabinThermal.kpis.rejected', 'Rejected candidates'),
      hint: t('cabinThermal.kpis.rejectedHint', 'one final reason per candidate'),
    },
    {
      label: t('cabinThermal.kpis.tau', 'Accepted median τ'),
      hint: t('cabinThermal.kpis.tauHint', 'withheld without an accepted fit'),
    },
  ];
  const metrics: StatMetric[] = presentCabinThermalLedger(
    summary, resolved, fmtInt, formatDuration,
  ).map((fact, index) => ({
    metricId: fact.id === 'tau' ? 'duration' : 'count',
    occurrenceId: `cabin-thermal-${fact.id}`,
    rawValue: fact.raw,
    display: { formatter: raw => ({ value: fact.id === 'tau' ? formatDuration(raw) : fmtInt(raw), unit: '' }) },
    label: descriptions[index].label,
    description: descriptions[index].hint,
    context: resolved ? descriptions[index].hint : unavailable,
    missingReason: resolved ? descriptions[index].hint : unavailable,
  }));

  return (
    <section
      data-testid="cabin-thermal-kpis"
      aria-label={t('cabinThermal.kpis.aria', 'Cabin thermal evidence accounting summary')}
    >
        <VehicleOperationalBrief
          id="cabin-thermal-evidence"
          title={t('cabinThermal.kpis.title', 'Thermal evidence ledger')}
          metrics={metrics}
          loading={state.isLoading}
          available={resolved}
          period={{
            kind: 'unknown',
            label: t('cabinThermal.kpis.returnedHint', 'raw endpoint rows'),
          }}
          retained={Boolean(state.refreshError) || (resolved && Boolean(state.isPaused))}
        />
        <CabinThermalQueryStatus summary={summary} state={state} />
    </section>
  );
}
