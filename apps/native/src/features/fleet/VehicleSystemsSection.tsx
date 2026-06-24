import React, { useMemo } from 'react';
import { View } from 'react-native';

import type {
  ClimateLatest,
  MaintenanceItem,
  MediaLatest,
  SafetyLatest,
  SecurityLatest,
  ServiceRecord,
  SoftwareUpdate,
  TirePressureLatest,
  Vehicle,
  VehicleConfigLatest,
  VehicleState,
} from '../../api/types';
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
  formatPressure,
  formatSystemValue,
  formatTemperatureC,
  shortVin,
} from './formatFleetValue';

interface VehicleSystemQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  hasError: boolean;
}

interface VehicleSystemsSectionProps {
  vehicle: Vehicle | null | undefined;
  liveState: VehicleState | null | undefined;
  tirePressure: VehicleSystemQuery<TirePressureLatest>;
  climate: VehicleSystemQuery<ClimateLatest>;
  security: VehicleSystemQuery<SecurityLatest>;
  safety: VehicleSystemQuery<SafetyLatest>;
  media: VehicleSystemQuery<MediaLatest>;
  vehicleConfig: VehicleSystemQuery<VehicleConfigLatest>;
  softwareUpdates: VehicleSystemQuery<SoftwareUpdate[]>;
  maintenanceItems: VehicleSystemQuery<MaintenanceItem[]>;
  serviceRecords: VehicleSystemQuery<ServiceRecord[]>;
}

const knownValue = (value: unknown) => value !== null && value !== undefined;

function hasKnownValues(record: object | undefined): boolean {
  return Boolean(record && Object.values(record).some(knownValue));
}

function knownCount(record: object | undefined): number {
  return record ? Object.values(record).filter(knownValue).length : 0;
}

function formatLockState(
  security: SecurityLatest | undefined,
  liveState: VehicleState | null | undefined,
): string {
  const locked = security?.locked ?? liveState?.is_locked;
  if (locked == null) {
    return '-';
  }
  return locked ? 'Locked' : 'Unlocked';
}

function windowSummary(security: SecurityLatest | undefined): string {
  const windows = [
    security?.fd_window,
    security?.fp_window,
    security?.rd_window,
    security?.rp_window,
  ].filter(knownValue);

  if (windows.length === 0) {
    return '-';
  }

  return windows.map(formatSystemValue).join(' / ');
}

function latestUpdate(updates: SoftwareUpdate[] | undefined) {
  return updates?.[0];
}

export function VehicleSystemsSection({
  vehicle,
  liveState,
  tirePressure,
  climate,
  security,
  safety,
  media,
  vehicleConfig,
  softwareUpdates,
  maintenanceItems,
  serviceRecords,
}: VehicleSystemsSectionProps) {
  const selectedVehicleLabel = vehicle
    ? `${vehicle.display_name || `Vehicle ${vehicle.vehicle_id}`} (${shortVin(
        vehicle.vin,
      )})`
    : 'No selected vehicle';

  return (
    <View style={fleetStyles.root}>
      <VehicleAccessDigitalTwinSection
        vehicle={vehicle}
        liveState={liveState}
        security={security}
        safety={safety}
        vehicleConfig={vehicleConfig}
        selectedVehicleLabel={selectedVehicleLabel}
      />
      <TirePressureRouteSection tirePressure={tirePressure} />
      <ClimateRouteSection climate={climate} />
      <SecurityGuardRouteSection
        liveState={liveState}
        security={security}
        safety={safety}
      />
      <MediaRouteSection media={media} />
      <SoftwareRouteSection
        liveState={liveState}
        vehicleConfig={vehicleConfig}
        softwareUpdates={softwareUpdates}
      />
      <MaintenanceRouteSection
        maintenanceItems={maintenanceItems}
        serviceRecords={serviceRecords}
      />
    </View>
  );
}

function VehicleAccessDigitalTwinSection({
  vehicle,
  liveState,
  security,
  safety,
  vehicleConfig,
  selectedVehicleLabel,
}: {
  vehicle: Vehicle | null | undefined;
  liveState: VehicleState | null | undefined;
  security: VehicleSystemQuery<SecurityLatest>;
  safety: VehicleSystemQuery<SafetyLatest>;
  vehicleConfig: VehicleSystemQuery<VehicleConfigLatest>;
  selectedVehicleLabel: string;
}) {
  const config = vehicleConfig.data;
  const securityData = security.data;
  const safetyData = safety.data;
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'access-lock',
        label: 'Access',
        value: formatLockState(securityData, liveState),
        helper: '/vehicles/:id/access and /security/latest',
        tone:
          securityData?.locked ?? liveState?.is_locked ? 'success' : 'warning',
        icon: securityData?.locked ?? liveState?.is_locked ? 'locked' : 'key',
      },
      {
        id: 'digital-twin-firmware',
        label: 'Firmware',
        value:
          config?.software_version ?? liveState?.software_version ?? 'Unknown',
        helper: 'Digital twin software state',
        tone:
          config?.software_version || liveState?.software_version
            ? 'accent'
            : 'neutral',
        icon: 'cpu',
      },
      {
        id: 'safety-settings',
        label: 'Safety settings',
        value: `${knownCount(safetyData)}/11`,
        helper: '/safety/latest ADAS values',
        tone: safety.hasError
          ? 'warning'
          : knownCount(safetyData) > 0
          ? 'success'
          : 'neutral',
        icon: 'securityCheck',
      },
    ],
    [
      config?.software_version,
      liveState,
      safety.hasError,
      safetyData,
      securityData,
    ],
  );

  return (
    <ScreenSection
      title="Vehicle access and digital twin routes"
      subtitle="Vehicle access, digital twin, firmware, and safety settings render as native state summaries without WebView or unsafe mutations."
    >
      <MetricGrid items={metrics} minItemWidth={180} />
      <View style={fleetStyles.list}>
        <ListRow
          title="Vehicle access route"
          subtitle="Driver, invitation, and unlock workflows are visible as unavailable native actions until command-safe APIs are implemented."
          meta="/vehicles/:id/access"
          icon="key"
          detail={
            <View>
              <KeyValueRow label="Vehicle" value={selectedVehicleLabel} />
              <KeyValueRow
                label="Lock source"
                value={
                  security.hasError
                    ? 'security route unavailable'
                    : '/security/latest'
                }
              />
              <KeyValueRow
                label="Invite management"
                value="Unavailable in native"
              />
            </View>
          }
        />
        <ListRow
          title="Digital twin route"
          subtitle="Native summarizes the typed vehicle model, live powertrain state, firmware, wheel, and color instead of embedding the web 3D scene."
          meta="/digital-twin"
          icon="vehicle"
          detail={
            <View>
              <KeyValueRow
                label="Model"
                value={vehicle?.model ?? config?.car_type ?? '-'}
              />
              <KeyValueRow
                label="Trim"
                value={vehicle?.trim_badging ?? config?.trim_badging ?? '-'}
              />
              <KeyValueRow
                label="Color"
                value={vehicle?.exterior_color ?? config?.exterior_color ?? '-'}
              />
              <KeyValueRow
                label="Wheel"
                value={vehicle?.wheel_type ?? config?.wheel_type ?? '-'}
              />
            </View>
          }
        />
      </View>
      {vehicleConfig.hasError && !hasKnownValues(config) ? (
        <FleetMessage
          title="Vehicle configuration unavailable"
          message="Digital-twin configuration falls back to /vehicles metadata until /vehicle-config/latest is reachable."
          tone="error"
          icon="warning"
        />
      ) : null}
    </ScreenSection>
  );
}

function TirePressureRouteSection({
  tirePressure,
}: {
  tirePressure: VehicleSystemQuery<TirePressureLatest>;
}) {
  const reading = tirePressure.data;
  const hasReading = hasKnownValues(reading);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'tire-front-left',
        label: 'Front left',
        value: formatPressure(reading?.front_left),
        helper: 'TPMS pressure',
        tone: reading?.front_left == null ? 'neutral' : 'success',
        icon: 'tirePressure',
      },
      {
        id: 'tire-front-right',
        label: 'Front right',
        value: formatPressure(reading?.front_right),
        helper: 'TPMS pressure',
        tone: reading?.front_right == null ? 'neutral' : 'success',
        icon: 'tirePressure',
      },
      {
        id: 'tire-rear-left',
        label: 'Rear left',
        value: formatPressure(reading?.rear_left),
        helper: 'TPMS pressure',
        tone: reading?.rear_left == null ? 'neutral' : 'success',
        icon: 'tirePressure',
      },
      {
        id: 'tire-rear-right',
        label: 'Rear right',
        value: formatPressure(reading?.rear_right),
        helper: 'TPMS pressure',
        tone: reading?.rear_right == null ? 'neutral' : 'success',
        icon: 'tirePressure',
      },
    ],
    [reading],
  );

  return (
    <ScreenSection
      title="Tire pressure route"
      subtitle="The /tire-pressure route renders native TPMS readings from /tire-pressure/latest and keeps empty pressure states visible."
    >
      {hasReading ? <MetricGrid items={metrics} minItemWidth={160} /> : null}
      {tirePressure.isLoading && !hasReading ? (
        <FleetMessage
          title="Loading tire pressure"
          message="Fetching latest TPMS values for the selected vehicle."
          tone="loading"
          icon="loading"
        />
      ) : tirePressure.hasError && !hasReading ? (
        <FleetMessage
          title="Tire pressure unavailable"
          message="No synthetic tire values are shown when /tire-pressure/latest fails."
          tone="error"
          icon="warning"
        />
      ) : !hasReading ? (
        <FleetMessage
          title="No tire pressure payload"
          message="The TPMS section remains visible until the selected vehicle emits tire pressure signals."
          tone="empty"
          icon="tirePressure"
        />
      ) : null}
    </ScreenSection>
  );
}

function ClimateRouteSection({
  climate,
}: {
  climate: VehicleSystemQuery<ClimateLatest>;
}) {
  const climateData = climate.data;
  const hasClimate = hasKnownValues(climateData);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'climate-inside',
        label: 'Cabin',
        value: formatTemperatureC(climateData?.inside_temp),
        helper: 'Inside temperature',
        tone: climateData?.inside_temp == null ? 'neutral' : 'accent',
        icon: 'cabin',
      },
      {
        id: 'climate-outside',
        label: 'Outside',
        value: formatTemperatureC(climateData?.outside_temp),
        helper: 'Ambient temperature',
        tone: climateData?.outside_temp == null ? 'neutral' : 'accent',
        icon: 'weather',
      },
      {
        id: 'climate-hvac',
        label: 'HVAC',
        value: formatSystemValue(climateData?.hvac_power),
        helper: formatSystemValue(climateData?.hvac_auto_mode),
        tone: climateData?.hvac_power ? 'success' : 'neutral',
        icon: 'climate',
      },
      {
        id: 'climate-fan',
        label: 'Fan',
        value: formatSystemValue(climateData?.fan_speed),
        helper: 'Latest fan speed',
        tone: climateData?.fan_speed ? 'accent' : 'neutral',
        icon: 'wind',
      },
    ],
    [climateData],
  );

  return (
    <ScreenSection
      title="Climate and climate-control routes"
      subtitle="Climate pages render cabin values, defrost, heater, fan, and unavailable command states from /climate/latest."
    >
      {hasClimate ? <MetricGrid items={metrics} minItemWidth={160} /> : null}
      <View style={fleetStyles.list}>
        <ListRow
          title="Climate control action boundary"
          subtitle="Native shows HVAC state but does not fake preheat, defrost, or seat-heater commands."
          meta="/climate-control"
          icon="climateHot"
          detail={
            <View>
              <KeyValueRow
                label="Driver setpoint"
                value={formatTemperatureC(climateData?.driver_temp_setting)}
              />
              <KeyValueRow
                label="Passenger setpoint"
                value={formatTemperatureC(climateData?.passenger_temp_setting)}
              />
              <KeyValueRow
                label="Rear defrost"
                value={formatSystemValue(climateData?.rear_defrost_enabled)}
              />
              <KeyValueRow
                label="Battery heater"
                value={formatSystemValue(climateData?.battery_heater)}
              />
            </View>
          }
        />
        <ListRow
          title="Cabin protection summary"
          subtitle="Climate keeper, overheat protection, wiper heat, and seat climate settings stay visible even when values are absent."
          meta="/climate"
          icon="sunMoon"
          detail={
            <View>
              <KeyValueRow
                label="Keeper mode"
                value={formatSystemValue(climateData?.climate_keeper_mode)}
              />
              <KeyValueRow
                label="Overheat protection"
                value={formatSystemValue(climateData?.overheat_protection)}
              />
              <KeyValueRow
                label="Wiper heat"
                value={formatSystemValue(climateData?.wiper_heat_enabled)}
              />
              <KeyValueRow
                label="Seat vent"
                value={formatSystemValue(climateData?.seat_vent_enabled)}
              />
            </View>
          }
        />
      </View>
      {climate.isLoading && !hasClimate ? (
        <FleetMessage
          title="Loading climate payload"
          message="Fetching /climate/latest for the selected vehicle."
          tone="loading"
          icon="loading"
        />
      ) : climate.hasError && !hasClimate ? (
        <FleetMessage
          title="Climate payload unavailable"
          message="Climate-control widgets stay disabled when /climate/latest cannot be loaded."
          tone="error"
          icon="warning"
        />
      ) : !hasClimate ? (
        <FleetMessage
          title="No climate payload"
          message="Climate route sections remain visible until Fleet Telemetry emits climate signals."
          tone="empty"
          icon="climate"
        />
      ) : null}
    </ScreenSection>
  );
}

function SecurityGuardRouteSection({
  liveState,
  security,
  safety,
}: {
  liveState: VehicleState | null | undefined;
  security: VehicleSystemQuery<SecurityLatest>;
  safety: VehicleSystemQuery<SafetyLatest>;
}) {
  const securityData = security.data;
  const safetyData = safety.data;
  const hasSecurity =
    hasKnownValues(securityData) || hasKnownValues(safetyData);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'security-lock',
        label: 'Lock state',
        value: formatLockState(securityData, liveState),
        helper: '/security/latest',
        tone:
          securityData?.locked ?? liveState?.is_locked ? 'success' : 'warning',
        icon:
          securityData?.locked ?? liveState?.is_locked ? 'locked' : 'unlocked',
      },
      {
        id: 'security-guard',
        label: 'Guard mode',
        value: formatSystemValue(securityData?.sentry_mode),
        helper: 'Sentry / guard signal',
        tone: securityData?.sentry_mode ? 'success' : 'neutral',
        icon: 'guard',
      },
      {
        id: 'security-doors',
        label: 'Doors',
        value: formatSystemValue(securityData?.door_state),
        helper: 'Door state',
        tone: securityData?.door_state ? 'accent' : 'neutral',
        icon: 'security',
      },
      {
        id: 'security-windows',
        label: 'Windows',
        value: windowSummary(securityData),
        helper: 'Window positions',
        tone: windowSummary(securityData) === '-' ? 'neutral' : 'accent',
        icon: 'securityCheck',
      },
    ],
    [liveState, securityData],
  );

  return (
    <ScreenSection
      title="Security access, guard mode, and safety settings routes"
      subtitle="Security, sentry/guard, door/window, valet, and ADAS safety settings render from /security/latest and /safety/latest."
    >
      {hasSecurity ? <MetricGrid items={metrics} minItemWidth={160} /> : null}
      <View style={fleetStyles.list}>
        <ListRow
          title="Security access route"
          subtitle="Native exposes access state but keeps lock/unlock, valet, and key-management commands unavailable."
          meta="/security-access"
          icon="security"
          detail={
            <View>
              <KeyValueRow
                label="Valet mode"
                value={formatSystemValue(securityData?.valet_mode_enabled)}
              />
              <KeyValueRow
                label="Service mode"
                value={formatSystemValue(securityData?.service_mode)}
              />
              <KeyValueRow
                label="Phone keys"
                value={formatSystemValue(securityData?.paired_phone_key_count)}
              />
              <KeyValueRow
                label="Native commands"
                value="Unavailable without command-safe API"
              />
            </View>
          }
        />
        <ListRow
          title="Safety settings route"
          subtitle="ADAS and PIN-to-drive settings are read-only native evidence; native does not mutate safety controls."
          meta="/safety-settings"
          icon="securityCheck"
          detail={
            <View>
              <KeyValueRow
                label="AEB off"
                value={formatSystemValue(
                  safetyData?.automatic_emergency_braking_off,
                )}
              />
              <KeyValueRow
                label="Blind spot camera"
                value={formatSystemValue(
                  safetyData?.automatic_blind_spot_camera,
                )}
              />
              <KeyValueRow
                label="PIN to drive"
                value={formatSystemValue(safetyData?.pin_to_drive_enabled)}
              />
              <KeyValueRow
                label="Cruise follow distance"
                value={formatSystemValue(safetyData?.cruise_follow_distance)}
              />
            </View>
          }
        />
      </View>
      {(security.hasError || safety.hasError) && !hasSecurity ? (
        <FleetMessage
          title="Security routes unavailable"
          message="Security and safety sections stay visible and no safe-state is assumed when latest endpoints fail."
          tone="error"
          icon="warning"
        />
      ) : !hasSecurity ? (
        <FleetMessage
          title="No security payload"
          message="Security route evidence remains visible until lock, guard, or safety signals are available."
          tone={security.isLoading || safety.isLoading ? 'loading' : 'empty'}
          icon={security.isLoading || safety.isLoading ? 'loading' : 'security'}
        />
      ) : null}
    </ScreenSection>
  );
}

function MediaRouteSection({
  media,
}: {
  media: VehicleSystemQuery<MediaLatest>;
}) {
  const mediaData = media.data;
  const hasMedia = hasKnownValues(mediaData);
  const elapsed = mediaData?.now_playing_elapsed ?? null;
  const duration = mediaData?.now_playing_duration ?? null;

  return (
    <ScreenSection
      title="Media player route"
      subtitle="Media now-playing state renders from /media/latest; playback controls remain explicitly unavailable without command support."
    >
      <View style={fleetStyles.list}>
        <ListRow
          title={mediaData?.now_playing_title ?? 'No media title'}
          subtitle={
            mediaData?.now_playing_artist ??
            'No media payload is exposed for the selected vehicle.'
          }
          meta={formatSystemValue(mediaData?.playback_status)}
          icon="media"
          detail={
            <View>
              <KeyValueRow
                label="Album"
                value={mediaData?.now_playing_album ?? '-'}
              />
              <KeyValueRow
                label="Source"
                value={
                  mediaData?.playback_source ??
                  mediaData?.now_playing_station ??
                  '-'
                }
              />
              <KeyValueRow
                label="Volume"
                value={
                  mediaData?.audio_volume == null
                    ? '-'
                    : `${mediaData.audio_volume}/${
                        mediaData.audio_volume_max ?? '-'
                      }`
                }
              />
              <KeyValueRow
                label="Progress"
                value={
                  elapsed == null && duration == null
                    ? '-'
                    : `${formatSystemValue(elapsed)} / ${formatSystemValue(
                        duration,
                      )}`
                }
              />
            </View>
          }
        />
        <ListRow
          title="Media control boundary"
          subtitle="Play, pause, seek, source, and volume actions are not spoofed by native until typed command routes exist."
          meta="Unavailable action"
          icon="volumeOff"
        />
      </View>
      {media.isLoading && !hasMedia ? (
        <FleetMessage
          title="Loading media payload"
          message="Fetching /media/latest for now-playing state."
          tone="loading"
          icon="loading"
        />
      ) : media.hasError && !hasMedia ? (
        <FleetMessage
          title="Media payload unavailable"
          message="The media player route does not fabricate playback data when /media/latest fails."
          tone="error"
          icon="warning"
        />
      ) : !hasMedia ? (
        <FleetMessage
          title="No media payload"
          message="The media route stays visible with controls unavailable until Fleet Telemetry emits media signals."
          tone="empty"
          icon="media"
        />
      ) : null}
    </ScreenSection>
  );
}

function SoftwareRouteSection({
  liveState,
  vehicleConfig,
  softwareUpdates,
}: {
  liveState: VehicleState | null | undefined;
  vehicleConfig: VehicleSystemQuery<VehicleConfigLatest>;
  softwareUpdates: VehicleSystemQuery<SoftwareUpdate[]>;
}) {
  const updates = softwareUpdates.data ?? [];
  const update = latestUpdate(updates);
  const currentVersion =
    update?.version ??
    vehicleConfig.data?.software_version ??
    liveState?.software_version ??
    '-';

  return (
    <ScreenSection
      title="Software updates and vehicle software routes"
      subtitle="Software update history, current firmware, and vehicle configuration are native summaries from /software-updates and /vehicle-config/latest."
    >
      <MetricGrid
        minItemWidth={180}
        items={[
          {
            id: 'software-version',
            label: 'Current version',
            value: currentVersion,
            helper: 'Latest known firmware',
            tone: currentVersion === '-' ? 'neutral' : 'accent',
            icon: 'package',
          },
          {
            id: 'software-updates',
            label: 'Updates',
            value: updates.length,
            helper: '/software-updates rows',
            tone: updates.length > 0 ? 'success' : 'neutral',
            icon: 'download',
          },
          {
            id: 'software-config',
            label: 'Config fields',
            value: knownCount(vehicleConfig.data),
            helper: '/vehicle-config/latest',
            tone: knownCount(vehicleConfig.data) > 0 ? 'success' : 'neutral',
            icon: 'settings',
          },
        ]}
      />
      <View style={fleetStyles.list}>
        {updates.slice(0, 3).map(row => (
          <ListRow
            key={row.id}
            title={row.version}
            subtitle={formatDateTime(
              row.installed_at ?? row.scheduled_at ?? row.created_at,
            )}
            meta={row.status}
            icon="package"
          />
        ))}
        {updates.length === 0 ? (
          <ListRow
            title="No software update history"
            subtitle="The route still shows firmware and vehicle-config state when the update history table is empty."
            meta="/software-updates"
            icon="package"
          />
        ) : null}
        <ListRow
          title="Software action boundary"
          subtitle="Install, schedule, and release-note AI summarization actions remain unavailable in native instead of claiming success."
          meta="Unavailable action"
          icon="download"
        />
      </View>
      {softwareUpdates.hasError && updates.length === 0 ? (
        <FleetMessage
          title="Software update history unavailable"
          message="Firmware falls back to live vehicle state; no update rows are invented."
          tone="error"
          icon="warning"
        />
      ) : null}
    </ScreenSection>
  );
}

function MaintenanceRouteSection({
  maintenanceItems,
  serviceRecords,
}: {
  maintenanceItems: VehicleSystemQuery<MaintenanceItem[]>;
  serviceRecords: VehicleSystemQuery<ServiceRecord[]>;
}) {
  const items = maintenanceItems.data ?? [];
  const records = serviceRecords.data ?? [];
  const soonCount = items.filter(item => item.status === 'soon').length;
  const overdueCount = items.filter(item => item.status === 'overdue').length;

  return (
    <ScreenSection
      title="Maintenance route"
      subtitle="The maintenance route renders the deterministic service schedule and records baseline from /maintenance and /maintenance/records."
    >
      <MetricGrid
        minItemWidth={180}
        items={[
          {
            id: 'maintenance-total',
            label: 'Items',
            value: items.length,
            helper: 'Maintenance reminders',
            tone: items.length > 0 ? 'success' : 'neutral',
            icon: 'maintenance',
          },
          {
            id: 'maintenance-soon',
            label: 'Due soon',
            value: soonCount,
            helper: 'Soon status rows',
            tone: soonCount > 0 ? 'warning' : 'neutral',
            icon: 'calendarClock',
          },
          {
            id: 'maintenance-overdue',
            label: 'Overdue',
            value: overdueCount,
            helper: 'Overdue status rows',
            tone: overdueCount > 0 ? 'danger' : 'success',
            icon: 'warning',
          },
          {
            id: 'service-records',
            label: 'Records',
            value: records.length,
            helper: 'Service history rows',
            tone: records.length > 0 ? 'accent' : 'neutral',
            icon: 'history',
          },
        ]}
      />
      <View style={fleetStyles.list}>
        {items.slice(0, 4).map(item => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={item.description}
            meta={item.status}
            icon="maintenance"
            detail={
              <View>
                <KeyValueRow label="Category" value={item.category} />
                <KeyValueRow label="Due date" value={item.due_date ?? '-'} />
                <KeyValueRow
                  label="Due distance"
                  value={formatDistance(item.due_mileage)}
                />
                <KeyValueRow
                  label="Current distance"
                  value={formatDistance(item.current_mileage)}
                />
              </View>
            }
          />
        ))}
        {items.length === 0 ? (
          <ListRow
            title="No maintenance items"
            subtitle="The maintenance section stays visible when the baseline schedule returns no rows."
            meta="/maintenance"
            icon="maintenance"
          />
        ) : null}
        <ListRow
          title="Maintenance action boundary"
          subtitle="Native does not create service records or invoke predictive-maintenance AI until those write/streaming surfaces are implemented."
          meta="Unavailable action"
          icon="stethoscope"
        />
      </View>
      {maintenanceItems.hasError && items.length === 0 ? (
        <FleetMessage
          title="Maintenance schedule unavailable"
          message="No due dates or service costs are fabricated when /maintenance cannot be loaded."
          tone="error"
          icon="warning"
        />
      ) : serviceRecords.hasError && records.length === 0 ? (
        <FleetMessage
          title="Service records unavailable"
          message="Service history remains empty until /maintenance/records returns rows."
          tone="error"
          icon="warning"
        />
      ) : null}
    </ScreenSection>
  );
}
