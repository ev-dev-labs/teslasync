// Native parity port of
// web/src/features/driving/components/driving-dynamics/helpers.ts.
//
// The web source is a pure, non-visual utility/type module for the Driving
// Dynamics feature: shared types (ThrottleStyle, MotorStats), two classifier
// helpers (getThrottleStyle, gForceColor), one constant table
// (SPEED_BUCKETS_RANGES) and the computeMotorStats aggregator over a
// MotorSnapshot[]. None of it touches the DOM, React, Recharts, Leaflet or any
// browser-only API, so the logic ports verbatim and is fully React
// Native-compatible.
//
// The only native adaptation is the import boundary: the web `@/api/types`
// alias is rewritten to the established relative path into the native
// web-parity api/types module, which already exports the same MotorSnapshot
// shape (torque_nm_front/_rear, motor_temp_c_front/_rear, power_kw, regen_kw).
// Field names, unit handling (Nm torque sum, °C max motor temp, kW power/regen),
// the gForceColor hex palette and the 200 Nm "high torque" threshold are all
// preserved so the native feature computes byte-identical statistics.
import type {MotorSnapshot} from '../../../../api/types';

/* ---- Shared types ---- */

export type ThrottleStyle = 'conservative' | 'moderate' | 'aggressive';

export interface MotorStats {
  totalReadings: number;
  avgTorque: number;
  maxTorque: number;
  avgMotorTemp: number;
  maxMotorTemp: number;
  avgPower: number;
  peakPower: number;
  minPower: number;
  peakRegen: number;
  highTorquePct: number;
}

/* ---- Helper functions ---- */

export function getThrottleStyle(avgPower: number): ThrottleStyle {
  if (avgPower < 20) return 'conservative';
  if (avgPower < 80) return 'moderate';
  return 'aggressive';
}

export function gForceColor(g: number): string {
  if (g < 0.2) return '#22c55e';
  if (g < 0.4) return '#3b82f6';
  if (g < 0.6) return '#eab308';
  return '#ef4444';
}

/* ---- Constants ---- */

export const SPEED_BUCKETS_RANGES = [
  {min: 0, max: 30, label: '0–30'},
  {min: 30, max: 60, label: '30–60'},
  {min: 60, max: 90, label: '60–90'},
  {min: 90, max: 120, label: '90–120'},
  {min: 120, max: Infinity, label: '120+'},
] as const;

/* ---- Motor stats computation ---- */

export function computeMotorStats(
  motorHistory: MotorSnapshot[] | undefined,
): MotorStats | null {
  const h = motorHistory ?? [];
  if (h.length === 0) return null;

  const vals = (fn: (s: MotorSnapshot) => number | undefined | null) =>
    h.map(fn).filter((v): v is number => v != null);

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);
  const min = (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : 0);

  const torques = vals(s => {
    const f = s.torque_nm_front ?? 0;
    const r = s.torque_nm_rear ?? 0;
    if (s.torque_nm_front == null && s.torque_nm_rear == null) return null;
    return f + r;
  });
  const motorTemps = vals(s => {
    const f = s.motor_temp_c_front;
    const r = s.motor_temp_c_rear;
    if (f == null && r == null) return null;
    return Math.max(f ?? -Infinity, r ?? -Infinity);
  });
  const powers = vals(s => s.power_kw);
  const regens = vals(s => s.regen_kw);

  return {
    totalReadings: h.length,
    avgTorque: avg(torques),
    maxTorque: max(torques),
    avgMotorTemp: avg(motorTemps),
    maxMotorTemp: max(motorTemps),
    avgPower: avg(powers),
    peakPower: max(powers),
    minPower: min(powers),
    peakRegen: max(regens),
    highTorquePct:
      torques.length > 0
        ? (torques.filter(t => t > 200).length / torques.length) * 100
        : 0,
  };
}
