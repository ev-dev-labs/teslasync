import type { Drive, DrivetrainHealthData, DrivingStats } from '@/types/driving';
import type { MotorSnapshot } from '@/api/types';
import { HEALTH_SCORE } from '../drivetrain-health/constants';

/** Source order, ceilings and specialist score mapping are the existing policy. */
export const sensorDefinitions = [
  { key: 'frontMotor', field: 'frontMotorTempC', labelKey: 'drivetrain.frontMotor', label: 'Front Motor', maxTemp: 150 },
  { key: 'rearMotor', field: 'rearMotorTempC', labelKey: 'drivetrain.rearMotor', label: 'Rear Motor', maxTemp: 150 },
  { key: 'inverter', field: 'inverterTempC', labelKey: 'drivetrain.inverter', label: 'Inverter', maxTemp: 120 },
  { key: 'battery', field: 'batteryTempC', labelKey: 'drivetrain.battery', label: 'Battery', maxTemp: 60 },
] as const;

export function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function healthStatus(health: DrivetrainHealthData | null | undefined) {
  const value = health?.overallHealth;
  return value === 'good' || value === 'warning' || value === 'critical' ? value : null;
}

export function healthScore(health: DrivetrainHealthData | null | undefined) {
  const status = healthStatus(health);
  // A producer default with no temperature evidence is not an active assessment.
  return status && sensorDefinitions.some(sensor => finite(health?.[sensor.field]) != null)
    ? HEALTH_SCORE[status] : null;
}

export function sensorsFor(health: DrivetrainHealthData | null | undefined) {
  return sensorDefinitions.map(sensor => ({ ...sensor, value: finite(health?.[sensor.field]) }));
}

export function temperatureBand(value: number | null, ceiling: number) {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(ceiling) || ceiling <= 0) return 'unknown';
  if (value / ceiling >= 0.85) return 'critical';
  if (value / ceiling >= 0.65) return 'warning';
  return 'good';
}

export interface DriveChartRow {
  date: string;
  powerMax: number | null;
  powerMin: number | null;
  outsideTemp: number | null;
  distance: number | null;
}

export interface MotorChartRow {
  time: string;
  stator: number | null;
  statorRel: number | null;
  statorRer: number | null;
  torque: number | null;
  speed: null;
  axle: number | null;
}

export function driveSeries(
  drives: readonly Drive[] | null | undefined,
  start: string, end: string, dateLabel: (value: string) => string,
): DriveChartRow[] {
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T23:59:59`).getTime();
  return (drives ?? [])
    .filter(drive => {
      const time = new Date(drive.startTs).getTime();
      return Number.isFinite(time) && time >= startMs && time <= endMs;
    })
    .slice()
    .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime())
    .slice(-30)
    .map(drive => ({
      date: dateLabel(drive.startTs),
      // Existing "peak" series is average drive power, not a measured peak.
      powerMax: finite(drive.avgPowerW),
      // The existing source supplies no per-drive regen power signal.
      powerMin: null,
      outsideTemp: finite(drive.outsideTempAvgC),
      distance: finite(drive.distanceM),
    }));
}

export function motorSeries(
  snapshots: readonly MotorSnapshot[] | null | undefined,
  timeLabel: (value: string) => string,
): MotorChartRow[] {
  return (snapshots ?? []).map(snapshot => ({
    time: snapshot.ts ? timeLabel(snapshot.ts) : '',
    stator: finite(snapshot.motor_temp_c_front),
    statorRel: finite(snapshot.motor_temp_c_rear),
    statorRer: finite(snapshot.inverter_temp_c),
    torque: finite(snapshot.torque_nm_front ?? snapshot.torque_nm_rear),
    speed: null,
    axle: finite(snapshot.motor_rpm_front ?? snapshot.motor_rpm_rear),
  }));
}

export function powerSummary(rows: readonly DriveChartRow[]) {
  const values = rows.map(row => row.powerMax);
  const measured = values.filter((value): value is number => value != null);
  return {
    peakPower: measured.length ? Math.max(...measured) : null,
    // Retain the arithmetic mean and original included-row denominator.
    // Unknown inputs cannot contribute an invented zero.
    avgPowerMax: values.length && measured.length === values.length
      ? measured.reduce((sum, value) => sum + value, 0) / values.length : null,
    minRegenPower: null,
  };
}

/** Verified in internal/api/drives/listing.go:109–113, not guessed from names. */
export function statsSI(stats: DrivingStats | null | undefined) {
  const distanceKm = finite(stats?.totalDistanceKm);
  const avgKmh = finite(stats?.avgSpeedKmh);
  const topKmh = finite(stats?.topSpeedKmh);
  return {
    distance: distanceKm == null ? null : distanceKm * 1000,
    avgSpeed: avgKmh == null ? null : avgKmh / 3.6,
    topSpeed: topKmh == null ? null : topKmh / 3.6,
  };
}

/** Verified exception: MotorSnapshot power_kw/regen_kw explicitly contain kW. */
export function motorPowerSI(value: number | null | undefined) {
  const reading = finite(value);
  return reading == null ? null : reading * 1000;
}

export type Sensor = ReturnType<typeof sensorsFor>[number];
export type PowerSummary = ReturnType<typeof powerSummary>;
