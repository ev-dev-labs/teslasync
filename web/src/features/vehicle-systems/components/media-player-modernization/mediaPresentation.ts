import type { MediaSnapshot } from '@/api/types';

/** Missing is not silence. This predicate matches the acquired chart/KPI policy. */
export function finiteReading(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function listeningStats(snapshots: readonly MediaSnapshot[]) {
  if (!snapshots.length) return { uniqueTracks: 0, topSource: null, avgVolume: null };
  const titles = new Set(snapshots.map(s => s.now_playing_title).filter(Boolean));
  const sources = snapshots.reduce<Record<string, number>>((acc, s) => {
    if (s.playback_source) acc[s.playback_source] = (acc[s.playback_source] ?? 0) + 1;
    return acc;
  }, {});
  const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const volumes = snapshots.map(s => s.audio_volume).filter(finiteReading);
  return {
    uniqueTracks: titles.size,
    topSource,
    avgVolume: volumes.length ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length : null,
  };
}

/** Preserve source milliseconds and m:ss display; clamp only the rendered meter. */
export function playbackProgress(snapshot: MediaSnapshot | null) {
  const duration = snapshot?.now_playing_duration;
  const elapsed = snapshot?.now_playing_elapsed;
  if (!finiteReading(duration) || duration <= 0 || !finiteReading(elapsed)) return null;
  const durationSec = Math.round(duration / 1000);
  return {
    percent: Math.max(0, Math.min(100, elapsed / duration * 100)),
    durationSec,
    elapsedSec: Math.min(durationSec, Math.max(0, Math.round(elapsed / 1000))),
  };
}

export function sourcePresentation<T>(data: T | null | undefined, loading: boolean, error: unknown) {
  const retained = data != null;
  return {
    retained: retained && Boolean(error),
    loading: loading && !retained,
    fatal: Boolean(error) && !retained,
    available: retained,
  };
}
