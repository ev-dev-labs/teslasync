import type { DriveFsdInsight } from '@/types/fsd';
import type { ChartDataPoint } from './types';
import { statsEnergyEvidence, type DriveEnergyStats } from './energyEvidence';

export type DebriefHonesty = 'live' | 'stale' | 'guessed' | 'missing';

export type DebriefBeatId = 'launch' | 'regen' | 'blended' | 'thermal' | 'fsd' | 'gap';

export interface DebriefBeat {
  id: DebriefBeatId;
  honesty: DebriefHonesty;
}

export interface DrivePhysicsDebrief {
  beats: DebriefBeat[];
  peakPowerKw: number | null;
  regenShare: number | null;
  fsdSharePct: number | null;
  fsdConfidence: DriveFsdInsight['confidence'] | null;
  resetAffected: boolean;
}

const LAUNCH_KW = 80;

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function interpretDriveDebrief(
  stats: DriveEnergyStats | null | undefined,
  chart: ChartDataPoint[] | undefined,
  fsd: DriveFsdInsight | undefined,
): DrivePhysicsDebrief {
  const samples = chart ?? [];
  const powers = samples.map((row) => finite(row.power)).filter((value): value is number => value != null);
  // An average aggregate is not a measured peak. Zero is a valid sample.
  const peakPowerKw = powers.length > 0 ? powers.reduce((max, value) => Math.max(max, value), -Infinity) : null;
  const { energyWh, regenWh, regenSource } = statsEnergyEvidence(stats);
  const grossEnergyWh = energyWh != null && regenWh != null ? finite(energyWh + regenWh) : null;
  const regenShare = grossEnergyWh != null && grossEnergyWh > 0 && regenWh != null
    ? finite(regenWh / grossEnergyWh) : null;
  const hasPower = powers.length > 0;

  const beats: DebriefBeat[] = [];
  if (!hasPower) {
    beats.push({ id: 'gap', honesty: 'missing' });
  } else {
    beats.push({
      id: 'launch',
      honesty: peakPowerKw != null && peakPowerKw >= LAUNCH_KW ? 'live' : 'stale',
    });
    beats.push({
      id: 'regen',
      honesty: regenWh == null ? 'missing' : regenSource === 'estimated' ? 'guessed' : 'live',
    });
  }
  beats.push({ id: 'blended', honesty: 'missing' });
  beats.push({ id: 'thermal', honesty: 'missing' });
  if (!fsd || fsd.fsd_share_pct == null) {
    beats.push({ id: 'fsd', honesty: fsd?.reset_affected ? 'guessed' : 'missing' });
  } else {
    beats.push({
      id: 'fsd',
      honesty: fsd.confidence === 'high' ? 'live' : fsd.confidence === 'unknown' ? 'missing' : 'guessed',
    });
  }

  return {
    beats,
    peakPowerKw,
    regenShare,
    fsdSharePct: fsd?.fsd_share_pct ?? null,
    fsdConfidence: fsd?.confidence ?? null,
    resetAffected: Boolean(fsd?.reset_affected),
  };
}
