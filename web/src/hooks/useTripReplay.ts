import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { DrivePosition } from '@/types/driving';

/** Shared empty array so `positions ?? EMPTY` keeps a stable identity when a
 *  caller passes `undefined` — otherwise a fresh `[]` each render would make
 *  the timeline memo and the reset effect churn on every commit. */
const EMPTY: readonly DrivePosition[] = [];

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
export function buildTimeline(positions: readonly DrivePosition[]): number[] {
  if (!positions || positions.length === 0) return [];
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
export function indexAtTime(offsets: number[], target: number): number {
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
  // `elapsedTime` is reactive state (not just a ref) so `progress` and the
  // returned `elapsedTime` re-render on EVERY playhead change — including a
  // seek that lands on the same frame index. Reading it from a ref made the
  // scrubber freeze (and the consumer's URL-sync effect miss updates) whenever
  // `currentIndex` didn't change.
  const [elapsedTime, setElapsedTime] = useState(0);

  // Timeline is derived synchronously during render so `totalTime`/`offsets`
  // are correct on the very first render. A ref populated inside useEffect
  // lagged by one commit and surfaced as a "0:00 / 0:00" scrubber until some
  // unrelated state change forced a re-render.
  const { offsets, totalTime } = useMemo(() => {
    const offs = buildTimeline(positions ?? EMPTY);
    return { offsets: offs, totalTime: offs.length > 0 ? offs[offs.length - 1] : 0 };
  }, [positions]);

  // A stable signature of the timeline's *content* (length + endpoints). The
  // reset effect keys off this rather than the array's referential identity so
  // a caller that rebuilds an equal `positions` array every render doesn't nuke
  // the playhead — only a genuinely different drive triggers a rewind.
  const timelineKey = useMemo(() => {
    const src = positions ?? EMPTY;
    if (src.length === 0) return '';
    return `${src.length}:${src[0].timestamp}:${src[src.length - 1].timestamp}`;
  }, [positions]);

  // Latest-value mirrors so the stable ([]-dep) control callbacks and the
  // interval loop never close over stale timeline data.
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const totalRef = useRef(totalTime);
  totalRef.current = totalTime;

  // Mutable refs for the animation loop (avoids stale closures).
  const elapsedRef = useRef(0);
  const currentIndexRef = useRef(0);
  const speedRef = useRef<ReplaySpeed>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep speedRef in sync so the interval tick uses the live multiplier.
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Commit a playhead position to BOTH the reactive state (drives a re-render
  // → fresh progress/elapsed for consumers and their effects) and the refs
  // (read by the animation loop without waiting for the commit).
  const commit = useCallback((index: number, ms: number) => {
    currentIndexRef.current = index;
    elapsedRef.current = ms;
    setCurrentIndex(index);
    setElapsedTime(ms);
  }, []);

  // A new trip rewinds the playhead. Without this, a stale index/elapsed from a
  // previous (possibly longer) drive would point past the new array — a blank
  // marker plus a scrubber pinned at the old end. Keyed on the content
  // signature so incidental array-identity churn doesn't reset mid-playback.
  useEffect(() => {
    setIsPlaying(false);
    commit(0, 0);
  }, [timelineKey, commit]);

  const tick = useCallback(() => {
    const offs = offsetsRef.current;
    const total = totalRef.current;
    if (offs.length === 0 || total === 0) return;

    const next = elapsedRef.current + TICK_MS * speedRef.current;

    if (next >= total) {
      // Reached end — pin to the last frame and stop (the isPlaying effect
      // tears the interval down on the next commit).
      commit(offs.length - 1, total);
      setIsPlaying(false);
      return;
    }

    commit(indexAtTime(offs, next), next);
  }, [commit]);

  // Start / stop the interval when isPlaying changes.
  useEffect(() => {
    if (!isPlaying) return undefined;
    intervalRef.current = setInterval(tick, TICK_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, tick]);

  /* ---- Controls ---- */

  const play = useCallback(() => {
    const total = totalRef.current;
    // If parked at the end, rewind before playing.
    if (total > 0 && elapsedRef.current >= total) {
      commit(0, 0);
    }
    setIsPlaying(true);
  }, [commit]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    commit(0, 0);
  }, [commit]);

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
    const offs = offsetsRef.current;
    if (offs.length === 0) {
      commit(0, 0);
      return;
    }
    const clamped = Math.max(0, Math.min(index, offs.length - 1));
    commit(clamped, offs[clamped] ?? 0);
  }, [commit]);

  const seekToProgress = useCallback((progress: number) => {
    const total = totalRef.current;
    const offs = offsetsRef.current;
    const targetMs = Math.max(0, Math.min(1, progress)) * total;
    commit(indexAtTime(offs, targetMs), targetMs);
  }, [commit]);

  const seekBy = useCallback((deltaSeconds: number) => {
    const total = totalRef.current;
    const offs = offsetsRef.current;
    if (total <= 0 || offs.length === 0) return;
    const targetMs = Math.max(0, Math.min(total, elapsedRef.current + deltaSeconds * 1000));
    commit(indexAtTime(offs, targetMs), targetMs);
  }, [commit]);

  const stepFrame = useCallback((delta: number) => {
    const offs = offsetsRef.current;
    if (offs.length === 0) return;
    const next = Math.max(0, Math.min(offs.length - 1, currentIndexRef.current + delta));
    commit(next, offs[next] ?? 0);
  }, [commit]);

  /* ---- Derived state ---- */

  const progress = totalTime > 0 ? elapsedTime / totalTime : 0;
  const currentPosition = (positions ?? EMPTY)[currentIndex] ?? null;

  return [
    {
      isPlaying,
      speed,
      currentIndex,
      progress: Math.min(progress, 1),
      currentPosition,
      elapsedTime,
      totalTime,
    },
    { play, pause, stop, setSpeed, setSpeedRelative, seekTo, seekToProgress, seekBy, stepFrame },
  ];
}
