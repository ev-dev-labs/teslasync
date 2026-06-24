import React, {useMemo} from 'react';
import {View} from 'react-native';

import type {Vehicle, VehicleState} from '../../api/types';
import {ListRow} from '../../components/data/ListRow';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {formatLocation, formatPercent, formatPower, formatSpeed} from './formatFleetValue';

interface LiveVehicleRouteSectionProps {
  hasError: boolean;
  isLoading: boolean;
  liveState: VehicleState | null | undefined;
  vehicle: Vehicle | null | undefined;
}

export function LiveVehicleRouteSection({
  hasError,
  isLoading,
  liveState,
  vehicle,
}: LiveVehicleRouteSectionProps) {
  const hasCoordinates =
    Number.isFinite(liveState?.latitude) && Number.isFinite(liveState?.longitude);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'live-route-state',
        label: 'Live state',
        value: liveState?.state ?? (isLoading ? 'loading' : '-'),
        helper: vehicle?.display_name ?? 'No selected vehicle',
        tone: hasError ? 'warning' : liveState ? 'success' : 'neutral',
        icon: 'activity',
      },
      {
        id: 'live-route-location',
        label: 'Coordinates',
        value: formatLocation(liveState?.latitude, liveState?.longitude),
        helper: 'Native coordinate summary, not a WebView map',
        tone: hasCoordinates ? 'accent' : 'neutral',
        icon: 'mapPinned',
      },
      {
        id: 'live-route-speed',
        label: 'Speed',
        value: formatSpeed(liveState?.speed_mps),
        helper: 'SI live telemetry converted at render',
        tone: (liveState?.speed_mps ?? 0) > 0 ? 'accent' : 'neutral',
        icon: 'speed',
      },
      {
        id: 'live-route-power',
        label: 'Power',
        value: formatPower(liveState?.power_w),
        helper: formatPercent(liveState?.battery_level),
        tone: liveState?.is_charging ? 'success' : 'neutral',
        icon: 'power',
      },
    ],
    [hasCoordinates, hasError, isLoading, liveState, vehicle?.display_name],
  );

  return (
    <ScreenSection
      title="Live map route surface"
      subtitle="The /live route renders native live-state and coordinate evidence from /vehicles/{vehicleID}/state without browser maps."
    >
      <MetricGrid items={metrics} minItemWidth={180} />
      <View style={fleetStyles.list}>
        <ListRow
          title="Live route parser"
          subtitle="/live resolves to the Vehicles native target through the typed route manifest."
          meta="live"
          icon="mapPinned"
        />
        <ListRow
          title="Live route data source"
          subtitle={
            hasError
              ? 'Vehicle state API is unavailable; no synthetic location is shown.'
              : 'Uses the selected vehicle state endpoint and preserves empty coordinate states.'
          }
          meta="/vehicles/{vehicleID}/state"
          icon="radio"
        />
      </View>
      {!vehicle && isLoading ? (
        <FleetMessage
          title="Loading live route vehicle"
          message="Resolving a vehicle before rendering /live route evidence."
          tone="loading"
          icon="loading"
        />
      ) : !vehicle ? (
        <FleetMessage
          title="No live route vehicle"
          message="The /live route surface stays visible and waits for /vehicles to return a selectable vehicle."
          tone="empty"
          icon="mapPinned"
        />
      ) : null}
    </ScreenSection>
  );
}
