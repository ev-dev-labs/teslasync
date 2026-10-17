import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

export interface DriveEnergyEvidence {
  energyWh: number | null;
  regenWh: number | null;
  energySource: 'observed' | 'estimated' | 'missing';
  regenSource: 'observed' | 'estimated' | 'missing';
  hasPower: boolean;
  powerObservationCount?: number;
  powerSampleCount?: number;
}

export type DriveEnergyStats = DriveStats & { energyEvidence?: DriveEnergyEvidence };

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Keeps nullable evidence alongside the numeric legacy view model. */
export function statsEnergyEvidence(stats: DriveEnergyStats | null | undefined) {
  return {
    energyWh: finite(stats?.energyEvidence ? stats.energyEvidence.energyWh : stats?.energyWh),
    regenWh: finite(stats?.energyEvidence ? stats.energyEvidence.regenWh : stats?.regenWh),
    regenSource: stats?.energyEvidence?.regenSource ?? 'observed',
  };
}

/** Summary values win; power-based estimates require a known, nonnegative duration. */
export function driveEnergyEvidence(drive: DriveDetail, stats?: DriveEnergyStats): DriveEnergyEvidence {
  if (stats?.energyEvidence) return stats.energyEvidence;
  const telemetry = drive.telemetry ?? [];
  const rows = telemetry.length > 0 ? telemetry : (drive.positions ?? []);
  const powers = rows.map((row) => finite(row.power)).filter((value): value is number => value != null);
  const hasPower = powers.length > 0;
  const durationS = finite(drive.durationS);
  const durationH = durationS != null && durationS >= 0 ? durationS / 3600 : null;
  // Row power is signed watts (pack voltage × current), like avgPowerW.
  const avgPowerW = finite(drive.avgPowerW)
    ?? (hasPower ? finite(powers.reduce((sum, power) => sum + power, 0) / powers.length) : null);
  const observedEnergy = finite(drive.energyUsedWh);
  const observedRegen = finite(drive.regenEnergyWh);
  // Average pack power is signed net energy, not gross consumption.
  const energyWh = observedEnergy
    ?? (avgPowerW != null && durationH != null ? finite(avgPowerW * durationH) : null);
  // Positive and zero power still contribute to the observed-sample mean;
  // missing readings do not. This remains a uniform-sampling estimate.
  const regenWh = observedRegen
    ?? (hasPower && durationH != null
      ? finite(powers.reduce((sum, power) => sum + Math.max(-power, 0), 0) / powers.length * durationH)
      : null);
  return {
    energyWh, regenWh, hasPower,
    powerObservationCount: powers.length,
    powerSampleCount: rows.length,
    energySource: observedEnergy != null ? 'observed' : energyWh != null ? 'estimated' : 'missing',
    regenSource: observedRegen != null ? 'observed' : regenWh != null ? 'estimated' : 'missing',
  };
}
