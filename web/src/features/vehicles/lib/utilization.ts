/**
 * Utilization model — how intensively the car is actually used.
 *
 * From drives alone: driving-hours share of the observed window, distance and
 * energy per observed day, and cost-per-driven-km / per-driving-hour given
 * the user's electricity rate. Pure and clock-free (`nowMs` injected; the
 * observation window runs from the first in-range drive to `nowMs`).
 */

import type { Drive } from '@/types/driving';

export interface UtilizationSummary {
  /** Observed window length in days (first drive → now), ≥ 1 when data exists. */
  observedDays: number | null;
  drivingHours: number;
  /** Driving hours ÷ total observed hours, 0–1. */
  drivingShare: number | null;
  distanceM: number;
  energyWh: number;
  /** Average distance per observed day, meters. */
  distancePerDayM: number | null;
  /** Days with at least one drive ÷ observed days, 0–1. */
  activeDayShare: number | null;
  /** Energy cost per driven km, major currency units; null without a rate. */
  costPerKm: number | null;
  /** Energy cost per driving hour, major currency units. */
  costPerDrivingHour: number | null;
  /** Total energy cost for the window. */
  totalEnergyCost: number | null;
  drives: number;
}

const DAY_MS = 86_400_000;

export function summarizeUtilization(
  drives: readonly Drive[],
  costPerKwh: number | null,
  nowMs: number,
): UtilizationSummary {
  const dated = drives.filter(
    (d) => d.startTs && Number.isFinite(new Date(d.startTs).getTime()),
  );

  let firstMs = Number.POSITIVE_INFINITY;
  let drivingS = 0;
  let distanceM = 0;
  let energyWh = 0;
  const activeDays = new Set<string>();

  for (const d of dated) {
    const dt = new Date(d.startTs);
    const ms = dt.getTime();
    if (ms < firstMs) firstMs = ms;
    if (Number.isFinite(d.durationS) && d.durationS > 0) drivingS += d.durationS;
    if (Number.isFinite(d.distanceM)) distanceM += Math.max(0, d.distanceM);
    if (d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0) {
      energyWh += d.energyUsedWh;
    }
    activeDays.add(`${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`);
  }

  if (dated.length === 0 || !(nowMs > firstMs)) {
    return {
      observedDays: null,
      drivingHours: 0,
      drivingShare: null,
      distanceM: 0,
      energyWh: 0,
      distancePerDayM: null,
      activeDayShare: null,
      costPerKm: null,
      costPerDrivingHour: null,
      totalEnergyCost: null,
      drives: dated.length,
    };
  }

  const observedDays = Math.max(1, (nowMs - firstMs) / DAY_MS);
  const drivingHours = drivingS / 3600;
  const rate = costPerKwh != null && Number.isFinite(costPerKwh) && costPerKwh > 0 ? costPerKwh : null;
  const totalEnergyCost = rate != null ? (energyWh / 1000) * rate : null;

  return {
    observedDays: Math.round(observedDays * 10) / 10,
    drivingHours: Math.round(drivingHours * 10) / 10,
    drivingShare: Math.min(1, drivingHours / (observedDays * 24)),
    distanceM,
    energyWh,
    distancePerDayM: distanceM / observedDays,
    activeDayShare: Math.min(1, activeDays.size / observedDays),
    costPerKm:
      totalEnergyCost != null && distanceM >= 1000
        ? totalEnergyCost / (distanceM / 1000)
        : null,
    costPerDrivingHour:
      totalEnergyCost != null && drivingHours > 0 ? totalEnergyCost / drivingHours : null,
    totalEnergyCost,
    drives: dated.length,
  };
}
