import { useTranslation } from 'react-i18next';
import { Zap, Gauge, TrendingDown, BatteryCharging, AlertTriangle, CarFront } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Grid } from '@/components/layout';
import { MetricCard } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtPercent } from '@/lib/numberFormat';
import type { OrchestrationResult } from '../lib/types';

interface KpiSummaryProps {
  result: OrchestrationResult;
}

/** Top-of-page KPI band: overall recommendation quality plus the headline physical/financial outcomes. */
export function KpiSummary({ result }: KpiSummaryProps) {
  const { t } = useTranslation();
  const { formatEnergy, formatPower } = useUnits();
  const { formatCurrency } = useFormatting();

  const readyCount = result.vehicles.filter((v) => v.readinessAchieved).length;
  const totalUnmetWh = result.vehicles.reduce((sum, v) => sum + v.unmetWh, 0);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <Grid cols={{ default: 2, sm: 3, xl: 6 }} gap={4}>
        <MetricCard
          label={t('homeEnergy.kpi.overall', 'Overall Score')}
          value={`${Math.round(result.scores.overall)}`}
          subtitle={
            result.feasible
              ? t('homeEnergy.kpi.feasible', 'Plan is feasible')
              : t('homeEnergy.kpi.infeasible', 'Constraints violated')
          }
          icon={<Gauge className="h-4 w-4" />}
          color={result.feasible ? 'green' : 'red'}
        />
        <MetricCard
          label={t('homeEnergy.kpi.cost', 'Projected Cost')}
          value={formatCurrency(result.totals.totalCost)}
          subtitle={t('homeEnergy.kpi.costHint', 'over the planning horizon')}
          icon={<Zap className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('homeEnergy.kpi.selfConsumption', 'Self-Consumption')}
          value={fmtPercent(result.scores.selfConsumption, 0)}
          subtitle={t('homeEnergy.kpi.selfConsumptionHint', 'solar used on-site')}
          icon={<BatteryCharging className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('homeEnergy.kpi.peakImport', 'Peak Grid Import')}
          value={formatPower(result.totals.peakGridImportW)}
          subtitle={t('homeEnergy.kpi.peakImportHint', 'highest single-slot draw')}
          icon={<TrendingDown className="h-4 w-4" />}
          color="blue"
        />
        <MetricCard
          label={t('homeEnergy.kpi.vehiclesReady', 'Vehicles Ready')}
          value={`${readyCount}/${result.vehicles.length}`}
          subtitle={t('homeEnergy.kpi.vehiclesReadyHint', 'meet their target by deadline')}
          icon={<CarFront className="h-4 w-4" />}
          color={readyCount === result.vehicles.length ? 'green' : 'amber'}
        />
        <MetricCard
          label={t('homeEnergy.kpi.unmetEnergy', 'Unmet Energy')}
          value={formatEnergy(totalUnmetWh)}
          subtitle={t('homeEnergy.kpi.unmetEnergyHint', 'never fabricated as delivered')}
          icon={<AlertTriangle className="h-4 w-4" />}
          color={totalUnmetWh > 0 ? 'red' : 'green'}
        />
      </Grid>
    </GlassPanel>
  );
}
