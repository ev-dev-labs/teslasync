export interface Drive {
  id: number;
  vehicleId: number;
  startDate: string;
  endDate: string | null;
  distance: number;
  durationMin: number;
  speedMax: number | null;
  speedAvg: number | null;
  speedMin: number | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  startAddress: string | null;
  endAddress: string | null;
  outsideTempAvg: number | null;
  insideTempAvg: number | null;
  driverTempAvg: number | null;
  passengerTempAvg: number | null;
  powerMax: number | null;
  powerMin: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
  startRangeKm: number | null;
  endRangeKm: number | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  socStart: number | null;
  socEnd: number | null;
  batteryHeaterOn: boolean | null;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
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
  totalDurationMin: number;
  avgEfficiencyWhKm: number;
  avgSpeedKmh: number;
  topSpeedKmh: number;
  regenRatio: number;
  totalRegenKwh: number;
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
  avgSpeedKmh: number;
  peakSpeedKmh: number;
  optimalSpeedKmh: number;
}

export interface SpeedBucket {
  speed_bucket: string;
  speedBucket?: string;
  readings: number;
  avg_power_kw?: number;
  avgPowerKw?: number;
  // Legacy field names (may not exist from API)
  range?: string;
  percentage?: number;
  driveCount?: number;
}

export interface RegenEfficiencyData {
  totalRegenKwh: number;
  regenRatio: number;
  monthlyAvgKw: number;
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
