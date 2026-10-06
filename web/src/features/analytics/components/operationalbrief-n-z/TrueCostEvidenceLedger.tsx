import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { TrueCostQueryStatus } from '../true-cost/TrueCostQueryStatus';
import type { TrueCostSectionProps } from '../true-cost/types';

export function TrueCostEvidenceLedger({ analysis, state, display }: TrueCostSectionProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const resolved = state.isResolved && state.hasData;
  const m = analysis.metrics;
  const evidenceMetrics: StatMetric[] = [
    { metricId: 'currency', occurrenceId: 'tco-recorded-spend',
      label: t('tco.kpis.recordedSpend', 'Recorded-cost spend'),
      rawValue: resolved ? m.totalChargingCost.value : null,
      context: t('tco.kpis.recordedSpendHint', 'Positive-cost sessions only'),
      display: { formatter: raw => ({ value: display.formatCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'tco-modeled-gas',
      label: t('tco.kpis.gasTotal', 'Modeled lifetime gas cost'),
      rawValue: resolved && analysis.gates.positiveDistance ? m.equivalentGasCost.value : null,
      context: t('tco.kpis.gasTotalHint', 'Positive-drive distance × configured fuel assumptions'),
      display: { formatter: raw => ({ value: display.formatCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'tco-fuel-delta',
      label: t('tco.kpis.fuelDelta', 'Fuel savings / loss'),
      rawValue: resolved && analysis.gates.fuelComparison ? m.totalFuelDelta.value : null,
      context: analysis.fuelDisposition === 'loss'
        ? t('tco.kpis.lossHint', 'Modeled gasoline costs less than recorded charging')
        : t('tco.kpis.fuelDeltaHint', 'Gas equivalent less recorded charging'),
      display: { formatter: raw => ({ value: display.formatSignedCurrency(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'tco-monthly-fuel-delta',
      label: t('tco.kpis.monthlyFuelDelta', 'Monthly fuel savings / loss'),
      rawValue: resolved && analysis.gates.monthlyFuelRate ? m.monthlyFuelDelta.value : null,
      context: t('tco.kpis.monthlyFuelDeltaHint', 'Fuel-only total ÷ modeled drive-span months; excludes maintenance'),
      display: { formatter: raw => ({ value: display.formatSignedCurrency(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'tco-recorded-energy',
      label: t('tco.kpis.recordedEnergy', 'Recorded-cost energy'),
      rawValue: resolved ? m.totalWh.value : null,
      context: t('tco.kpis.recordedEnergyHint', 'Same positive-cost session filter'),
      display: { formatter: raw => ({ value: display.formatEnergy(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'tco-costed-sessions',
      label: t('tco.kpis.costedSessions', 'Costed sessions'),
      rawValue: resolved ? m.totalSessions.value : null,
      context: t('tco.kpis.costedSessionsHint', 'Free or missing-cost rows are not counted'),
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'tco-drive-distance',
      label: t('tco.kpis.driveDistance', 'Positive-drive distance'),
      rawValue: resolved && m.totalKm.value != null ? m.totalKm.value * 1000 : null,
      context: t('tco.kpis.driveDistanceHint', 'All drives with positive distance'),
      display: { formatter: raw => ({ value: display.formatDistanceKm(raw / 1000), unit: '' }) } },
    { metricId: 'rate', occurrenceId: 'tco-drive-span-months',
      label: t('tco.kpis.driveSpanMonths', 'Modeled drive-span months'),
      rawValue: resolved && analysis.driveSpan.available ? m.monthsOfDriveSpan.value : null,
      context: t('tco.kpis.driveSpanHint', 'First-to-last positive-drive span; not tenure'),
      display: { formatter: raw => ({ value: display.formatNumber(raw), unit: '' }) } },
  ];
  const evidenceOperationalMetrics = useOperationalMetrics(evidenceMetrics);
  return <>
    <OperationalBrief compact testId="tco-evidence-kpis"
      eyebrow={t('tco.modernization.evidence.title', 'Operating-cost evidence')}
      title={t('tco.kpis.title', 'Evidence KPI ledger')}
      description={t('tco.brief.description', 'Recorded charging costs and modeled gasoline costs have distinct source filters and modeled drive-span denominators.')}
      statusLabel={!state.enabled ? t('tco.brief.selection', 'Vehicle selection required')
        : state.isLoading ? t('tco.brief.loading', 'Loading operating evidence')
          : state.isPaused || state.refreshPaused ? t('tco.brief.paused', 'Evidence refresh paused')
            : state.error || !resolved ? t('tco.brief.unavailable', 'Operating evidence unavailable')
              : state.refreshError ? t('tco.brief.retained', 'Retained operating evidence')
                : t('tco.brief.available', 'Returned operating evidence')}
      statusTone={state.error || state.refreshError || state.isPaused || state.refreshPaused ? 'warning' : 'neutral'}
      metrics={evidenceOperationalMetrics.map(metric => ({
        ...metric, tone: metric.key === 'tco-fuel-delta'
          ? analysis.fuelDisposition === 'savings' ? 'success' as const : analysis.fuelDisposition === 'loss' ? 'danger' as const : 'warning' as const
          : metric.key === 'tco-monthly-fuel-delta'
            ? (m.monthlyFuelDelta.value ?? 0) > 0 ? 'success' as const : (m.monthlyFuelDelta.value ?? 0) < 0 ? 'danger' as const : 'warning' as const
            : 'neutral' as const,
      }))}
      scope={t('tco.brief.scope', 'Lifetime source envelope; modeled first-to-last positive-drive span')}
      provenance={t('tco.query.scope', 'This workspace compares recorded-cost charging with a modeled gasoline equivalent; it is not a complete ownership-cost account.')}
      loading={state.isLoading} />
    <TrueCostQueryStatus analysis={analysis} state={state} />
  </>;
}
