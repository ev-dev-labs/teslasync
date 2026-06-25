import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  FAST: 30_000,
  SLOW: 5 * 60_000,
  RARE: 60 * 60_000,
  DAILY: 24 * 60 * 60_000,
  STATIC: Infinity,
} as const;

const AS_OF_QUERY_PARAM = 'as_of';

export const nativeVehiclesHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  asOfDateUrlStateAvailable: false,
  vehicleStateAsOfMode: 'live-state-only',
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

export interface Vehicle {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  model: string;
  trim_badging: string;
  exterior_color: string;
  wheel_type: string;
  state: string;
  healthy: boolean;
  timezone?: string;
  created_at: string;
  updated_at: string;
  battery_level?: number;
  battery_range?: number;
  odometer?: number;
  latitude?: number;
  longitude?: number;
  charging_state?: string;
  vehicleId?: number;
  displayName?: string;
  trimBadging?: string;
  exteriorColor?: string;
  wheelType?: string;
  createdAt?: string;
  updatedAt?: string;
  batteryLevel?: number;
  batteryRange?: number;
  chargingState?: string;
}

export interface VehicleState {
  vehicle_id: number;
  state: string;
  since?: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed: number;
  power: number;
  battery_level: number;
  rated_range: number;
  ideal_range: number;
  odometer: number;
  inside_temp: number;
  outside_temp: number;
  is_climate_on: boolean;
  is_charging: boolean;
  charger_power: number;
  charge_rate: number;
  time_to_full_charge: number;
  is_locked: boolean;
  sentry_mode: boolean;
  software_version: string;
}

export interface Position {
  vehicle_id: number;
  ts: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed_mph: number | null;
  elevation_m: number | null;
  gps_state: string | null;
  source: string;
}

export interface TirePressureSnapshot {
  id: number;
  vehicle_id: number;
  front_left: number | null;
  front_right: number | null;
  rear_left: number | null;
  rear_right: number | null;
  tpms_hard_warnings?: string;
  tpms_soft_warnings?: string;
  last_seen_time_fl?: string;
  last_seen_time_fr?: string;
  last_seen_time_rl?: string;
  last_seen_time_rr?: string;
  created_at: string;
}

export interface MotorSnapshot {
  id?: number;
  ts: string;
  created_at: string;
  vehicle_id?: number;
  torque_nm_front: number | null;
  torque_nm_rear: number | null;
  di_torque: number | null;
  motor_rpm_front: number | null;
  motor_rpm_rear: number | null;
  motor_temp_c_front: number | null;
  motor_temp_c_rear: number | null;
  inverter_temp_c: number | null;
  inverter_temp_rear: number | null;
  heatsink_temp_front: number | null;
  heatsink_temp_rear: number | null;
  motor_current_front: number | null;
  motor_current_rear: number | null;
  state_front: string | null;
  state_rear: string | null;
  shift_state: string | null;
  vbat_front: number | null;
  vbat_rear: number | null;
  power_kw?: number | null;
  regen_kw?: number | null;
  battery_temp_c?: number | null;
  source?: string | null;
  di_stator_temp?: number | null;
  gear?: string | null;
}

export interface DriveDynamicsSnapshot {
  lateral_acceleration?: number | null;
  longitudinal_acceleration?: number | null;
  pedal_position?: number | null;
  brake_pedal_position?: number | null;
  brake_pedal_active?: boolean | null;
}

export interface ClimateSnapshot {
  vehicle_id: number;
  ts: string;
  inside_temp_c: number | null;
  outside_temp_c: number | null;
  driver_setpoint_c: number | null;
  passenger_setpoint_c: number | null;
  hvac_state: string | null;
  defrost_mode: string | null;
  is_climate_on: boolean | null;
  is_preconditioning: boolean | null;
  fan_status: number | null;
  seat_heater_left: number | null;
  seat_heater_right: number | null;
  seat_heater_rear_left: number | null;
  seat_heater_rear_right: number | null;
  steering_wheel_heater: boolean | null;
  cabin_overheat_protection: boolean | null;
  source: string;
  inside_temp?: number | null;
  outside_temp?: number | null;
  driver_temp_setting?: number | null;
  passenger_temp_setting?: number | null;
  hvac_power?: number | null;
  is_ac_on?: boolean | null;
  hvac_ac_enabled?: boolean | null;
  hvac_fan_status?: number | null;
  hvac_fan_speed?: number | null;
  hvac_steering_wheel_heat_level?: number | null;
  battery_heater?: boolean | null;
  battery_heater_on?: boolean | null;
  seat_heater_rear_center?: number | null;
}

export interface SecurityEvent {
  vehicle_id: number;
  ts: string;
  event_type: string;
  doors_open: string | null;
  windows_open: string | null;
  locked: boolean | null;
  sentry_mode: boolean | null;
  user_present: boolean | null;
  detail: string | null;
  source: string;
  id?: number;
  created_at: string;
  door_state?: string | boolean | null;
  fd_window?: string | boolean | null;
  fp_window?: string | boolean | null;
  rd_window?: string | boolean | null;
  rp_window?: string | boolean | null;
  driver_seat_belt?: boolean | null;
  passenger_seat_belt?: boolean | null;
  driver_seat_occupied?: boolean | null;
  lights_high_beams?: boolean | null;
  lights_hazards_active?: boolean | null;
  lights_turn_signal?: string | null;
}

export interface ChargingTelemetry {
  vehicle_id: number;
  ts: string;
  session_id: number | null;
  battery_level: number | null;
  battery_range_mi: number | null;
  charging_state: string | null;
  charger_voltage: number | null;
  charger_actual_current: number | null;
  charger_power_w: number | null;
  charger_phases: number | null;
  charge_energy_added_wh: number | null;
  range_added_meters: number | null;
  range_added_meters_per_hour: number | null;
  charger_pilot_current: number | null;
  scheduled_charging_at: string | null;
  source: string;
  bms_fullcharge_complete?: boolean | null;
  module_temp_max?: number | null;
  module_temp_min?: number | null;
  num_module_temp_max?: number | null;
  num_module_temp_min?: number | null;
  battery_heater_on?: boolean | null;
  lifetime_energy_used?: number | null;
  expected_energy_pct_at_arrival?: number | null;
  not_enough_power_to_heat?: boolean | null;
  charge_port_door_open?: boolean | null;
}

export interface MediaSnapshot {
  id: number;
  vehicle_id: number;
  now_playing_title?: string;
  now_playing_artist?: string;
  now_playing_album?: string;
  now_playing_station?: string;
  now_playing_duration?: number;
  now_playing_elapsed?: number;
  playback_status?: string;
  playback_source?: string;
  audio_volume?: number;
  audio_volume_max?: number;
  audio_volume_increment?: number;
  created_at: string;
}

export interface VehicleConfigSnapshot {
  id: number;
  vehicle_id: number;
  car_type?: string;
  trim?: string;
  exterior_color?: string;
  roof_color?: string;
  wheel_type?: string;
  rear_seat_heaters?: string;
  sunroof_installed?: string;
  efficiency_package?: string;
  europe_vehicle?: boolean;
  right_hand_drive?: boolean;
  remote_start_enabled?: boolean;
  charge_port?: string;
  offroad_lightbar_present?: boolean;
  version?: string;
  vehicle_name?: string;
  software_update_version?: string;
  software_update_download_pct?: number;
  software_update_install_pct?: number;
  software_update_expected_duration?: number;
  software_update_scheduled_start?: string;
  created_at: string;
}

export interface LocationSnapshot {
  id: number;
  vehicle_id?: number;
  latitude?: number;
  longitude?: number;
  heading?: number;
  gps_state?: string;
  elevation_m?: number;
  speed_mph?: number;
  destination_name?: string;
  miles_to_arrival?: number;
  minutes_to_arrival?: number;
  route_traffic_delay_s?: number;
  route_last_updated?: string;
  destination_lat?: number;
  destination_lon?: number;
  origin_lat?: number;
  origin_lon?: number;
  located_at_home?: boolean;
  located_at_work?: boolean;
  located_at_favorite?: boolean;
  homelink_nearby?: boolean;
  created_at: string;
}

export interface UserPreferenceSnapshot {
  id: number;
  vehicle_id: number;
  setting_24hr_time?: boolean;
  setting_charge_unit?: string;
  setting_distance_unit?: string;
  setting_temperature_unit?: string;
  setting_tire_pressure_unit?: string;
  created_at: string;
}

export const VEHICLE_STATUSES = [
  'online',
  'driving',
  'charging',
  'parked',
  'updating',
  'asleep',
  'offline',
] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export function deriveVehicleStatus(
  state?: Pick<VehicleState, 'is_charging' | 'speed' | 'state'> | null,
): VehicleStatus {
  if (!state) {
    return 'offline';
  }
  if (state.is_charging) {
    return 'charging';
  }
  if (state.speed && state.speed > 0) {
    return 'driving';
  }

  const currentState = (state.state ?? '').toLowerCase();
  if ((VEHICLE_STATUSES as readonly string[]).includes(currentState)) {
    return currentState as VehicleStatus;
  }

  return 'online';
}

export const getVehicleStatus = deriveVehicleStatus;

export const vehicleKeys = {
  all: ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
  state: (id: number, asOf?: string | null) =>
    asOf
      ? (['vehicle-state', id, asOf] as const)
      : (['vehicle-state', id] as const),
  positions: (id: number) => ['vehicle-positions', id] as const,
};

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

function useAsOfDate(): {asOf: string | null} {
  return {asOf: null};
}

function withAsOf(path: string, asOf: string | null): string {
  if (!asOf) {
    return path;
  }
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${AS_OF_QUERY_PARAM}=${encodeURIComponent(asOf)}`;
}

interface VehicleInfoEnvelope<T> {
  data: T | null;
  fetched_at: string | null;
}

interface MobileEnabledData {
  enabled: boolean;
}

interface VehicleStatePositionPayload {
  latitude?: number | null;
  longitude?: number | null;
  heading?: number | null;
  speed?: number | null;
  power?: number | null;
  battery_level?: number | null;
  rated_range?: number | null;
  ideal_range?: number | null;
  odometer?: number | null;
  inside_temp?: number | null;
  outside_temp?: number | null;
  is_climate_on?: boolean | null;
}

interface VehicleStateVehiclePayload {
  id?: number | null;
  state?: string | null;
  is_locked?: boolean | null;
  software_version?: string | null;
}

interface VehicleStateEnvelope {
  state?: VehicleState | string | null;
  live?: boolean | null;
  vehicle?: VehicleStateVehiclePayload | null;
  position?: VehicleStatePositionPayload | null;
  is_charging?: boolean | null;
  charger_power?: number | null;
  charge_rate?: number | null;
  time_to_full_charge?: number | null;
  is_locked?: boolean | null;
  sentry_mode?: boolean | null;
  software_version?: string | null;
}

export interface VehicleStateResult {
  state?: VehicleState | string | null;
  live: boolean;
}

function isVehicleState(value: VehicleState | string | null | undefined): value is VehicleState {
  return value != null && typeof value === 'object' && 'vehicle_id' in value;
}

function normalizeVehicleStateResponse(
  res: VehicleStateEnvelope,
  vehicleId: number,
): VehicleStateResult {
  if (isVehicleState(res.state)) {
    return {state: res.state, live: res.live ?? false};
  }

  const vehicle = res.vehicle;
  const position = res.position;
  if (vehicle == null && position == null) {
    return {state: res.state, live: res.live ?? false};
  }

  const state: VehicleState = {
    vehicle_id: vehicle?.id ?? vehicleId,
    state: vehicle?.state ?? 'offline',
    latitude: position?.latitude ?? 0,
    longitude: position?.longitude ?? 0,
    heading: position?.heading ?? null,
    speed: position?.speed ?? 0,
    power: position?.power ?? 0,
    battery_level: position?.battery_level ?? 0,
    rated_range: position?.rated_range ?? position?.ideal_range ?? 0,
    ideal_range: position?.ideal_range ?? 0,
    odometer: position?.odometer ?? 0,
    inside_temp: position?.inside_temp ?? 0,
    outside_temp: position?.outside_temp ?? 0,
    is_climate_on: position?.is_climate_on ?? false,
    is_charging: res.is_charging ?? false,
    charger_power: res.charger_power ?? 0,
    charge_rate: res.charge_rate ?? 0,
    time_to_full_charge: res.time_to_full_charge ?? 0,
    is_locked: res.is_locked ?? vehicle?.is_locked ?? true,
    sentry_mode: res.sentry_mode ?? false,
    software_version: res.software_version ?? vehicle?.software_version ?? '',
  };

  return {state, live: res.live ?? false};
}

export function useVehicles() {
  return useQuery({
    queryKey: vehicleKeys.all,
    queryFn: ({signal}) => request<Vehicle[]>('/vehicles', {signal}),
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: ({signal}) => request<Vehicle>(`/vehicles/${id}`, {signal}),
    enabled: !!id,
  });
}

export function useVehicleState(
  vehicleId: number,
  options?: {refetchInterval?: number},
) {
  const {asOf} = useAsOfDate();
  return useQuery({
    queryKey: vehicleKeys.state(vehicleId, asOf),
    queryFn: async ({signal}) => {
      const res = await request<VehicleStateEnvelope>(
        withAsOf(`/vehicles/${vehicleId}/state`, asOf),
        {signal},
      );
      return normalizeVehicleStateResponse(res, vehicleId);
    },
    enabled: vehicleId > 0,
    refetchInterval: asOf
      ? false
      : (options?.refetchInterval ?? INTERVALS.STANDARD),
  });
}

export function useVehiclePositions(vehicleId: number, limit = 100) {
  return useQuery({
    queryKey: vehicleKeys.positions(vehicleId),
    queryFn: ({signal}) =>
      request<Position[]>(`/vehicles/${vehicleId}/positions?limit=${limit}`, {
        signal,
      }),
    enabled: vehicleId > 0,
    select: safeArray,
  });
}

export function useRefreshVehicle() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: string) =>
      request<Vehicle>(`/vehicles/${id}/wake`, {method: 'POST'}),
    onSuccess: (data, id) => {
      queryClient.setQueryData(vehicleKeys.detail(id), data);
      invalidateAndBroadcast(queryClient, {queryKey: vehicleKeys.all});
      success('toast.vehicles.refresh.success', 'Vehicle refreshed');
    },
    onError: e =>
      error(e, 'toast.vehicles.refresh.error', 'Failed to refresh vehicle'),
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/vehicles/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, {queryKey: vehicleKeys.all});
      success('toast.vehicles.delete.success', 'Vehicle deleted');
    },
    onError: e =>
      error(e, 'toast.vehicles.delete.error', 'Failed to delete vehicle'),
  });
}

export function useSyncVehicles() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<{synced: number; vehicles: Vehicle[]}>('/vehicles/sync', {
        method: 'POST',
      }),
    onSuccess: data => {
      invalidateAndBroadcast(queryClient, {queryKey: vehicleKeys.all});
      success('toast.vehicles.sync.success', 'Vehicles synced ({{count}} updated)', {
        count: data.synced,
      });
    },
    onError: e =>
      error(e, 'toast.vehicles.sync.error', 'Failed to sync vehicles'),
  });
}

export function useWakeVehicle() {
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{status: string}>(`/vehicles/${id}/wake`, {method: 'POST'}),
    onSuccess: () => {
      success('toast.vehicles.wake.success', 'Wake command sent');
    },
    onError: e =>
      error(e, 'toast.vehicles.wake.error', 'Failed to wake vehicle'),
  });
}

export function useMotorLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: ({signal}) =>
      request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useMotorHistory(vehicleId: number, limit = 200) {
  return useQuery({
    queryKey: ['motor-history', vehicleId, limit],
    queryFn: ({signal}) =>
      request<MotorSnapshot[]>(`/motor?vehicle_id=${vehicleId}&limit=${limit}`, {
        signal,
      }),
    enabled: vehicleId > 0,
    select: safeArray,
  });
}

export function useDriveDynamicsLatest(
  vehicleId: number,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ['drive-dynamics-latest', vehicleId],
    queryFn: ({signal}) =>
      request<DriveDynamicsSnapshot | null>(
        `/drive-dynamics/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useClimateLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: ({signal}) =>
      request<ClimateSnapshot | null>(
        `/climate/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useSecurityLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: ({signal}) =>
      request<SecurityEvent | null>(
        `/security/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useLatestTirePressure(
  vehicleId: number,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: ({signal}) =>
      request<TirePressureSnapshot | null>(
        `/tire-pressure/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useChargingTelemetryLatest(
  vehicleId: number,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: ({signal}) =>
      request<ChargingTelemetry | null>(
        `/charging-telemetry/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useMediaLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['media-latest', vehicleId],
    queryFn: ({signal}) =>
      request<MediaSnapshot | null>(`/media/latest?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useLocationSnapshotLatest(
  vehicleId: number,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ['location-latest', vehicleId],
    queryFn: ({signal}) =>
      request<LocationSnapshot | null>(
        `/location-snapshots/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useVehicleConfigLatest(
  vehicleId: number,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: ({signal}) =>
      request<VehicleConfigSnapshot | null>(
        `/vehicle-config/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useUserPreferenceLatest(
  vehicleId: number,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: ['user-pref-latest', vehicleId],
    queryFn: ({signal}) =>
      request<UserPreferenceSnapshot | null>(
        `/user-preferences/latest?vehicle_id=${vehicleId}`,
        {signal},
      ),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export async function fetchVehicleState(
  vehicleId: number,
): Promise<VehicleStateResult> {
  const res = await request<VehicleStateEnvelope>(`/vehicles/${vehicleId}/state`);
  return normalizeVehicleStateResponse(res, vehicleId);
}

export function useVehicleMobileEnabled(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-mobile-enabled', vehicleId],
    queryFn: ({signal}) =>
      request<VehicleInfoEnvelope<MobileEnabledData>>(
        `/vehicles/${vehicleId}/mobile-enabled`,
        {signal},
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshVehicleMobileEnabled(vehicleId?: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<MobileEnabledData>>(
        `/vehicles/${vehicleId}/mobile-enabled/refresh`,
        {method: 'POST'},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['vehicle-mobile-enabled', vehicleId],
      });
      success(
        'toast.vehicles.mobileEnabled.refresh.success',
        'Mobile access status refreshed',
      );
    },
    onError: e =>
      error(
        e,
        'toast.vehicles.mobileEnabled.refresh.error',
        'Failed to refresh mobile access',
      ),
  });
}

export function useVehicleOptions(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-options', vehicleId],
    queryFn: ({signal}) =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/options`,
        {signal},
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useRefreshVehicleOptions(vehicleId?: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/options/refresh`,
        {method: 'POST'},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['vehicle-options', vehicleId]});
      success('toast.vehicles.options.refresh.success', 'Vehicle options refreshed');
    },
    onError: e =>
      error(e, 'toast.vehicles.options.refresh.error', 'Failed to refresh options'),
  });
}

export function useVehicleSpecs(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-specs', vehicleId],
    queryFn: ({signal}) =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/specs`,
        {signal},
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useRefreshVehicleSpecs(vehicleId?: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/specs/refresh`,
        {method: 'POST'},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['vehicle-specs', vehicleId]});
      success('toast.vehicles.specs.refresh.success', 'Vehicle specs refreshed');
    },
    onError: e =>
      error(e, 'toast.vehicles.specs.refresh.error', 'Failed to refresh specs'),
  });
}

export function useVehicleSubscriptions(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-subscriptions', vehicleId],
    queryFn: ({signal}) =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/subscriptions`,
        {signal},
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.RARE,
  });
}

export function useRefreshVehicleSubscriptions(vehicleId?: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/subscriptions/refresh`,
        {method: 'POST'},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['vehicle-subscriptions', vehicleId],
      });
      success(
        'toast.vehicles.subscriptions.refresh.success',
        'Subscriptions refreshed',
      );
    },
    onError: e =>
      error(
        e,
        'toast.vehicles.subscriptions.refresh.error',
        'Failed to refresh subscriptions',
      ),
  });
}

export function useVehicleUpgrades(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-upgrades', vehicleId],
    queryFn: ({signal}) =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/upgrades`,
        {signal},
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.RARE,
  });
}

export function useRefreshVehicleUpgrades(vehicleId?: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        `/vehicles/${vehicleId}/upgrades/refresh`,
        {method: 'POST'},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['vehicle-upgrades', vehicleId]});
      success('toast.vehicles.upgrades.refresh.success', 'Upgrades refreshed');
    },
    onError: e =>
      error(e, 'toast.vehicles.upgrades.refresh.error', 'Failed to refresh upgrades'),
  });
}

export function useWarrantyDetails() {
  return useQuery({
    queryKey: ['warranty-details'],
    queryFn: ({signal}) =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>('/tesla/warranty', {
        signal,
      }),
    staleTime: STALE_TIMES.DAILY,
  });
}

export function useRefreshWarrantyDetails() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<Record<string, unknown>>>(
        '/tesla/warranty/refresh',
        {method: 'POST'},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['warranty-details']});
      success(
        'toast.vehicles.warranty.refresh.success',
        'Warranty details refreshed',
      );
    },
    onError: e =>
      error(
        e,
        'toast.vehicles.warranty.refresh.error',
        'Failed to refresh warranty details',
      ),
  });
}
