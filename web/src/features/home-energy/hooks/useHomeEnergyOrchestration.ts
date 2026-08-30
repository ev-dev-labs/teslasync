/**
 * Whole-Home Energy Orchestrator — composition hook.
 *
 * Wires real TeslaSync data (vehicles + fleet live state, Tesla energy site
 * info / live status / history) together with the user's persisted scenario
 * assumptions and the pure forecast adapters + optimizer. This is the ONLY
 * place in the feature that touches TanStack Query — every downstream
 * component consumes its plain, already-computed return value.
 *
 * Nothing here issues a Tesla command. The optimizer result is a
 * recommendation only (see `lib/planExport.ts`).
 */

import { useMemo, useState } from 'react';
import type { FreshnessQuery } from '@/components/data-display';
import { useVehicles, useFleetStates, summariseFleetStates, type FleetStateEntry } from '@/api/hooks/useVehicles';
import {
  useTeslaEnergySites,
  useTeslaEnergySiteInfo,
  useTeslaEnergyLiveStatus,
  useTeslaEnergyHistory,
} from '@/api/hooks/useEnergy';
import type { Vehicle } from '@/types/vehicle';
import { optimizeHomeEnergy } from '../lib/optimizer';
import { buildLoadForecast, buildSolarForecast, type ForecastResult } from '../lib/forecastAdapters';
import { buildTariffSeries, defaultDepartureSlot, DEFAULT_VEHICLE_ASSUMPTION } from '../lib/scenarioDefaults';
import {
  commitPreviousPlan,
  useOrchestrationScenario,
  type OrchestrationScenario,
} from './useOrchestrationScenario';
import type { OrchestrationInput, OrchestrationResult, Priority, VehicleInput } from '../lib/types';

function vehicleDisplayName(v: Vehicle): string {
  return (v.display_name && v.display_name.trim()) || v.vin || `#${v.id}`;
}

function resolveCurrentSocPct(vehicle: Vehicle, fleetEntry: FleetStateEntry | undefined): number {  const fromState = fleetEntry?.state?.battery_level;
  if (typeof fromState === 'number' && Number.isFinite(fromState)) return fromState;
  const fromList = vehicle.battery_level ?? vehicle.batteryLevel;
  if (typeof fromList === 'number' && Number.isFinite(fromList)) return fromList;
  return 50;
}

function buildVehicleInputs(
  vehicles: Vehicle[],
  fleetStates: FleetStateEntry[] | undefined,
  scenario: OrchestrationScenario,
  startTimeIso: string,
): VehicleInput[] {
  return vehicles.map((v): VehicleInput => {
    const id = String(v.id);
    const fleetEntry = fleetStates?.find((f) => f.vehicle.id === v.id);
    const assumption = scenario.vehicleAssumptions[id] ?? DEFAULT_VEHICLE_ASSUMPTION;
    const departureSlot = assumption.hasDeadline
      ? defaultDepartureSlot(assumption.departureHour, startTimeIso, scenario.slotMinutes, horizonSlotsFor(scenario))
      : null;
    const priority: Priority = assumption.priority;
    return {
      id,
      name: vehicleDisplayName(v),
      currentSocPct: resolveCurrentSocPct(v, fleetEntry),
      targetSocPct: assumption.targetSocPct,
      usableCapacityWh: assumption.usableCapacityWh,
      maxChargePowerW: assumption.maxChargePowerW,
      departureSlot,
      priority,
    };
  });
}

function horizonSlotsFor(scenario: OrchestrationScenario): number {
  return Math.max(1, Math.round((scenario.horizonHours * 60) / scenario.slotMinutes));
}

export interface HomeEnergyOrchestration {
  /** `true` while the essential vehicle list is loading (see `PageContainer`'s `loading` prop). */
  isLoading: boolean;
  /** Essential-data error, if any. */
  error: Error | null;
  /** Every underlying query, for a page-level freshness badge (`PageContainer`'s `query` prop). */
  queries: FreshnessQuery[];
  vehicles: Vehicle[];
  hasEnergySite: boolean;
  siteName: string | null;
  scenario: OrchestrationScenario;
  startTimeIso: string;
  input: OrchestrationInput;
  result: OrchestrationResult;
  solarForecast: ForecastResult;
  loadForecast: ForecastResult;
  /** Re-anchors `startTimeIso` to `now` and recomputes the plan from the current moment. */
  refreshNow: () => void;
  /** Persists this run's per-vehicle schedule as the stability baseline for the next run. */
  commitAsBaseline: () => void;
}

/**
 * Composes real hooks + the local optimizer into one ready-to-render result.
 * Every TanStack Query call here is unconditional (hooks-of-hooks rule) —
 * `useFleetStates` internally fans out per-vehicle in a single batched query
 * rather than calling a hook in a loop.
 */
export function useHomeEnergyOrchestration(): HomeEnergyOrchestration {
  const [startTimeIso, setStartTimeIso] = useState(() => new Date().toISOString());

  const vehiclesQuery = useVehicles();
  const vehicles = vehiclesQuery.data ?? [];
  const fleetStatesQuery = useFleetStates(vehicles);

  const sitesQuery = useTeslaEnergySites();
  const sites = sitesQuery.data ?? [];
  const primarySite = useMemo(
    () => sites.find((s) => s.has_battery || s.has_solar) ?? sites[0],
    [sites],
  );
  const siteId = primarySite?.energy_site_id;

  const siteInfoQuery = useTeslaEnergySiteInfo(siteId);
  const liveStatusQuery = useTeslaEnergyLiveStatus(siteId);
  const historyQuery = useTeslaEnergyHistory(siteId, 'day');

  const scenario = useOrchestrationScenario();
  const horizonSlots = horizonSlotsFor(scenario);

  const solarForecast = useMemo(
    () =>
      buildSolarForecast(historyQuery.data, {
        startTimeIso,
        slotMinutes: scenario.slotMinutes,
        horizonSlots,
      }),
    [historyQuery.data, startTimeIso, scenario.slotMinutes, horizonSlots],
  );
  const loadForecast = useMemo(
    () =>
      buildLoadForecast(historyQuery.data, {
        startTimeIso,
        slotMinutes: scenario.slotMinutes,
        horizonSlots,
      }),
    [historyQuery.data, startTimeIso, scenario.slotMinutes, horizonSlots],
  );

  const tariff = useMemo(
    () => buildTariffSeries(scenario.tariff, startTimeIso, scenario.slotMinutes, horizonSlots),
    [scenario.tariff, startTimeIso, scenario.slotMinutes, horizonSlots],
  );

  const vehicleInputs = useMemo(
    () => buildVehicleInputs(vehicles, fleetStatesQuery.data, scenario, startTimeIso),
    [vehicles, fleetStatesQuery.data, scenario, startTimeIso],
  );

  const powerwallInput = useMemo(() => {
    if (!scenario.powerwall.enabled) return null;
    const liveSoc = liveStatusQuery.data?.percentage_charged;
    const siteSoc = primarySite?.percentage_charged;
    const currentSocPct =
      typeof liveSoc === 'number' && Number.isFinite(liveSoc)
        ? liveSoc
        : typeof siteSoc === 'number' && Number.isFinite(siteSoc)
          ? siteSoc
          : 50;
    return {
      capacityWh: scenario.powerwall.capacityWh,
      currentSocPct,
      reservePct: scenario.powerwall.reservePct,
      maxChargePowerW: scenario.powerwall.maxChargePowerW,
      maxDischargePowerW: scenario.powerwall.maxDischargePowerW,
      roundTripEfficiency: scenario.powerwall.roundTripEfficiency,
    };
  }, [scenario.powerwall, liveStatusQuery.data, primarySite]);

  const input = useMemo<OrchestrationInput>(
    () => ({
      slotMinutes: scenario.slotMinutes,
      horizonSlots,
      startTimeIso,
      vehicles: vehicleInputs,
      solarForecastW: solarForecast.seriesW,
      loadForecastW: loadForecast.seriesW,
      tariff,
      powerwall: powerwallInput,
      grid: { maxImportW: scenario.grid.maxImportW, maxExportW: scenario.grid.maxExportW },
      weights: scenario.weights,
      previousPlan: scenario.previousPlan,
    }),
    [scenario, horizonSlots, startTimeIso, vehicleInputs, solarForecast, loadForecast, tariff, powerwallInput],
  );

  const result = useMemo(() => optimizeHomeEnergy(input), [input]);

  /* `useFleetStates` resolves successfully even when every per-vehicle request
   * failed, so its own `dataUpdatedAt` / `isError` describe the WRAPPER, not
   * the readings. Substituting the observation-based model keeps this page's
   * freshness chips from reporting "just now" over data that has not moved. */
  const fleetSummary = useMemo(
    () => summariseFleetStates(fleetStatesQuery.data ?? []),
    [fleetStatesQuery.data],
  );
  const fleetFreshness = useMemo(() => ({
    isFetching: fleetStatesQuery.isFetching,
    isError: fleetSummary.failedCount > 0,
    isStale: fleetStatesQuery.isStale || fleetSummary.retainedCount > 0,
    dataUpdatedAt: fleetSummary.oldestObservedAt ?? 0,
    refetch: fleetStatesQuery.refetch,
  }), [fleetStatesQuery, fleetSummary]);

  const queries: FreshnessQuery[] = [
    ...[vehiclesQuery, sitesQuery, siteInfoQuery, liveStatusQuery, historyQuery].map((q) => ({
      isFetching: q.isFetching,
      isError: q.isError,
      isStale: q.isStale,
      dataUpdatedAt: q.dataUpdatedAt,
      refetch: q.refetch,
    })),
    fleetFreshness,
  ];

  return {
    isLoading: vehiclesQuery.isLoading,
    error: (vehiclesQuery.error as Error | null) ?? null,
    queries,
    vehicles,
    hasEnergySite: !!primarySite,
    siteName: primarySite?.site_name ?? null,
    scenario,
    startTimeIso,
    input,
    result,
    solarForecast,
    loadForecast,
    refreshNow: () => setStartTimeIso(new Date().toISOString()),
    commitAsBaseline: () => {
      const plan: Record<string, number[]> = {};
      for (const v of result.vehicles) {
        plan[v.vehicleId] = v.slots.map((s) => s.slotIndex);
      }
      commitPreviousPlan(plan);
    },
  };
}
