import { useState, useRef, useCallback, useEffect } from 'react';
import type { DrivePosition } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ReplaySpeed = 1 | 10 | 25 | 50 | 100;

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
  seekTo: (index: number) => void;
  seekToProgress: (progress: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse position timestamps into ms-since-drive-start offsets. */
function buildTimeline(positions: DrivePosition[]): number[] {
  if (positions.length === 0) return [];
  const t0 = new Date(positions[0].timestamp).getTime();
  return positions.map((p) => new Date(p.timestamp).getTime() - t0);
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
    { play, pause, stop, setSpeed, seekTo, seekToProgress },
  ];
}
