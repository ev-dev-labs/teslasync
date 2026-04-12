export interface Drive {
  id: number;
  vehicleId: number;
  startDate: string;
  endDate: string | null;
  distance: number;
  durationMin: number;
  speedMax: number | null;
  speedAvg: number | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  startAddress: string | null;
  endAddress: string | null;
  outsideTempAvg: number | null;
  powerMax: number | null;
  powerMin: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
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
}

export interface DriveTelemetryPoint {
  timestamp: string;
  speed: number | null;
  power: number | null;
  batteryLevel: number | null;
  outsideTemp: number | null;
  elevation: number | null;
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
  range: string;
  percentage: number;
  driveCount: number;
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
