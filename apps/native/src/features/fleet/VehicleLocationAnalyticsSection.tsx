import React, { useMemo } from 'react';
import { View } from 'react-native';

import type {
  FleetAnalytics,
  Geofence,
  MaintenanceItem,
  Vehicle,
  VehicleState,
  VisitedLocation,
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
import { FleetMessage } from './FleetMessage';
import { fleetStyles } from './fleetStyles';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatLocation,
  formatPower,
  formatSpeed,
} from './formatFleetValue';

interface VehicleLocationAnalyticsSectionProps {
  fleet: FleetAnalytics | undefined;
  geofences: Geofence[];
  hasError: boolean;
  isLoading: boolean;
  liveState: VehicleState | undefined;
  locations: VisitedLocation[];
  maintenanceItems: MaintenanceItem[];
  vehicle: Vehicle | null | undefined;
  vehicles: Vehicle[];
}

function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return new Intl.NumberFormat().format(value);
}

function formatDistanceKm(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return formatDistance(value * 1000);
}

function drivetrainLabel(
  vehicle: Vehicle | null | undefined,
  liveState: VehicleState | undefined,
) {
  if (!vehicle) {
    return 'No vehicle selected';
  }

  if (!vehicle.healthy) {
    return 'Attention';
  }

  return liveState?.state ?? vehicle.state ?? 'Healthy';
}

export function VehicleLocationAnalyticsSection({
  fleet,
  geofences,
  hasError,
  isLoading,
  liveState,
  locations,
  maintenanceItems,
  vehicle,
  vehicles,
}: VehicleLocationAnalyticsSectionProps) {
  const vehicleComparison = fleet?.vehicle_comparison ?? [];
  const openMaintenance = maintenanceItems.filter(
    item => item.status !== 'completed' && item.status !== 'good',
  );
  const locationVisitData = useMemo<ChartSummaryDatum[]>(
    () =>
      locations.slice(0, 8).map(location => ({
        id: String(location.id),
        label: location.address_name,
        value: location.visit_count,
        formattedValue: formatCount(location.visit_count),
        icon: 'location' as const,
      })),
    [locations],
  );
  const geofenceRadiusData = useMemo<ChartSummaryDatum[]>(
    () =>
      geofences.slice(0, 8).map(geofence => ({
        id: String(geofence.id),
        label: geofence.name,
        value: geofence.radius,
        formattedValue: formatDistance(geofence.radius),
        icon: 'fence' as const,
      })),
    [geofences],
  );
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'r0004-locations',
        label: 'Locations',
        value: isLoading && locations.length === 0 ? '-' : locations.length,
        helper: 'Visited places from /locations',
        tone: locations.length > 0 ? 'accent' : 'neutral',
        icon: 'location',
      },
      {
        id: 'r0004-geofences',
        label: 'Geofences',
        value: geofences.length,
        helper: `${
          geofences.filter(geofence => geofence.enabled).length
        } enabled`,
        tone: geofences.length > 0 ? 'success' : 'neutral',
        icon: 'fence',
      },
      {
        id: 'r0004-comparison',
        label: 'Vehicle comparison',
        value: vehicleComparison.length || vehicles.length,
        helper: vehicleComparison.length
          ? '/analytics/fleet rows'
          : 'Vehicle metadata fallback',
        tone: vehicleComparison.length > 0 ? 'success' : 'accent',
        icon: 'gitCompare',
      },
      {
        id: 'r0004-drivetrain',
        label: 'Drivetrain health',
        value: drivetrainLabel(vehicle, liveState),
        helper:
          openMaintenance.length > 0
            ? `${openMaintenance.length} maintenance items need attention`
            : 'Live state and maintenance inputs',
        tone:
          openMaintenance.length > 0 || vehicle?.healthy === false
            ? 'warning'
            : 'success',
        icon: 'activity',
      },
    ],
    [
      geofences,
      isLoading,
      liveState,
      locations.length,
      openMaintenance.length,
      vehicle,
      vehicleComparison.length,
      vehicles.length,
    ],
  );

  return (
    <ScreenSection
      title="R0004 locations and fleet comparison routes"
      subtitle="Geofences, locations, drivetrain health, and vehicle-comparison routes render typed native summaries without WebView maps."
    >
      <MetricGrid items={metrics} minItemWidth={180} />
      <ChartSummary
        title="Visited locations summary"
        subtitle="Native data summary for /locations using visit counts and durations returned by the API."
        metricLabel="Selected location"
        metricValue={locations[0]?.address_name ?? '-'}
        data={locationVisitData}
        emptyLabel={
          hasError
            ? 'Visited locations are unavailable for the selected vehicle.'
            : 'Visited locations will appear when /locations returns rows.'
        }
        icon="location"
        sourceLabel="/locations?vehicle_id={vehicleID}"
        parityStatusLabel="R0004 locations"
      />
      <ChartSummary
        title="Geofence radius summary"
        subtitle="Native geofence data alternative with centroid, radius, and alert flags from /geofences."
        metricLabel="Geofences"
        metricValue={String(geofences.length)}
        data={geofenceRadiusData}
        emptyLabel={
          hasError
            ? 'Geofences are unavailable.'
            : 'Geofence rows will appear when /geofences returns configured zones.'
        }
        icon="fence"
        sourceLabel="/geofences"
        parityStatusLabel="R0004 geofences"
      />
      <View style={fleetStyles.detailStack}>
        <View>
          <KeyValueRow
            label="Selected vehicle location"
            value={formatLocation(liveState?.latitude, liveState?.longitude)}
          />
          <KeyValueRow
            label="Live speed"
            value={formatSpeed(liveState?.speed_mps)}
          />
          <KeyValueRow
            label="Live power"
            value={formatPower(liveState?.power_w)}
          />
          <KeyValueRow
            label="Vehicle state"
            value={liveState?.state ?? vehicle?.state ?? '-'}
          />
        </View>
        {locations.length === 0 ? (
          <FleetMessage
            title={
              isLoading ? 'Loading visited locations' : 'No visited locations'
            }
            message={
              hasError
                ? 'Location rows will appear when /locations is reachable.'
                : 'Location parity stays visible and does not invent favorite places.'
            }
            tone={hasError ? 'error' : isLoading ? 'loading' : 'empty'}
            icon="location"
          />
        ) : (
          <View style={fleetStyles.list}>
            {locations.slice(0, 5).map(location => (
              <ListRow
                key={location.id}
                title={location.address_name}
                subtitle={`${formatCount(
                  location.visit_count,
                )} visits - ${formatDuration(location.total_duration_s)}`}
                meta={formatDateTime(location.last_visited)}
                icon="location"
                detail={
                  <View>
                    <KeyValueRow
                      label="Vehicle id"
                      value={location.vehicle_id}
                    />
                    <KeyValueRow
                      label="Address id"
                      value={location.address_id ?? '-'}
                    />
                  </View>
                }
              />
            ))}
          </View>
        )}
        {vehicleComparison.length > 0 ? (
          <View style={fleetStyles.list}>
            {vehicleComparison.slice(0, 5).map(row => (
              <ListRow
                key={row.id}
                title={row.name}
                subtitle={`${formatDistanceKm(row.distance)} - ${formatCount(
                  row.drives,
                )} drives`}
                meta={`${row.efficiency.toFixed(0)} Wh/km`}
                icon="gitCompare"
                detail={
                  <KeyValueRow
                    label="Energy"
                    value={`${row.energy.toFixed(1)} kWh`}
                  />
                }
              />
            ))}
          </View>
        ) : (
          <FleetMessage
            title={
              isLoading
                ? 'Loading vehicle comparison'
                : 'No analytics comparison rows'
            }
            message="Vehicle-comparison parity falls back to real vehicle metadata until /analytics/fleet returns vehicle_comparison rows."
            tone={hasError ? 'error' : isLoading ? 'loading' : 'empty'}
            icon="gitCompare"
          />
        )}
      </View>
    </ScreenSection>
  );
}
