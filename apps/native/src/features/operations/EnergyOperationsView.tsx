import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useBatteryDegradationAnalytics,
  useBatteryHealth,
  useFleetAnalytics,
  useRegenAnalytics,
  useRouteEfficiency,
  useSleepAnalytics,
  useSpeedProfile,
  useTCOAnalytics,
  useTemperatureImpact,
  useVehicleEnergy,
  useVehicles,
} from '../../api/hooks';
import type {
  BatteryDegradationAnalytics,
  BatteryHealth,
  EnergyStats,
  FleetAnalytics,
  RegenAnalytics,
  RouteEfficiencyData,
  SleepAnalytics,
  SpeedProfileData,
  TCOAnalytics,
  TemperatureImpactData,
  Vehicle,
} from '../../api/types';
import {
  ChartSummary,
  type ChartSummaryDatum,
} from '../../components/charts/ChartSummary';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { StatusPill } from '../../components/ui/StatusPill';
import { spacing } from '../../theme/tokens';
import {
  formatCount,
  formatCurrency,
  formatBatteryPctPer100Km,
  formatDistanceKm,
  formatDistanceM,
  formatDurationSeconds,
  formatEfficiencyWhKm,
  formatEnergyWh,
  formatNumber,
  formatPercent,
  formatShortDate,
  formatSpeedMps,
  formatTemperatureC,
} from './formatOperationsValue';
import { OperationsMessage } from './OperationsMessage';
import {
  OperationsRouteReadiness,
  type OperationsRouteReadinessItem,
} from './OperationsRouteReadiness';

const energyReadinessItems: OperationsRouteReadinessItem[] = [
  {
    id: 'energy',
    label: 'Energy overview',
    route: '/energy',
    api: '/vehicles/{vehicleID}/energy, /analytics/fleet',
    status: 'implemented',
    evidence:
      'Native renders energy totals, fleet analytics, and daily trend summaries from typed API hooks.',
  },
  {
    id: 'battery-health',
    label: 'Battery health',
    route: '/battery, /battery/health',
    api: '/vehicles/{vehicleID}/battery',
    status: 'implemented',
    evidence:
      'Native renders health score, capacity, degradation, range, and monthly battery trend rows.',
  },
  {
    id: 'battery-degradation',
    label: 'Battery degradation analytics',
    route: '/battery-degradation',
    api: '/analytics/battery-degradation',
    status: 'implemented',
    evidence:
      'Native renders predictive degradation metrics, stress level, and recommendation tables.',
  },
  {
    id: 'ownership',
    label: 'TCO, sleep, and regen analytics',
    route: '/tco, /analytics/tco, /sleep-efficiency, /regen-efficiency',
    api: '/analytics/tco, /analytics/sleep, /analytics/regen',
    status: 'implemented',
    evidence:
      'Native renders typed ownership savings, sleep efficiency, and regen recovery sections.',
  },
  {
    id: 'driving-analytics',
    label: 'Speed, temperature, and route efficiency',
    route: '/speed-profile, /temperature-impact, /route-efficiency',
    api: '/analytics/speed-profile, /analytics/temperature-impact, /analytics/route-efficiency',
    status: 'implemented',
    evidence:
      'Native renders chart summaries and accessible route/temperature tables without web chart libraries.',
  },
  {
    id: 'energy-products',
    label: 'Energy products and power flow',
    route: '/energy-products, /energy-flow, /power-flow',
    api: '/tesla/energy-sites and live power-flow routes',
    status: 'pending',
    evidence:
      'Tesla Energy product management remains visible as pending; this slice does not fake live site data.',
  },
];

function hasEnergyStats(
  energy: EnergyStats | undefined,
): energy is EnergyStats {
  return Boolean(
    energy &&
      [
        energy.total_energy_used_wh,
        energy.total_energy_charged_wh,
        energy.total_wh,
        energy.total_distance_m,
        energy.avg_efficiency_wh_per_m,
      ].some(value => value != null),
  );
}

function healthTone(
  score: number | null | undefined,
): 'danger' | 'success' | 'warning' {
  if (score == null || !Number.isFinite(score)) {
    return 'warning';
  }

  if (score >= 80) {
    return 'success';
  }

  if (score >= 50) {
    return 'warning';
  }

  return 'danger';
}

function selectedVehicleLabel(vehicle: Vehicle | null): string {
  return vehicle
    ? `${vehicle.display_name} (#${vehicle.id})`
    : 'No vehicle selected';
}

export function EnergyOperationsView() {
  const vehiclesQuery = useVehicles();
  const vehicles = useMemo(
    () => vehiclesQuery.data ?? [],
    [vehiclesQuery.data],
  );
  const selectedVehicle = vehicles[0] ?? null;
  const selectedVehicleId = selectedVehicle?.id ?? null;

  const energyQuery = useVehicleEnergy(selectedVehicleId, 30);
  const batteryQuery = useBatteryHealth(selectedVehicleId);
  const fleetQuery = useFleetAnalytics({ days: 30 });
  const tcoQuery = useTCOAnalytics(selectedVehicleId);
  const sleepQuery = useSleepAnalytics(selectedVehicleId, 30);
  const regenQuery = useRegenAnalytics(selectedVehicleId);
  const degradationQuery = useBatteryDegradationAnalytics(selectedVehicleId);
  const speedQuery = useSpeedProfile(selectedVehicleId);
  const temperatureQuery = useTemperatureImpact(selectedVehicleId);
  const routeQuery = useRouteEfficiency(selectedVehicleId);

  return (
    <View style={styles.root}>
      <EnergyOverviewSection
        vehicle={selectedVehicle}
        vehiclesLoading={vehiclesQuery.isLoading}
        vehiclesError={Boolean(vehiclesQuery.error)}
        energy={energyQuery.data}
        energyLoading={energyQuery.isLoading}
        energyError={Boolean(energyQuery.error)}
        battery={batteryQuery.data}
        batteryLoading={batteryQuery.isLoading}
        batteryError={Boolean(batteryQuery.error)}
      />
      <BatteryHealthSection
        vehicle={selectedVehicle}
        battery={batteryQuery.data}
        degradation={degradationQuery.data}
        isLoading={batteryQuery.isLoading || degradationQuery.isLoading}
        hasError={Boolean(batteryQuery.error || degradationQuery.error)}
      />
      <FleetEnergyAnalyticsSection
        fleet={fleetQuery.data}
        isLoading={fleetQuery.isLoading}
        hasError={Boolean(fleetQuery.error)}
      />
      <OwnershipSleepRegenSection
        vehicle={selectedVehicle}
        tco={tcoQuery.data}
        sleep={sleepQuery.data}
        regen={regenQuery.data}
        isLoading={
          tcoQuery.isLoading || sleepQuery.isLoading || regenQuery.isLoading
        }
        hasError={Boolean(
          tcoQuery.error || sleepQuery.error || regenQuery.error,
        )}
      />
      <DrivingEnergyAnalyticsSection
        vehicle={selectedVehicle}
        speed={speedQuery.data}
        temperature={temperatureQuery.data}
        routes={routeQuery.data}
        isLoading={
          speedQuery.isLoading ||
          temperatureQuery.isLoading ||
          routeQuery.isLoading
        }
        hasError={Boolean(
          speedQuery.error || temperatureQuery.error || routeQuery.error,
        )}
      />
      <OperationsRouteReadiness
        title="Energy and analytics route readiness"
        subtitle="N0006 route parity remains explicit about implemented native summaries and pending product routes."
        items={energyReadinessItems}
      />
    </View>
  );
}

interface EnergyOverviewSectionProps {
  vehicle: Vehicle | null;
  vehiclesLoading: boolean;
  vehiclesError: boolean;
  energy: EnergyStats | undefined;
  energyLoading: boolean;
  energyError: boolean;
  battery: BatteryHealth | undefined;
  batteryLoading: boolean;
  batteryError: boolean;
}

function EnergyOverviewSection({
  vehicle,
  vehiclesLoading,
  vehiclesError,
  energy,
  energyLoading,
  energyError,
  battery,
  batteryLoading,
  batteryError,
}: EnergyOverviewSectionProps) {
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'energy-used',
        label: 'Energy used',
        value: hasEnergyStats(energy)
          ? formatEnergyWh(energy.total_energy_used_wh)
          : '-',
        helper: energyError
          ? 'Energy endpoint unavailable'
          : 'From /vehicles/{id}/energy',
        tone: energyError ? 'warning' : 'accent',
        icon: 'bolt',
      },
      {
        id: 'energy-charged',
        label: 'Charged',
        value: hasEnergyStats(energy)
          ? formatEnergyWh(energy.total_energy_charged_wh ?? energy.total_wh)
          : '-',
        helper: 'Returned charged energy',
        tone: 'success',
        icon: 'batteryCharging',
      },
      {
        id: 'distance',
        label: 'Distance',
        value: hasEnergyStats(energy)
          ? formatDistanceM(energy.total_distance_m)
          : '-',
        helper: 'SI meters converted at render',
        tone: 'neutral',
        icon: 'navigation',
      },
      {
        id: 'battery-health',
        label: 'Health',
        value: battery ? formatPercent(battery.health_score) : '-',
        helper: batteryError
          ? 'Battery endpoint unavailable'
          : 'Battery health score',
        tone: healthTone(battery?.health_score),
        icon: 'heartPulse',
      },
    ],
    [battery, batteryError, energy, energyError],
  );

  return (
    <ScreenSection
      title="Energy and battery overview"
      subtitle={`Native operations overview for ${selectedVehicleLabel(
        vehicle,
      )} using SI-backed endpoints.`}
    >
      {vehiclesLoading && !vehicle ? (
        <OperationsMessage
          title="Loading vehicles"
          message="Resolving a vehicle before querying energy and battery routes."
          tone="loading"
          icon="loading"
        />
      ) : vehiclesError && !vehicle ? (
        <OperationsMessage
          title="Vehicle API unavailable"
          message="Energy parity needs /vehicles before it can query vehicle-scoped analytics."
          tone="error"
          icon="warning"
        />
      ) : !vehicle ? (
        <OperationsMessage
          title="No vehicle selected"
          message="Energy and battery analytics will populate when /vehicles returns at least one vehicle."
          tone="empty"
          icon="vehicle"
        />
      ) : (
        <View style={styles.stack}>
          <View style={styles.statusRow}>
            <StatusPill
              label={
                energyLoading || batteryLoading ? 'Loading' : 'Vehicle selected'
              }
              state={energyError || batteryError ? 'warning' : 'online'}
            />
            <StatusPill
              label={vehicle.state ?? 'unknown'}
              state={vehicle.healthy ? 'online' : 'warning'}
            />
          </View>
          <MetricGrid items={metrics} />
          {!hasEnergyStats(energy) && !energyLoading ? (
            <OperationsMessage
              title={
                energyError
                  ? 'Energy endpoint unavailable'
                  : 'No energy totals returned'
              }
              message={
                energyError
                  ? 'The native screen keeps the section visible until /vehicles/{id}/energy recovers.'
                  : 'Energy totals, cost, and daily breakdown rows will render here when returned.'
              }
              tone={energyError ? 'error' : 'empty'}
              icon="bolt"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}

interface BatteryHealthSectionProps {
  vehicle: Vehicle | null;
  battery: BatteryHealth | undefined;
  degradation: BatteryDegradationAnalytics | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function BatteryHealthSection({
  vehicle,
  battery,
  degradation,
  isLoading,
  hasError,
}: BatteryHealthSectionProps) {
  const batteryTrend = useMemo<ChartSummaryDatum[]>(() => {
    const healthTrend =
      degradation?.monthly_trend?.map(point => ({
        id: point.month,
        label: point.month,
        value: point.avg_health,
        formattedValue: formatPercent(point.avg_health, 1),
        icon: 'battery' as const,
      })) ?? [];

    if (healthTrend.length > 0) {
      return healthTrend.slice(-8);
    }

    return (battery?.monthly_trend ?? []).slice(-8).map(point => ({
      id: point.month,
      label: point.month,
      value: point.capacity_pct,
      formattedValue: formatPercent(point.capacity_pct, 1),
      icon: 'battery' as const,
    }));
  }, [battery?.monthly_trend, degradation?.monthly_trend]);

  const currentHealth = degradation?.current_health ?? battery?.health_score;
  const recommendations = degradation?.recommendations ?? [];

  return (
    <ScreenSection
      title="Battery health and degradation"
      subtitle="Battery capacity, degradation trend, stress signals, and predictive recommendations."
    >
      {!vehicle ? (
        <OperationsMessage
          title="Battery analytics waiting for a vehicle"
          message="Select a vehicle from /vehicles before native battery analytics can query scoped routes."
          tone="empty"
          icon="battery"
        />
      ) : isLoading && !battery && !degradation ? (
        <OperationsMessage
          title="Loading battery analytics"
          message="Fetching /vehicles/{id}/battery and /analytics/battery-degradation."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !battery && !degradation ? (
        <OperationsMessage
          title="Battery analytics unavailable"
          message="Battery health and degradation endpoints will render when the backend is reachable."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'health',
                label: 'Health score',
                value: formatPercent(currentHealth, 1),
                helper: degradation?.stress_level
                  ? `Stress: ${degradation.stress_level}`
                  : 'Current health',
                tone: healthTone(currentHealth),
                icon: 'heartPulse',
              },
              {
                id: 'capacity',
                label: 'Capacity',
                value: formatPercent(
                  battery?.current_capacity_pct ??
                    degradation?.current_capacity,
                  1,
                ),
                helper: degradation?.capacity_source
                  ? `Capacity source ${degradation.capacity_source}`
                  : 'Current battery capacity',
                tone: 'success',
                icon: 'batteryFull',
              },
              {
                id: 'degradation',
                label: 'Degradation',
                value: formatPercent(
                  degradation?.current_degradation ?? battery?.degradation_pct,
                  1,
                ),
                helper: degradation?.projected_80pct_date
                  ? `80% projection ${degradation.projected_80pct_date}`
                  : 'Current degradation',
                tone: 'warning',
                icon: 'trendDown',
              },
              {
                id: 'cycles',
                label: 'Cycles',
                value: formatCount(
                  degradation?.current_cycles ?? battery?.total_cycles,
                ),
                helper: `Range ${formatDistanceKm(
                  degradation?.current_range ??
                    battery?.estimated_range_current_km,
                )}`,
                tone: 'neutral',
                icon: 'recycle',
              },
            ]}
          />
          <ChartSummary
            title="Battery health trend"
            subtitle="Accessible bar summary of returned battery health trend points."
            metricLabel="Current health"
            metricValue={formatPercent(currentHealth, 1)}
            data={batteryTrend}
            emptyLabel="Battery health trend points will appear after the backend returns monthly history."
            icon="trends"
          />
          <View>
            <KeyValueRow
              label="Fast charge ratio"
              value={formatPercent(degradation?.fast_charge_ratio, 1)}
            />
            <KeyValueRow
              label="Cell temperature"
              value={formatTemperatureC(degradation?.current_temp)}
            />
            <KeyValueRow
              label="Battery capacity"
              value={formatEnergyWh(degradation?.battery_capacity_wh)}
            />
          </View>
          {recommendations.length === 0 ? (
            <OperationsMessage
              title="No degradation recommendations"
              message="Predictive recommendations will appear here when /analytics/battery-degradation returns them."
              tone="empty"
              icon="lightbulb"
            />
          ) : (
            <View style={styles.list}>
              {recommendations.slice(0, 4).map((recommendation, index) => (
                <ListRow
                  key={`${recommendation}-${index}`}
                  title={`Recommendation ${index + 1}`}
                  subtitle={recommendation}
                  icon="lightbulb"
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScreenSection>
  );
}

interface FleetEnergyAnalyticsSectionProps {
  fleet: FleetAnalytics | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function FleetEnergyAnalyticsSection({
  fleet,
  isLoading,
  hasError,
}: FleetEnergyAnalyticsSectionProps) {
  const dailyTrend = useMemo<ChartSummaryDatum[]>(
    () =>
      (fleet?.drive_analytics?.daily_trend ?? []).slice(-8).map(point => ({
        id: point.date,
        label: formatShortDate(point.date),
        value: point.efficiency ?? 0,
        formattedValue: formatEfficiencyWhKm(point.efficiency),
        icon: 'efficiency' as const,
      })),
    [fleet?.drive_analytics?.daily_trend],
  );
  const vehicleComparison = fleet?.vehicle_comparison ?? [];

  return (
    <ScreenSection
      title="Fleet energy analytics"
      subtitle="Fleet-wide analytics from /analytics/fleet with native chart summary and list alternatives."
    >
      {isLoading && !fleet ? (
        <OperationsMessage
          title="Loading fleet analytics"
          message="Fetching /analytics/fleet for fleet energy totals and trend summaries."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !fleet ? (
        <OperationsMessage
          title="Fleet analytics unavailable"
          message="Fleet energy analytics will appear when /analytics/fleet is reachable."
          tone="error"
          icon="warning"
        />
      ) : !fleet ? (
        <OperationsMessage
          title="No fleet analytics returned"
          message="Fleet totals, energy, cost, and trend summaries will render here."
          tone="empty"
          icon="analytics"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'fleet-vehicles',
                label: 'Vehicles',
                value: formatCount(fleet.total_vehicles),
                helper: `${formatCount(fleet.total_drives)} drives`,
                tone: 'accent',
                icon: 'vehicle',
              },
              {
                id: 'fleet-cost',
                label: 'Cost',
                value: formatCurrency(fleet.total_cost),
                helper: `${formatCount(
                  fleet.total_charging_sessions,
                )} charge sessions`,
                tone: 'success',
                icon: 'receipt',
              },
              {
                id: 'fleet-distance',
                label: 'Distance',
                value: formatDistanceKm(fleet.total_distance_km),
                helper: 'Fleet distance from analytics',
                tone: 'neutral',
                icon: 'navigation',
              },
              {
                id: 'fleet-efficiency',
                label: 'Efficiency',
                value: formatEfficiencyWhKm(fleet.avg_efficiency_wh_km),
                helper: fleet.most_efficient_vehicle
                  ? `Best: ${fleet.most_efficient_vehicle.name}`
                  : 'Average fleet efficiency',
                tone: 'warning',
                icon: 'efficiency',
              },
            ]}
          />
          <ChartSummary
            title="Daily efficiency trend"
            subtitle="Native summary of returned fleet daily trend efficiency points."
            metricLabel="Average efficiency"
            metricValue={formatEfficiencyWhKm(fleet.avg_efficiency_wh_km)}
            data={dailyTrend}
            emptyLabel="Daily efficiency trend points will appear when /analytics/fleet returns them."
            icon="trends"
          />
          {vehicleComparison.length === 0 ? (
            <OperationsMessage
              title="No vehicle comparison rows"
              message="Vehicle-level analytics rows will appear here when returned by /analytics/fleet."
              tone="empty"
              icon="vehicle"
            />
          ) : (
            <View style={styles.list}>
              {vehicleComparison.slice(0, 5).map(vehicle => (
                <ListRow
                  key={vehicle.id}
                  title={vehicle.name}
                  subtitle={`${formatDistanceKm(
                    vehicle.distance,
                  )} · ${formatCount(vehicle.drives)} drives`}
                  meta={formatEfficiencyWhKm(vehicle.efficiency)}
                  icon="vehicle"
                  detail={
                    <KeyValueRow
                      label="Drives"
                      value={formatCount(vehicle.drives)}
                    />
                  }
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScreenSection>
  );
}

interface OwnershipSleepRegenSectionProps {
  vehicle: Vehicle | null;
  tco: TCOAnalytics | undefined;
  sleep: SleepAnalytics | undefined;
  regen: RegenAnalytics | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function OwnershipSleepRegenSection({
  vehicle,
  tco,
  sleep,
  regen,
  isLoading,
  hasError,
}: OwnershipSleepRegenSectionProps) {
  const savingsTrend = useMemo<ChartSummaryDatum[]>(
    () =>
      (tco?.monthly_breakdown ?? []).slice(-8).map(point => ({
        id: point.month,
        label: point.month,
        value: point.savings,
        formattedValue: formatCurrency(point.savings),
        icon: 'wallet' as const,
      })),
    [tco?.monthly_breakdown],
  );
  const stateDistribution = sleep?.state_distribution ?? [];

  return (
    <ScreenSection
      title="Ownership, sleep, and regen"
      subtitle="TCO, idle/sleep efficiency, and regenerative braking analytics for the selected vehicle."
    >
      {!vehicle ? (
        <OperationsMessage
          title="Ownership analytics waiting for a vehicle"
          message="TCO, sleep, and regen routes require a vehicle_id query parameter."
          tone="empty"
          icon="vehicle"
        />
      ) : isLoading && !tco && !sleep && !regen ? (
        <OperationsMessage
          title="Loading ownership analytics"
          message="Fetching /analytics/tco, /analytics/sleep, and /analytics/regen."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !tco && !sleep && !regen ? (
        <OperationsMessage
          title="Ownership analytics unavailable"
          message="TCO, sleep, and regen sections will render when their analytics endpoints recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'savings',
                label: 'Savings',
                value: formatCurrency(tco?.total_savings),
                helper: `${formatCurrency(tco?.monthly_savings)} monthly`,
                tone: 'success',
                icon: 'wallet',
              },
              {
                id: 'ev-cost',
                label: 'EV cost/km',
                value:
                  tco?.cost_per_km_ev == null ||
                  !Number.isFinite(tco.cost_per_km_ev)
                    ? '-'
                    : formatCurrency(tco.cost_per_km_ev),
                helper: `ICE ${formatCurrency(tco?.cost_per_km_ice)}`,
                tone: 'neutral',
                icon: 'receipt',
              },
              {
                id: 'sleep',
                label: 'Sleep efficiency',
                value: formatPercent(sleep?.sleep_efficiency_pct, 1),
                helper: `${formatCount(
                  sleep?.total_events,
                )} recent idle events`,
                tone:
                  (sleep?.sleep_efficiency_pct ?? 0) >= 85
                    ? 'success'
                    : 'warning',
                icon: 'moon',
              },
              {
                id: 'regen',
                label: 'Regen recovered',
                value: formatEnergyWh(regen?.total_regen_wh),
                helper: `${formatNumber(
                  regen?.free_charges,
                  1,
                )} equivalent full charges`,
                tone: 'success',
                icon: 'recycle',
              },
            ]}
          />
          <ChartSummary
            title="Monthly ownership savings"
            subtitle="Accessible native summary of /analytics/tco monthly savings."
            metricLabel="Total savings"
            metricValue={formatCurrency(tco?.total_savings)}
            data={savingsTrend}
            emptyLabel="Monthly TCO savings rows will appear when /analytics/tco returns them."
            icon="trends"
          />
          {stateDistribution.length === 0 ? (
            <OperationsMessage
              title="No sleep state distribution"
              message="Sleep state rows will appear when /analytics/sleep returns state_distribution."
              tone="empty"
              icon="moon"
            />
          ) : (
            <View style={styles.list}>
              {stateDistribution.slice(0, 5).map(state => (
                <ListRow
                  key={state.state}
                  title={state.state}
                  subtitle={`${formatCount(state.count)} events`}
                  meta={formatDurationSeconds(state.total_minutes * 60)}
                  icon="moon"
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScreenSection>
  );
}

interface DrivingEnergyAnalyticsSectionProps {
  vehicle: Vehicle | null;
  speed: SpeedProfileData | undefined;
  temperature: TemperatureImpactData | undefined;
  routes: RouteEfficiencyData | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function DrivingEnergyAnalyticsSection({
  vehicle,
  speed,
  temperature,
  routes,
  isLoading,
  hasError,
}: DrivingEnergyAnalyticsSectionProps) {
  const speedChart = useMemo<ChartSummaryDatum[]>(
    () =>
      (speed?.distribution ?? []).map(bucket => ({
        id: bucket.speed_bucket,
        label: bucket.speed_bucket,
        value: bucket.readings,
        formattedValue: formatCount(bucket.readings),
        icon: 'speed' as const,
      })),
    [speed?.distribution],
  );
  const tempBuckets = temperature?.efficiency ?? [];
  const topTempBucket = tempBuckets[0] ?? null;
  const routeRows = routes?.routes ?? [];

  return (
    <ScreenSection
      title="Driving energy analytics"
      subtitle="Speed profile, temperature impact, and route efficiency summaries from typed analytics routes."
    >
      {!vehicle ? (
        <OperationsMessage
          title="Driving analytics waiting for a vehicle"
          message="Speed, temperature, and route efficiency analytics require a selected vehicle_id."
          tone="empty"
          icon="vehicle"
        />
      ) : isLoading && !speed && !temperature && !routes ? (
        <OperationsMessage
          title="Loading driving analytics"
          message="Fetching speed profile, temperature impact, and route efficiency endpoints."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !speed && !temperature && !routes ? (
        <OperationsMessage
          title="Driving analytics unavailable"
          message="Driving analytics sections will render once the analytics routes recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'avg-speed',
                label: 'Avg speed',
                value: formatSpeedMps(speed?.avg_speed_mps),
                helper: 'SI m/s converted at render',
                tone: 'accent',
                icon: 'speed',
              },
              {
                id: 'peak-speed',
                label: 'Peak speed',
                value: formatSpeedMps(speed?.peak_speed_mps),
                helper: 'Peak speed profile',
                tone: 'warning',
                icon: 'speedCircle',
              },
              {
                id: 'temperature',
                label: 'Temp bucket',
                value: topTempBucket?.temp_bucket ?? '-',
                helper: topTempBucket
                  ? formatBatteryPctPer100Km(
                      topTempBucket.avg_battery_pct_per_100km,
                    )
                  : 'Temperature impact bucket',
                tone: 'neutral',
                icon: 'weather',
              },
              {
                id: 'routes',
                label: 'Routes',
                value: formatCount(routeRows.length),
                helper: 'Route efficiency rows',
                tone: 'success',
                icon: 'map',
              },
            ]}
          />
          <ChartSummary
            title="Speed profile distribution"
            subtitle="Native accessible speed-bucket summary from /analytics/speed-profile."
            metricLabel="Optimal speed"
            metricValue={formatSpeedMps(speed?.optimal_speed_mps)}
            data={speedChart}
            emptyLabel="Speed profile buckets will appear when /analytics/speed-profile returns data."
            icon="speed"
          />
          <View style={styles.splitList}>
            <View style={styles.splitColumn}>
              {tempBuckets.length === 0 ? (
                <OperationsMessage
                  title="No temperature buckets"
                  message="Temperature impact rows will appear when /analytics/temperature-impact returns data."
                  tone="empty"
                  icon="weather"
                />
              ) : (
                tempBuckets
                  .slice(0, 4)
                  .map(bucket => (
                    <ListRow
                      key={bucket.temp_bucket}
                      title={bucket.temp_bucket}
                      subtitle={`${formatCount(
                        bucket.drive_count,
                      )} drives · ${formatDistanceKm(bucket.avg_distance_km)}`}
                      meta={formatTemperatureC(bucket.avg_temp)}
                      icon="weather"
                    />
                  ))
              )}
            </View>
            <View style={styles.splitColumn}>
              {routeRows.length === 0 ? (
                <OperationsMessage
                  title="No route efficiency rows"
                  message="Route efficiency rows will appear when /analytics/route-efficiency returns data."
                  tone="empty"
                  icon="map"
                />
              ) : (
                routeRows
                  .slice(0, 4)
                  .map(route => (
                    <ListRow
                      key={`${route.start_location}-${route.end_location}`}
                      title={`${route.start_location} -> ${route.end_location}`}
                      subtitle={`${formatCount(
                        route.trip_count,
                      )} trips · ${formatDistanceKm(route.avg_distance_km)}`}
                      meta={formatDurationSeconds(route.avg_duration_s)}
                      icon="map"
                    />
                  ))
              )}
            </View>
          </View>
        </View>
      )}
    </ScreenSection>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  stack: {
    gap: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  splitList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  splitColumn: {
    flex: 1,
    minWidth: 260,
    gap: spacing.sm,
  },
});
