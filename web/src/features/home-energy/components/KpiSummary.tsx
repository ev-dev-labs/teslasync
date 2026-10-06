import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display';
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
}

/** Top-of-page KPI band: overall recommendation quality plus the headline physical/financial outcomes. */
export function KpiSummary({ result, startTimeIso, horizonHours, loading, unavailable }: KpiSummaryProps) {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatEnergy, formatPower } = useUnits();
  const { formatCurrency } = useFormatting();

  const readyCount = result.vehicles.filter((v) => v.readinessAchieved).length;
  const totalUnmetWh = result.vehicles.reduce((sum, v) => sum + v.unmetWh, 0);
  const endInstantExclusive = new Date(Date.parse(startTimeIso) + horizonHours * 3_600_000).toISOString();

  const available = !loading && !unavailable;
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'overall',
      label: t('homeEnergy.kpi.overall', 'Overall score'),
      rawValue: available ? String(Math.round(result.scores.overall)) : null,
      context: result.feasible
        ? t('homeEnergy.kpi.feasible', 'Plan is feasible')
        : t('homeEnergy.kpi.infeasible', 'Constraints violated'),
    },
    {
      metricId: 'text', occurrenceId: 'projected-cost',
      label: t('homeEnergy.kpi.cost', 'Projected cost'),
      rawValue: available ? formatCurrency(result.totals.totalCost) : null,
      context: t('homeEnergy.kpi.costHint', 'over the planning horizon'),
    },
    {
      metricId: 'text', occurrenceId: 'self-consumption',
      label: t('homeEnergy.kpi.selfConsumption', 'Self-consumption'),
      rawValue: available ? fmtPercent(result.scores.selfConsumption) : null,
      context: t('homeEnergy.kpi.selfConsumptionHint', 'solar used on-site'),
    },
    {
      metricId: 'text', occurrenceId: 'peak-grid-import',
      label: t('homeEnergy.kpi.peakImport', 'Peak grid import'),
      rawValue: available ? formatPower(result.totals.peakGridImportW) : null,
      context: t('homeEnergy.kpi.peakImportHint', 'highest single-slot draw'),
    },
    {
      metricId: 'text', occurrenceId: 'vehicles-ready',
      label: t('homeEnergy.kpi.vehiclesReady', 'Vehicles ready'),
      rawValue: available ? `${readyCount}/${result.vehicles.length}` : null,
      context: t('homeEnergy.kpi.vehiclesReadyHint', 'meet their target by deadline'),
    },
    {
      metricId: 'text', occurrenceId: 'unmet-energy',
      label: t('homeEnergy.kpi.unmetEnergy', 'Unmet energy'),
      rawValue: available ? formatEnergy(totalUnmetWh) : null,
      context: t('homeEnergy.kpi.unmetEnergyHint', 'never fabricated as delivered'),
    },
  ];
  return <StatStrip id="home-energy-outcomes" metrics={metrics} loading={loading}
    period={{
      kind: 'analysis',
      label: t('homeEnergy.kpi.period', 'Planning horizon: {{start}} — {{end}} (end exclusive)', {
        start: startTimeIso, end: endInstantExclusive,
      }),
      start: startTimeIso,
      endExclusive: endInstantExclusive,
      timezone: 'UTC',
      completeness: 'unknown',
      provenance: t('homeEnergy.page.subtitle', 'A local, deterministic recommendation across vehicles, solar, battery, and tariffs — never an autonomous command'),
    }}
  />;
}
