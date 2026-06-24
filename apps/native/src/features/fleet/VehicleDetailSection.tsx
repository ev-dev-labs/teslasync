import React, {useMemo} from 'react';
import {View} from 'react-native';

import type {Vehicle, VehicleState} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {AppText} from '../../components/ui/AppText';
import {StatusPill} from '../../components/ui/StatusPill';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {
  formatLocation,
  formatPercent,
  formatPower,
  shortVin,
} from './formatFleetValue';

interface VehicleDetailSectionProps {
  vehicle: Vehicle | null | undefined;
  liveState: VehicleState | null | undefined;
  isLoading: boolean;
  hasDetailError: boolean;
  hasStateError: boolean;
}

export function VehicleDetailSection({
  vehicle,
  liveState,
  isLoading,
  hasDetailError,
  hasStateError,
}: VehicleDetailSectionProps) {
  const statusState = vehicle?.healthy === false || hasDetailError ? 'warning' : 'online';
  const statusLabel =
    vehicle?.healthy === false ? 'Needs attention' : liveState?.state ?? vehicle?.state ?? 'Ready';
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'battery',
        label: 'Battery',
        value: formatPercent(liveState?.battery_level),
        helper: liveState?.is_charging ? 'Charging now' : 'Latest state endpoint',
        tone: liveState?.is_charging ? 'success' : 'neutral',
        icon: liveState?.is_charging ? 'batteryCharging' : 'battery',
      },
      {
        id: 'power',
        label: 'Power',
        value: formatPower(liveState?.power_w),
        helper: 'Instant traction or charging power',
        tone: (liveState?.power_w ?? 0) > 0 ? 'warning' : 'neutral',
        icon: 'power',
      },
      {
        id: 'location',
        label: 'Location',
        value: formatLocation(liveState?.latitude, liveState?.longitude),
        helper: 'Coordinate summary, not a WebView map',
        tone:
          liveState?.latitude != null && liveState?.longitude != null
            ? 'accent'
            : 'neutral',
        icon: 'mapPinned',
      },
    ],
    [liveState],
  );

  return (
    <ScreenSection
      title="Vehicle detail shell"
      subtitle="Selected vehicle detail route with typed metadata, live state, and honest fallback states.">
      {!vehicle && isLoading ? (
        <FleetMessage
          title="Loading vehicle detail"
          message="Resolving the selected vehicle and current state surfaces."
          tone="loading"
        />
      ) : !vehicle ? (
        <FleetMessage
          title="No selected vehicle"
          message="Select a vehicle from the garage once /vehicles returns data."
          tone="empty"
          icon="vehicle"
        />
      ) : (
        <View style={fleetStyles.detailStack}>
          <View style={fleetStyles.detailHeader}>
            <View style={fleetStyles.detailCopy}>
              <AppText variant="title" weight="bold">
                {vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`}
              </AppText>
              <AppText tone="secondary">
                {[vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') ||
                  'Tesla vehicle'}
              </AppText>
            </View>
            <StatusPill label={statusLabel} state={statusState} />
          </View>
          <MetricGrid items={metrics} minItemWidth={180} />
          <View>
            <KeyValueRow label="VIN" value={shortVin(vehicle.vin)} />
            <KeyValueRow label="Wheel type" value={vehicle.wheel_type || '-'} />
            <KeyValueRow label="Firmware" value={liveState?.software_version ?? '-'} />
            <KeyValueRow
              label="Locked"
              value={liveState?.is_locked == null ? '-' : liveState.is_locked ? 'Yes' : 'No'}
            />
            <KeyValueRow label="Timezone" value={vehicle.timezone ?? '-'} />
          </View>
          {hasDetailError || hasStateError ? (
            <FleetMessage
              title="Partial vehicle detail"
              message="Static metadata is shown when available; one or more detail endpoints are unavailable."
              tone="error"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}
