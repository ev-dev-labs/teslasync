export interface Drive {
  id: number;
  vehicleId: number;
  startTs: string;
  endTs: string | null;
  /** Drive duration in seconds (SI canonical). */
  durationS: number;
  /** Distance travelled in meters (SI canonical). */
  distanceM: number;
  startAddress: string | null;
  endAddress: string | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
  /** Energy used in watt-hours (Wh, SI canonical). */
  energyUsedWh: number | null;
  /** Energy recovered via regen in watt-hours (Wh, SI canonical). */
  regenEnergyWh: number | null;
  /** Average speed in meters per second (SI canonical). */
  avgSpeedMps: number | null;
  /** Maximum speed in meters per second (SI canonical). */
  maxSpeedMps: number | null;
  /** Average power in watts (W, SI canonical). */
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
  /**
   * Regen share as a **0-1 fraction** — the API rounds
   * `regen / total` to three decimals (internal/api/drives/listing.go).
   *
   * Note this differs from {@link RegenEfficiencyData.regenRatio}, which
   * carries the same name but is already a 0-100 percentage. Multiply this one
   * by 100 before displaying it as a percentage.
   */
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
  /** Bucket label as sent by the API, e.g. "20-40" (snake_case original). */
  speed_bucket: string;
  /** camelCase alias exposed by camelCaseKeys() over the API response. */
  speedBucket?: string;
  readings: number;
  /** Average power for the bucket in watts (W, SI canonical). */
  avg_power_w?: number;
  /** camelCase alias exposed by camelCaseKeys() over the API response. */
  avgPowerW?: number;
}

/**
 * Legacy per-drive evidence embedded in `/analytics/regen`.
 *
 * The page intentionally uses canonical {@link Drive} rows from `/drives`
 * instead: this embedded shape contains legacy distance semantics and does not
 * expose measured recovered energy. It remains typed here because it is part
 * of the complete response contract.
 */
export interface RegenEfficiencyDriveSummary {
  id: number;
  startDate: string;
  /** Legacy miles field from the regen handler; do not use for SI displays. */
  distance: number;
  /** Drive duration in seconds (SI canonical). */
  durationS: number;
  /** Average speed in metres per second (SI canonical). */
  avgSpeedMps: number | null;
  /** Average absolute drive power in watts; not regenerative power. */
  avgPowerW: number | null;
  /** Minimum observed drive power in watts. */
  minPowerW: number | null;
  startSocPct: number | null;
  endSocPct: number | null;
  efficiency: number;
  regenScore: number;
}

/**
 * Legacy month summary embedded in `/analytics/regen`.
 *
 * `avgRegenPowerKw` is the camel-cased form of the historical
 * `avg_regen_power_kw` key, but its value is watts and represents average
 * absolute drive power. It is not measured regenerative power.
 */
export interface RegenEfficiencyMonthlySummary {
  month: string;
  driveCount: number;
  avgRegenPowerKw: number;
  /** Legacy miles-per-hour value from this endpoint; do not use for SI displays. */
  avgSpeed: number;
  avgEfficiency: number;
}

export type RegenCapacitySource =
  | 'vin_estimate'
  | 'model_estimate'
  | 'default';

export interface RegenEfficiencyData {
  vehicleId: number;
  totalRegenWh: number;
  totalDriveWh: number;
  /**
   * Recovery rate as a **percentage (0-100)** — the API computes
   * `totalRegenWh / totalDriveWh * 100` (internal/api/regen/handler.go).
   *
   * Note this differs from {@link DrivingStats.regenRatio}, which carries the
   * same name but is a 0-1 fraction. Do not multiply this one by 100.
   */
  regenRatio: number;
  /**
   * Average of the legacy monthly absolute-drive-power field, in watts.
   * This is not regenerative power and must not be presented as such.
   */
  monthlyAvgRegen: number;
  freeCharges: number;
  monthlySummary: RegenEfficiencyMonthlySummary[];
  drives: RegenEfficiencyDriveSummary[];
  /** Estimated usable battery capacity in watt-hours. */
  batteryCapacityWh: number;
  capacitySource: RegenCapacitySource;
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

/* ── Driving Coach ────────────────────────────────────────── */

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

/* ── Trip Planner ─────────────────────────────────────────── */

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
