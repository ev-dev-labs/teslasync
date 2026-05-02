import { useState, useRef, useCallback, useEffect } from 'react';
import type { DrivePosition } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ReplaySpeed = 1 | 10 | 25 | 50 | 100;

/** Ordered list of allowed replay speeds. Exposed so consumers can render
 *  speed cycle controls without re-deriving the order. */
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 10, 25, 50, 100] as const;

export interface ReplayState {
  isPlaying: boolean;
  speed: ReplaySpeed;
  currentIndex: number;
  progress: number;
  currentPosition: DrivePosition | null;
  elapsedTime: number;
  totalTime: number;
}

export interface ReplayControls {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
  /** Step the speed slot by `delta` (signed). +1 = next-fastest, -1 = next-slowest. Clamped. */
  setSpeedRelative: (delta: number) => void;
  seekTo: (index: number) => void;
  seekToProgress: (progress: number) => void;
  /** Seek by `deltaSeconds` (signed). Clamped to [0, totalTime]. */
  seekBy: (deltaSeconds: number) => void;
  /** Step the playhead by `delta` positions (frames). Signed; clamped. */
  stepFrame: (delta: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse position timestamps into ms-since-drive-start offsets. Positions
 *  whose timestamps don't parse are skipped so a single bad row can't
 *  poison `totalTime` (NaN propagates and produces "NaN:NaN" in the UI). */
function buildTimeline(positions: DrivePosition[]): number[] {
  if (positions.length === 0) return [];
  let t0 = NaN;
  for (const p of positions) {
    const t = new Date(p.timestamp).getTime();
    if (Number.isFinite(t)) {
      t0 = t;
      break;
    }
  }
  if (!Number.isFinite(t0)) return [];
  return positions.map((p) => {
    const t = new Date(p.timestamp).getTime();
    return Number.isFinite(t) ? t - t0 : 0;
  });
}

/** Binary-search for the index whose offset is closest to `target`. */
function indexAtTime(offsets: number[], target: number): number {
  if (offsets.length === 0) return 0;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  // pick whichever of lo-1 or lo is closer
  if (lo > 0 && target - offsets[lo - 1] < offsets[lo] - target) {
    return lo - 1;
  }
  return lo;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

const TICK_MS = 50; // 20 fps update rate

/**
 * Time-based trip replay hook.
 *
 * Maintains a virtual clock (scaled by speed multiplier) that maps to the
 * drive's position timeline. All consumers (map marker, chart cursors,
 * stat cards) derive their state from the current time offset.
 */
export function useTripReplay(
  positions: DrivePosition[],
): [ReplayState, ReplayControls] {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Precompute timeline offsets once when positions change
  const offsetsRef = useRef<number[]>([]);
  const totalTimeRef = useRef(0);

  useEffect(() => {
    const offsets = buildTimeline(positions);
    offsetsRef.current = offsets;
    totalTimeRef.current = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
  }, [positions]);

  // Mutable refs for the animation loop (avoids stale closures)
  const elapsedRef = useRef(0);
  const speedRef = useRef<ReplaySpeed>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep speedRef in sync
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const tick = useCallback(() => {
    const offsets = offsetsRef.current;
    const total = totalTimeRef.current;
    if (offsets.length === 0 || total === 0) return;

    elapsedRef.current += TICK_MS * speedRef.current;

    if (elapsedRef.current >= total) {
      // Reached end — stop
      elapsedRef.current = total;
      setCurrentIndex(offsets.length - 1);
      setIsPlaying(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setCurrentIndex(indexAtTime(offsets, elapsedRef.current));
  }, []);

  // Start / stop the interval when isPlaying changes
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(tick, TICK_MS);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, tick]);

  /* ---- Controls ---- */

  const play = useCallback(() => {
    const total = totalTimeRef.current;
    // If at end, restart
    if (total > 0 && elapsedRef.current >= total) {
      elapsedRef.current = 0;
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    elapsedRef.current = 0;
    setCurrentIndex(0);
  }, []);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
  }, []);

  const setSpeedRelative = useCallback((delta: number) => {
    setSpeedState((prev) => {
      const idx = REPLAY_SPEEDS.indexOf(prev);
      const safeIdx = idx === -1 ? 0 : idx;
      const nextIdx = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, safeIdx + delta));
      return REPLAY_SPEEDS[nextIdx];
    });
  }, []);

  const seekTo = useCallback((index: number) => {
    const offsets = offsetsRef.current;
    const clamped = Math.max(0, Math.min(index, offsets.length - 1));
    elapsedRef.current = offsets[clamped] ?? 0;
    setCurrentIndex(clamped);
  }, []);

  const seekToProgress = useCallback((progress: number) => {
    const total = totalTimeRef.current;
    const offsets = offsetsRef.current;
    const targetMs = Math.max(0, Math.min(1, progress)) * total;
    elapsedRef.current = targetMs;
    setCurrentIndex(indexAtTime(offsets, targetMs));
  }, []);

  const seekBy = useCallback((deltaSeconds: number) => {
    const total = totalTimeRef.current;
    const offsets = offsetsRef.current;
    if (total <= 0 || offsets.length === 0) return;
    const targetMs = Math.max(0, Math.min(total, elapsedRef.current + deltaSeconds * 1000));
    elapsedRef.current = targetMs;
    setCurrentIndex(indexAtTime(offsets, targetMs));
  }, []);

  const stepFrame = useCallback((delta: number) => {
    const offsets = offsetsRef.current;
    if (offsets.length === 0) return;
    setCurrentIndex((prev) => {
      const next = Math.max(0, Math.min(offsets.length - 1, prev + delta));
      elapsedRef.current = offsets[next] ?? 0;
      return next;
    });
  }, []);

  /* ---- Derived state ---- */

  const totalTime = totalTimeRef.current;
  const progress = totalTime > 0 ? elapsedRef.current / totalTime : 0;
  const currentPosition = positions[currentIndex] ?? null;

  return [
    {
      isPlaying,
      speed,
      currentIndex,
      progress: Math.min(progress, 1),
      currentPosition,
      elapsedTime: elapsedRef.current,
      totalTime,
    },
    { play, pause, stop, setSpeed, setSpeedRelative, seekTo, seekToProgress, seekBy, stepFrame },
  ];
}
