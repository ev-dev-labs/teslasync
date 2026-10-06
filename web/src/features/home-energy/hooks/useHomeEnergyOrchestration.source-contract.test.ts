/** Authored, NOTRUN. Source policy preservation only, not mounted hook evidence. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src'))
  ? resolve(process.cwd(), 'src', 'features', 'home-energy')
  : resolve(process.cwd(), 'web', 'src', 'features', 'home-energy');
const hook = readFileSync(resolve(root, 'hooks', 'useHomeEnergyOrchestration.ts'), 'utf8');
const page = readFileSync(resolve(root, 'pages', 'WholeHomeEnergyPage.tsx'), 'utf8');

describe('home-energy source and business policy preservation', () => {
  it('preserves every original query operand and optimizer ownership', () => {
    for (const binding of [
      'useVehicles()', 'useFleetStates(vehicles)', 'useTeslaEnergySites()',
      'useTeslaEnergySiteInfo(siteId)', 'useTeslaEnergyLiveStatus(siteId)',
      "useTeslaEnergyHistory(siteId, 'day')", 'optimizeHomeEnergy(input)',
      'buildVehicleInputs(vehicles, fleetStatesQuery.data, scenario, startTimeIso)',
      'buildTariffSeries(scenario.tariff, startTimeIso, scenario.slotMinutes, horizonSlots)',
      'commitPreviousPlan(plan)', 'v.slots.map((s) => s.slotIndex)',
      'previousPlan: scenario.previousPlan',
    ]) expect(hook).toContain(binding);
    expect(hook).toContain('return 50;');
    expect(hook).not.toMatch(/\bfetch\s*\(|\brequest\s*[<(]|\/api\/v1\//);
  });
  it('keeps independent canonical sources, partial fleet state, fatal-only essential failures and retained first-load behavior', () => {
    for (const query of ['vehiclesQuery', 'sitesQuery', 'siteInfoQuery', 'liveStatusQuery', 'historyQuery'])
      expect(hook).toContain(`useDataState(${query},`);
    expect(hook).toContain('deriveDataState(fleetStatesQuery,');
    expect(hook).toContain('partial: fleetSummary.failedCount > 0');
    expect(hook).toContain('error: vehiclesState.fatalError');
    expect(hook).toContain('vehiclesQuery.isLoading && !vehiclesState.hasData');
    expect(hook).toContain('...(siteId != null ? [');
    expect(page).toContain('sourceStates.map(');
    expect(page).toContain('<StaleRefreshWarning state={state}');
    expect(page).toContain('state.fatalError && <QueryError');
    expect(page).toContain('!state.hasData && state.isRefreshBlocked');
    expect(page).not.toMatch(/loading=\{isLoading\}|error=\{error\}|onRetry=\{refreshNow\}/);
  });
  it('keeps all ten section bindings mounted without a blanket loading/error gate or an autonomous apply action', () => {
    for (const section of [
      'KpiSummary', 'ScenarioControls', 'VehicleAssumptionsPanel', 'EnergyFlowChart',
      'VehicleReadinessPanel', 'PowerwallTrajectoryChart', 'TariffConstraintHeatmap',
      'ConstraintViolationsPanel', 'AssumptionsQualityPanel', 'PlanExportPanel',
    ]) expect(page).toContain(`<${section}`);
    expect(page).toContain('slotMinutes={scenario.slotMinutes}');
    expect(page).toContain('horizonHours={scenario.horizonHours}');
    expect(page).toContain('onCommitBaseline={commitAsBaseline}');
    expect(page).toContain('<PlanExportPanel input={input} result={result}');
    expect(page).not.toMatch(/if\s*\(isLoading|if\s*\(error|useSendCommand|useApplyChargePlan/);
  });
});
