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
import { PageLayout } from '@/components/layout';
import { DataStateNotice, QueryError, StaleRefreshWarning } from '@/components/feedback';
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
  usePageTitle(t('homeEnergy.page.title', 'Whole-home energy orchestrator'));

  const {
    isLoading,
    error,
    queries,
    sourceStates,
    hasEnergySite,
    siteName,
    scenario,
    input,
    result,
    startTimeIso,
    solarForecast,
    loadForecast,
    refreshNow,
    commitAsBaseline,
  } = useHomeEnergyOrchestration();
  const sourceLabels: Record<string, string> = {
    vehicles: t('homeEnergy.sources.vehicles', 'Vehicles'),
    fleet: t('homeEnergy.sources.fleet', 'Vehicle live state'),
    sites: t('homeEnergy.sources.sites', 'Energy sites'),
    siteInfo: t('homeEnergy.sources.siteInfo', 'Energy site information'),
    liveStatus: t('homeEnergy.sources.liveStatus', 'Energy live status'),
    history: t('homeEnergy.sources.history', 'Energy history'),
  };

  return (
    <PageLayout
      title={t('homeEnergy.page.title', 'Whole-home energy orchestrator')}
      subtitle={t(
        'homeEnergy.page.subtitle',
        'A local, deterministic recommendation across vehicles, solar, battery, and tariffs — never an autonomous command',
      )}
      busy={isLoading || sourceStates.some(source => source.state.isRefreshing)}
      query={queries}
    >
      {sourceStates.map(({ id, state }) => (
        <div key={id} data-home-energy-source={id}>
          <StaleRefreshWarning state={state} label={sourceLabels[id]}
            message={state.status === 'partial'
              ? t('homeEnergy.sources.partial', 'Some vehicle live readings are unavailable. The recommendation includes explicitly disclosed scenario assumptions.')
              : undefined} />
          {!state.hasData && state.isRefreshBlocked ? (
            <DataStateNotice state="unavailable" title={sourceLabels[id]} role="status">
              {t('homeEnergy.sources.waitingConnection', 'This source is waiting for a connection. Modeled recommendations remain visible with their assumptions.')}
            </DataStateNotice>
          ) : null}
          {state.fatalError && <QueryError error={state.fatalError}
            resourceName={sourceLabels[id]}
            onRetry={state.retry ?? undefined} />}
        </div>
      ))}
      {/* 1 — headline outcome */}
      <FadeIn>
        <KpiSummary result={result} startTimeIso={startTimeIso} horizonHours={scenario.horizonHours}
          loading={isLoading} unavailable={error != null} sourceStates={sourceStates} slotMinutes={scenario.slotMinutes} />
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
        <EnergyFlowChart slots={result.slots} slotMinutes={scenario.slotMinutes} />
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
          historyState={sourceStates.find(({ id }) => id === 'history')?.state}
        />
      </FadeIn>

      {/* 10 — canonical JSON export */}
      <FadeIn delay={0.45}>
        <PlanExportPanel input={input} result={result} />
      </FadeIn>
    </PageLayout>
  );
}
