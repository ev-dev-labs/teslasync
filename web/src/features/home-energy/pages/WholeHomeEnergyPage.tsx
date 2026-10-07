/**
 * Whole-Home Energy Orchestrator — main page.
 *
 * Coordinates every vehicle, solar forecast, Powerwall, tariff, and grid/panel
 * limit into one deterministic, locally-computed 15-minute-slot schedule
 * (see `../lib/optimizer.ts`). This page only wires the composition hook's
 * output into presentational sections — all data fetching lives in
 * `useHomeEnergyOrchestration`, and all optimization logic lives in the pure,
 * unit-tested `lib/` modules.
 *
 * This is a recommendation surface only: nothing here issues a command to a
 * vehicle, Powerwall, or utility. See `PlanExportPanel` / `lib/planExport.ts`.
 */
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHomeEnergyOrchestration } from '../hooks/useHomeEnergyOrchestration';
import {
  KpiSummary,
  ScenarioControls,
  VehicleAssumptionsPanel,
  EnergyFlowChart,
  VehicleReadinessPanel,
  PowerwallTrajectoryChart,
  TariffConstraintHeatmap,
  ConstraintViolationsPanel,
  AssumptionsQualityPanel,
  PlanExportPanel,
} from '../components';

export default function WholeHomeEnergyPage() {
  const { t } = useTranslation();
  usePageTitle(t('homeEnergy.page.title', 'Whole-Home Energy Orchestrator'));

  const {
    isLoading,
    error,
    queries,
    hasEnergySite,
    siteName,
    scenario,
    input,
    result,
    solarForecast,
    loadForecast,
    refreshNow,
    commitAsBaseline,
  } = useHomeEnergyOrchestration();

  return (
    <PageContainer
      title={t('homeEnergy.page.title', 'Whole-Home Energy Orchestrator')}
      subtitle={t(
        'homeEnergy.page.subtitle',
        'A local, deterministic recommendation across vehicles, solar, battery, and tariffs — never an autonomous command',
      )}
      loading={isLoading}
      error={error}
      query={queries}
    >
      {/* 1 — headline outcome */}
      <FadeIn>
        <KpiSummary result={result} />
      </FadeIn>

      {/* 2 — scenario controls (horizon, tariff, grid, Powerwall, weight preset) */}
      <FadeIn delay={0.05}>
        <ScenarioControls scenario={scenario} onRefreshNow={refreshNow} onCommitBaseline={commitAsBaseline} />
      </FadeIn>

      {/* 3 — per-vehicle editable assumptions */}
      <FadeIn delay={0.1}>
        <VehicleAssumptionsPanel vehicleInputs={input.vehicles} assumptions={scenario.vehicleAssumptions} />
      </FadeIn>

      {/* 4 — multi-series energy flow schedule */}
      <FadeIn delay={0.15}>
        <EnergyFlowChart slots={result.slots} />
      </FadeIn>

      {/* 5 — per-vehicle readiness */}
      <FadeIn delay={0.2}>
        <VehicleReadinessPanel vehicles={result.vehicles} />
      </FadeIn>

      {/* 6 — Powerwall trajectory */}
      <FadeIn delay={0.25}>
        <PowerwallTrajectoryChart slots={result.slots} powerwall={input.powerwall} />
      </FadeIn>

      {/* 7 — tariff / constraint heatmap */}
      <FadeIn delay={0.3}>
        <TariffConstraintHeatmap slots={result.slots} grid={input.grid} hasPowerwall={!!input.powerwall} />
      </FadeIn>

      {/* 8 — constraint violations / infeasibility report */}
      <FadeIn delay={0.35}>
        <ConstraintViolationsPanel violations={result.violations} />
      </FadeIn>

      {/* 9 — assumptions & forecast quality / data provenance */}
      <FadeIn delay={0.4}>
        <AssumptionsQualityPanel
          solarForecast={solarForecast}
          loadForecast={loadForecast}
          hasEnergySite={hasEnergySite}
          siteName={siteName}
        />
      </FadeIn>

      {/* 10 — canonical JSON export */}
      <FadeIn delay={0.45}>
        <PlanExportPanel input={input} result={result} />
      </FadeIn>
    </PageContainer>
  );
}
