import type { DriveFsdInsight } from '@/types/fsd';
import type { ChartDataPoint, DriveStats } from './types';

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
  stats: DriveStats | null | undefined,
  chart: ChartDataPoint[] | undefined,
  fsd: DriveFsdInsight | undefined,
): DrivePhysicsDebrief {
  const samples = chart ?? [];
  const peakPowerKw = finite(stats?.powerMax);
  const energyWh = finite(stats?.energyWh) ?? 0;
  const regenWh = finite(stats?.regenWh) ?? 0;
  const regenShare = energyWh > 0 ? regenWh / (energyWh + regenWh) : null;
  const hasPower = samples.some((row) => Number.isFinite(row.power) && row.power !== 0)
    || (peakPowerKw != null && peakPowerKw !== 0)
    || regenWh > 0;

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
      honesty: regenWh > 0 ? 'live' : 'missing',
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
