import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import type { DataState } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';

import type { OrchestrationResult } from '../lib/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface KpiSummaryProps {
  result: OrchestrationResult;
  startTimeIso: string;
  horizonHours: number;
  loading?: boolean;
  unavailable?: boolean;
  sourceStates: ReadonlyArray<{ id: string; state: DataState<unknown> }>;
  slotMinutes: number;
}

/** Top-of-page KPI band: overall recommendation quality plus the headline physical/financial outcomes. */
export function KpiSummary({ result, startTimeIso, horizonHours, loading, unavailable, sourceStates, slotMinutes }: KpiSummaryProps) {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatEnergy, formatPower } = useUnits();
  const { formatCurrency } = useFormatting();

  const readyCount = result.vehicles.filter((v) => v.readinessAchieved).length;
  const totalUnmetWh = result.vehicles.reduce((sum, v) => sum + v.unmetWh, 0);
  const endInstantExclusive = new Date(Date.parse(startTimeIso) + horizonHours * 3_600_000).toISOString();
  const periodLabel = t('homeEnergy.kpi.period', 'Planning horizon: {{start}} — {{end}} (end exclusive)', {
    start: startTimeIso, end: endInstantExclusive,
  });

  const available = !loading && !unavailable;
  const metrics: StatMetric[] = [
    {
      metricId: 'score', occurrenceId: 'overall',
      label: t('homeEnergy.kpi.overall', 'Overall score'),
      rawValue: available ? result.scores.overall : null,
      display: { formatter: raw => ({ value: String(Math.round(raw)), unit: '' }) },
      description: t('homeEnergy.kpi.scoreDescription', 'Modeled recommendation score, not source confidence'),
      context: result.feasible
        ? t('homeEnergy.kpi.feasible', 'Plan is feasible')
        : t('homeEnergy.kpi.infeasible', 'Constraints violated'),
    },
    {
      metricId: 'currency', occurrenceId: 'projected-cost',
      label: t('homeEnergy.kpi.cost', 'Projected cost'),
      rawValue: available ? result.totals.totalCost : null,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      description: t('homeEnergy.kpi.costDescription', 'Projected net cost using editable tariff assumptions'),
      context: t('homeEnergy.kpi.costHint', 'over the planning horizon'),
    },
    {
      metricId: 'percent', occurrenceId: 'self-consumption',
      label: t('homeEnergy.kpi.selfConsumption', 'Self-consumption'),
      rawValue: available ? result.scores.selfConsumption : null,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) },
      description: t('homeEnergy.kpi.selfConsumptionDescription', 'Modeled solar self-consumption'),
      context: t('homeEnergy.kpi.selfConsumptionHint', 'solar used on-site'),
    },
    {
      metricId: 'power', occurrenceId: 'peak-grid-import',
      label: t('homeEnergy.kpi.peakImport', 'Peak grid import'),
      rawValue: available ? result.totals.peakGridImportW : null,
      display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) },
      description: t('homeEnergy.kpi.peakImportDescription', 'Modeled peak grid import; raw input in watts'),
      context: t('homeEnergy.kpi.peakImportHint', 'highest single-slot draw'),
    },
    {
      metricId: 'count', occurrenceId: 'vehicles-ready',
      label: t('homeEnergy.kpi.vehiclesReady', 'Vehicles ready'),
      rawValue: available ? readyCount : null,
      display: { countTotal: result.vehicles.length },
      description: t('homeEnergy.kpi.vehiclesReadyDescription', 'Ready vehicles / all vehicles in this modeled plan'),
      context: t('homeEnergy.kpi.vehiclesReadyHint', 'meet their target by deadline'),
    },
    {
      metricId: 'energy', occurrenceId: 'unmet-energy',
      label: t('homeEnergy.kpi.unmetEnergy', 'Unmet energy'),
      rawValue: available ? totalUnmetWh : null,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) },
      description: t('homeEnergy.kpi.unmetEnergyDescription', 'Modeled energy shortfall; raw input in watt-hours'),
      context: t('homeEnergy.kpi.unmetEnergyHint', 'never fabricated as delivered'),
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics.map(metric => ({
    ...metric,
    context: <>{metric.context}<div>{periodLabel}</div></>,
  })));
  const paused = sourceStates.some(({ state }) => state.isRefreshBlocked);
  const stale = sourceStates.some(({ state }) => state.status === 'stale');
  const incomplete = sourceStates.some(({ state }) =>
    state.status === 'partial' || state.status === 'initialFailure' || state.status === 'initial');
  const statusLabel = loading
    ? t('homeEnergy.brief.loading', 'Loading source inputs')
    : unavailable
      ? t('homeEnergy.brief.unavailable', 'Essential source unavailable')
      : paused
        ? t('homeEnergy.brief.paused', 'Source refresh paused')
        : stale
          ? t('homeEnergy.brief.retained', 'Retained source inputs')
          : incomplete
            ? t('homeEnergy.brief.partial', 'Incomplete source inputs')
            : t('homeEnergy.brief.modeled', 'Modeled recommendation');
  return <OperationalBrief compact testId="home-energy-outcomes" metrics={operationalMetrics} loading={loading}
    eyebrow={t('homeEnergy.brief.eyebrow', 'Whole-home planning')}
    title={t('homeEnergy.brief.title', 'Planning outcomes')}
    description={t('homeEnergy.page.subtitle', 'A local, deterministic recommendation across vehicles, solar, battery, and tariffs — never an autonomous command')}
    statusLabel={statusLabel}
    statusTone={unavailable ? 'danger' : paused || stale || incomplete ? 'warning' : 'neutral'}
    scope={periodLabel}
    freshness={t('homeEnergy.brief.interval', '{{minutes}}-minute modeled slots · UTC · source coverage not established', { minutes: slotMinutes })}
    provenance={t('homeEnergy.quality.provenanceAssumed', 'Assumed (user-editable): tariff rates, grid/panel import-export limits, Powerwall specification, and per-vehicle target SoC, capacity, charge power, and departure time. TeslaSync has no endpoint that reports these as measured fact.')}
  />;
}
