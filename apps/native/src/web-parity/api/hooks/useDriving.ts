import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  FAST: 10_000,
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  MODERATE: 15_000,
  SLOW: 5 * 60_000,
} as const;

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

export interface ApiDrive {
  id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts: string | null;
  duration_s: number;
  distance_m: number;
  start_address: string | null;
  end_address: string | null;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  energy_used_wh: number | null;
  regen_energy_wh: number | null;
  avg_speed_mps: number | null;
  max_speed_mps: number | null;
  avg_power_w: number | null;
  outside_temp_avg_c: number | null;
  inside_temp_avg_c: number | null;
  score: number | null;
  ended_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface Drive {
  id: number;
  vehicleId: number;
  startTs: string;
  endTs: string | null;
  durationS: number;
  distanceM: number;
  startAddress: string | null;
  endAddress: string | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
  energyUsedWh: number | null;
  regenEnergyWh: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgPowerW: number | null;
  outsideTempAvgC: number | null;
  insideTempAvgC: number | null;
  score: number | null;
  endedStatus: string | null;
  createdAt: string;
  updatedAt: string;
  live?: boolean;
}

export interface DriveDetail extends Drive {
  positions: DrivePosition[];
  telemetry: DriveTelemetryPoint[];
}

export interface DrivePosition {
  latitude: number;
  longitude: number;
  speed: number | null;
  power: number | null;
  batteryLevel: number;
  timestamp: string;
  createdAt?: string;
  created_at?: string;
  insideTemp: number | null;
  outsideTemp: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  odometer: number | null;
  elevation: number | null;
  fanStatus: number | null;
  isClimateOn: boolean | null;
}

export interface DriveTelemetryPoint {
  timestamp: string;
  createdAt?: string;
  created_at?: string;
  speed: number | null;
  power: number | null;
  batteryLevel: number | null;
  outsideTemp: number | null;
  insideTemp: number | null;
  driverTemp: number | null;
  passengerTemp: number | null;
  elevation: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  estRange: number | null;
  odometer: number | null;
  soc: number | null;
  usableSoc: number | null;
  tirePressureFl: number | null;
  tirePressureFr: number | null;
  tirePressureRl: number | null;
  tirePressureRr: number | null;
  isClimateOn: boolean | null;
  fanStatus: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DriveScore {
  overall: number;
  efficiency: number;
  smoothness: number;
  speedDiscipline: number;
  grade: string;
  totalDrives: number;
  trend: 'up' | 'down' | 'flat';
}

export interface DrivingStats {
  totalDrives: number;
  totalDistanceKm: number;
  totalDurationS: number;
  avgEfficiencyWhKm: number;
  avgSpeedKmh: number;
  topSpeedKmh: number;
  regenRatio: number;
  regenEnergyWh: number;
  co2SavedKg: number;
}

export interface DrivingDynamicsData {
  maxAccelerationG: number;
  maxBrakingG: number;
  maxCorneringG: number;
  avgAccelerationG: number;
  avgBrakingG: number;
  smoothnessScore: number;
}

export interface AccelerationDistributionData {
  values: number[];
}

export interface DrivetrainHealthData {
  frontMotorTempC: number | null;
  rearMotorTempC: number | null;
  inverterTempC: number | null;
  batteryTempC: number | null;
  motorStatus: string;
  overallHealth: 'good' | 'warning' | 'critical';
}

export interface SpeedProfileData {
  distribution: SpeedBucket[];
  avgSpeedMps: number;
  peakSpeedMps: number;
  optimalSpeedMps: number;
}

export interface SpeedBucket {
  speed_bucket: string;
  speedBucket?: string;
  readings: number;
  avg_power_kw?: number;
  avgPowerKw?: number;
  range?: string;
  percentage?: number;
  driveCount?: number;
}

export interface RegenEfficiencyData {
  totalRegenWh: number;
  totalDriveWh: number;
  regenRatio: number;
  monthlyAvgRegen: number;
  freeCharges: number;
}

export interface RouteEfficiencyData {
  routes: RouteSummary[];
  totalRoutes: number;
  totalTrips: number;
}

export interface RouteSummary {
  startLocation: string;
  endLocation: string;
  tripCount: number;
  avgDistanceKm: number;
  avgEfficiency: number;
  bestEfficiency: number;
  worstEfficiency: number;
}

export interface DrivingCoachData {
  overall_score: number;
  efficiency_wh_km: number;
  best_efficiency_wh_km: number;
  total_drives_analyzed: number;
  style_breakdown: Record<string, number>;
  patterns: CoachPatterns;
  weekly_trend: CoachWeeklyTrend[];
  recommendations: CoachRecommendation[];
  per_drive_scores: CoachDriveScore[];
}

export interface CoachPatterns {
  hard_accel_pct: number;
  hard_brake_pct: number;
  highway_pct: number;
  short_trip_pct: number;
  cold_start_pct: number;
}

export interface CoachWeeklyTrend {
  week: string;
  score: number;
  efficiency: number;
  drives: number;
}

export interface CoachRecommendation {
  category: string;
  impact: 'high' | 'medium' | 'low';
  tip: string;
}

export interface CoachDriveScore {
  drive_id: number;
  date: string;
  score: number;
  style: 'efficient' | 'moderate' | 'aggressive';
  efficiency: number;
  distance: number;
}

export interface TripLocation {
  lat: number;
  lng: number;
  name: string;
}

export interface TripPlanPreferences {
  max_charge_stops?: number;
  speed_factor?: number;
  include_weather?: boolean;
  prefer_superchargers?: boolean;
}

export interface TripPlanRequest {
  vehicle_id: number;
  origin: TripLocation;
  destination: TripLocation;
  waypoints?: TripLocation[];
  current_soc: number;
  charge_limit_soc: number;
  min_arrival_soc: number;
  departure_time?: string;
  preferences?: TripPlanPreferences;
}

export interface TripPlanRoute {
  total_distance_m: number;
  total_duration_s: number;
  driving_duration_s: number;
  charging_duration_s: number;
  total_energy_wh: number;
  estimated_cost: number;
  arrival_soc: number;
  feasible: boolean;
  is_estimate: boolean;
}

export interface TripLeg {
  from: TripLocation;
  to: TripLocation;
  distance_m: number;
  duration_s: number;
  energy_wh: number;
  start_soc: number;
  arrival_soc: number;
}

export interface TripChargeStop {
  name: string;
  location: TripLocation;
  charge_from_soc: number;
  charge_to_soc: number;
  charge_duration_s: number;
  energy_wh: number;
  cost: number;
  is_recommended: boolean;
}

export interface TripWeatherImpact {
  avg_temp_c: number | null;
  efficiency_factor: number;
  note: string;
}

export interface TripSOCPoint {
  distance_m: number;
  soc: number;
}

export interface TripPlan {
  route: TripPlanRoute;
  legs: TripLeg[];
  charge_stops: TripChargeStop[];
  weather_impact: TripWeatherImpact;
  soc_curve: TripSOCPoint[];
}

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
}

export type DriveDiagnosticWindow = '30s' | '60s' | '5m' | '15m';

export interface DriveDiagnosticTransition {
  id: number;
  ts: string;
  fsm_name: string;
  from_state: string;
  to_state: string;
  trigger: string;
  details_json: Record<string, unknown> | null;
}

export interface DriveDiagnosticSignal {
  ts: string;
  field: string;
  value: string;
}

export interface DriveDiagnosticResponse {
  drive_id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts: string | null;
  ended_status: string | null;
  window: DriveDiagnosticWindow;
  fsm_transitions: DriveDiagnosticTransition[];
  signal_window: DriveDiagnosticSignal[];
}

export const nativeDrivingHookCapabilities = {
  mutationFeedbackPrimitive: 'Alert.alert',
  unavailableBrowserFeatures: [] as const,
} as const;

export const getDrives = (
  vehicleId: number,
  limit = 50,
  offset = 0,
  start?: string,
  end?: string,
) => {
  const params = new URLSearchParams({
    vehicle_id: String(vehicleId),
    limit: String(limit),
    offset: String(offset),
  });
  if (start) {
    params.append('start', start);
  }
  if (end) {
    params.append('end', end);
  }
  return request<ApiDrive[]>(`/drives?${params}`);
};

export const drivingKeys = {
  drives: (vehicleId?: string) => ['drives', vehicleId] as const,
  drive: (id: string) => ['drive', id] as const,
  score: (vehicleId?: string) => ['drive-score', vehicleId] as const,
  stats: (vehicleId?: string) => ['driving-stats', vehicleId] as const,
  dynamics: (vehicleId?: string) => ['driving-dynamics', vehicleId] as const,
  accelerationDistribution: (vehicleId?: string) =>
    ['acceleration-distribution', vehicleId] as const,
  drivetrainHealth: (vehicleId?: string) =>
    ['drivetrain-health', vehicleId] as const,
  speedProfile: (vehicleId?: string) => ['speed-profile', vehicleId] as const,
  regenEfficiency: (vehicleId?: string) =>
    ['regen-efficiency', vehicleId] as const,
  routeEfficiency: (vehicleId?: string) =>
    ['route-efficiency', vehicleId] as const,
  coach: (vehicleId?: string, days?: number) =>
    ['driving-coach', vehicleId, days] as const,
  whyEnded: (driveId: string, window: DriveDiagnosticWindow) =>
    ['drive', driveId, 'why-ended', window] as const,
};

export function useDrives(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drives(vehicleId),
    queryFn: ({signal}) =>
      request<Drive[]>(vehicleId ? `/drives?vehicle_id=${vehicleId}` : '/drives', {
        signal,
      }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useDrive(id: string) {
  return useQuery({
    queryKey: drivingKeys.drive(id),
    queryFn: ({signal}) => request<DriveDetail>(`/drives/${id}`, {signal}),
    enabled: !!id,
    refetchInterval: query => {
      const data = query.state.data;
      return data?.live === true ? INTERVALS.FAST : false;
    },
  });
}

export function useDriveScore(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.score(vehicleId),
    queryFn: ({signal}) =>
      request<DriveScore>(
        vehicleId ? `/drives/score?vehicle_id=${vehicleId}` : '/drives/score',
        {signal},
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingStats(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.stats(vehicleId),
    queryFn: ({signal}) =>
      request<DrivingStats>(
        vehicleId ? `/drives/stats?vehicle_id=${vehicleId}` : '/drives/stats',
        {signal},
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingDynamics(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.dynamics(vehicleId),
    queryFn: ({signal}) =>
      request<DrivingDynamicsData>(
        vehicleId
          ? `/drives/dynamics?vehicle_id=${vehicleId}`
          : '/drives/dynamics',
        {signal},
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useAccelerationDistribution(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.accelerationDistribution(vehicleId),
    queryFn: ({signal}) =>
      request<AccelerationDistributionData>(
        vehicleId
          ? `/drives/acceleration-distribution?vehicle_id=${vehicleId}`
          : '/drives/acceleration-distribution',
        {signal},
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivetrainHealth(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drivetrainHealth(vehicleId),
    queryFn: ({signal}) =>
      request<DrivetrainHealthData>(
        vehicleId
          ? `/drivetrain/health?vehicle_id=${vehicleId}`
          : '/drivetrain/health',
        {signal},
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useSpeedProfile(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.speedProfile(vehicleId), start, end],
    queryFn: ({signal}) => {
      if (!vehicleId) {
        return request<SpeedProfileData>('/analytics/speed-profile', {signal});
      }
      const params = new URLSearchParams({vehicle_id: vehicleId});
      if (start) {
        params.append('start', start);
      }
      if (end) {
        params.append('end', end);
      }
      return request<SpeedProfileData>(`/analytics/speed-profile?${params}`, {
        signal,
      });
    },
    enabled: !!vehicleId,
  });
}

export function useRegenEfficiency(
  vehicleId?: string,
  start?: string,
  end?: string,
) {
  return useQuery({
    queryKey: [...drivingKeys.regenEfficiency(vehicleId), start, end],
    queryFn: ({signal}) => {
      if (!vehicleId) {
        return request<RegenEfficiencyData>('/analytics/regen', {signal});
      }
      const params = new URLSearchParams({vehicle_id: vehicleId});
      if (start) {
        params.append('start', start);
      }
      if (end) {
        params.append('end', end);
      }
      return request<RegenEfficiencyData>(`/analytics/regen?${params}`, {
        signal,
      });
    },
    enabled: !!vehicleId,
  });
}

export function useRouteEfficiency(
  vehicleId?: string,
  start?: string,
  end?: string,
) {
  return useQuery({
    queryKey: [...drivingKeys.routeEfficiency(vehicleId), start, end],
    queryFn: ({signal}) => {
      if (!vehicleId) {
        return request<RouteEfficiencyData>('/analytics/route-efficiency', {
          signal,
        });
      }
      const params = new URLSearchParams({vehicle_id: vehicleId});
      if (start) {
        params.append('start', start);
      }
      if (end) {
        params.append('end', end);
      }
      return request<RouteEfficiencyData>(
        `/analytics/route-efficiency?${params}`,
        {signal},
      );
    },
    enabled: !!vehicleId,
  });
}

export function useDrivePositions(driveId: string) {
  return useQuery({
    queryKey: ['drive-positions', driveId],
    queryFn: ({signal}) =>
      request<DrivePosition[]>(`/drives/${driveId}/positions`, {signal}),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDriveTelemetry(driveId: string) {
  return useQuery({
    queryKey: ['drive-telemetry', driveId],
    queryFn: ({signal}) =>
      request<DriveTelemetryPoint[]>(`/drives/${driveId}/telemetry`, {signal}),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDrivingCoach(vehicleId?: string, days = 30) {
  return useQuery({
    queryKey: drivingKeys.coach(vehicleId, days),
    queryFn: ({signal}) =>
      request<DrivingCoachData>(
        `/analytics/driving-coach?vehicle_id=${vehicleId}&days=${days}`,
        {signal},
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function usePlanTrip() {
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (params: TripPlanRequest) =>
      request<TripPlan>('/trip-planner/plan', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      success('toast.tripPlanner.plan.success', 'Trip planned');
    },
    onError: err =>
      error(err, 'toast.tripPlanner.plan.error', 'Failed to plan trip'),
  });
}

export function useGeocodeSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['geocode-search', query],
    queryFn: ({signal}) =>
      request<GeocodeResult[]>(
        `/geocode/search?q=${encodeURIComponent(query)}&limit=5`,
        {signal},
      ),
    enabled: enabled && query.length >= 3,
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

export interface BulkOperationResult {
  deleted?: number;
  updated?: number;
  failed?: Array<{id: number; reason: string}>;
}

export function useBulkDeleteDrives() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<BulkOperationResult>('/drives/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ids}),
      }),
    onSuccess: res => {
      qc.invalidateQueries({queryKey: ['drives']});
      qc.invalidateQueries({queryKey: ['drive']});
      success('toast.bulk.delete.success', '{{count}} deleted', {
        count: res.deleted ?? 0,
      });
    },
    onError: err =>
      error(err, 'toast.bulk.delete.error', 'Failed to delete selection'),
  });
}

export function useDriveWhyEnded(
  driveId: string | number,
  window: DriveDiagnosticWindow = '60s',
  enabled = true,
) {
  const id = String(driveId);
  return useQuery({
    queryKey: drivingKeys.whyEnded(id, window),
    queryFn: ({signal}) =>
      request<DriveDiagnosticResponse>(
        `/drives/${encodeURIComponent(id)}/why-ended?window=${window}`,
        {signal},
      ),
    enabled: enabled && id !== '' && id !== '0',
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
