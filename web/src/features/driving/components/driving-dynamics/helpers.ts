import type { MotorSnapshot } from '@/api/types';

/* ---- Shared types ---- */

export type ThrottleStyle = 'conservative' | 'moderate' | 'aggressive';

export interface MotorStats {
  totalReadings: number;
  avgTorque: number;
  maxTorque: number;
  maxLateralG: number;
  maxLongitudinalG: number;
  avgPedalPosition: number;
  avgStatorTemp: number;
  maxStatorTemp: number;
  peakLateralG: number;
  peakLongitudinalG: number;
  highTorquePct: number;
}

/* ---- Helper functions ---- */

export function getThrottleStyle(avgPedal: number): ThrottleStyle {
  if (avgPedal < 25) return 'conservative';
  if (avgPedal < 55) return 'moderate';
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
  { min: 0, max: 30, label: '0–30' },
  { min: 30, max: 60, label: '30–60' },
  { min: 60, max: 90, label: '60–90' },
  { min: 90, max: 120, label: '90–120' },
  { min: 120, max: Infinity, label: '120+' },
] as const;

/* ---- Motor stats computation ---- */

export function computeMotorStats(motorHistory: MotorSnapshot[] | undefined): MotorStats | null {
  const h = motorHistory ?? [];
  if (h.length === 0) return null;

  const vals = (fn: (s: MotorSnapshot) => number | undefined | null) =>
    h.map(fn).filter((v): v is number => v != null);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

  const torques = vals((s) => s.di_torque);
  const laterals = vals((s) => s.lateral_accel);
  const longitudinals = vals((s) => s.longitudinal_accel);
  const pedals = vals((s) => s.pedal_position);
  const statorTemps = vals((s) => s.di_stator_temp);

  return {
    totalReadings: h.length,
    avgTorque: avg(torques),
    maxTorque: max(torques),
    maxLateralG: max(laterals.map(Math.abs)),
    maxLongitudinalG: max(longitudinals.map(Math.abs)),
    avgPedalPosition: avg(pedals),
    avgStatorTemp: avg(statorTemps),
    maxStatorTemp: max(statorTemps),
    peakLateralG: max(laterals.map(Math.abs)),
    peakLongitudinalG: max(longitudinals.map(Math.abs)),
    highTorquePct: torques.length > 0
      ? (torques.filter((t) => t > 200).length / torques.length) * 100
      : 0,
  };
}
