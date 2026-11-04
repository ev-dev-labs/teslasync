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

export function observedDrivePower(drive: DriveDetail) {
  const telemetry = drive.telemetry ?? [];
  const rows = telemetry.length > 0 ? telemetry : (drive.positions ?? []);
  const observationCount = rows.filter((row) => finite(row.power) != null).length;
  const samples = rows.map((row) => ({
    at: Date.parse(row.createdAt ?? row.created_at ?? row.timestamp),
    powerW: finite(row.power),
  })).filter((sample) => Number.isFinite(sample.at)).sort((a, b) => a.at - b.at);
  const from = Date.parse(drive.startTs);
  const durationS = finite(drive.durationS);
  const to = drive.endTs ? Date.parse(drive.endTs)
    : durationS != null && durationS >= 0 ? from + durationS * 1000 : NaN;
  let netWh = 0;
  let regenWh = 0;
  let coveredS = 0;
  if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const seconds = (Math.min(to, samples[i + 1]?.at ?? to) - Math.max(from, sample.at)) / 1000;
      if (sample.powerW == null || seconds <= 0) continue;
      const energyWh = sample.powerW * seconds / 3600;
      if (!Number.isFinite(energyWh)) continue;
      coveredS += seconds;
      netWh += energyWh;
      regenWh += Math.max(-energyWh, 0);
    }
  }
  return {
    meanPowerW: coveredS > 0 ? netWh * 3600 / coveredS : null,
    netWh: coveredS > 0 ? netWh : null,
    regenWh: coveredS > 0 ? regenWh : null,
    coveredS, observationCount, sampleCount: rows.length,
  };
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
  const power = observedDrivePower(drive);
  const hasPower = power.observationCount > 0;
  const durationS = finite(drive.durationS);
  const durationH = durationS != null && durationS >= 0 ? durationS / 3600 : null;
  // Row power is signed watts (pack voltage × current), like avgPowerW.
  const avgPowerW = finite(drive.avgPowerW);
  const observedEnergy = finite(drive.energyUsedWh);
  const observedRegen = finite(drive.regenEnergyWh);
  // Average pack power is signed net energy, not gross consumption.
  const energyWh = observedEnergy
    ?? (avgPowerW != null && durationH != null ? finite(avgPowerW * durationH) : power.netWh);
  const regenWh = observedRegen ?? power.regenWh;
  return {
    energyWh, regenWh, hasPower,
    powerObservationCount: power.observationCount,
    powerSampleCount: power.sampleCount,
    energySource: observedEnergy != null ? 'observed' : energyWh != null ? 'estimated' : 'missing',
    regenSource: observedRegen != null ? 'observed' : regenWh != null ? 'estimated' : 'missing',
  };
}
