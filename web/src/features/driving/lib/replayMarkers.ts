import type { DrivePosition } from '@/types/driving';

/**
 * Trip-replay timeline marker.
 *
 * Markers annotate notable moments along a drive's playback timeline so the
 * `<TimelineScrubber>` can render contextual ticks (e.g. "regen peak", "low
 * SoC", a contiguous "fast segment") that the user can click to jump to.
 *
 * `at` is normalized to `[0, 1]` over the drive's elapsed-time span, NOT over
 * the position index — the scrubber works in time space so the ticks line up
 * with the playhead even when telemetry sampling is uneven.
 *
 * Replay marker helpers.
 */
export type ReplayMarkerKind =
  | 'start'
  | 'stop'
  | 'charge-start'
  | 'charge-stop'
  | 'fast-segment'
  | 'regen-peak'
  | 'low-soc'
  | 'event';

export interface ReplayMarker {
  /** Normalized 0..1 position along the trip timeline. */
  at: number;
  kind: ReplayMarkerKind;
  /** Optional label shown in the marker tooltip. */
  label?: string;
  /** Optional href — clicking the marker can route somewhere instead of seeking. */
  href?: string;
  /** Number of underlying events the marker represents (for clustered markers). */
  count?: number;
}

/* ------------------------------------------------------------------ */
/*  Tunable thresholds                                                 */
/* ------------------------------------------------------------------ */

/** Minimum contiguous duration (ms) to count as a "charge" segment. */
const MIN_CHARGE_MS = 30_000;
/** Minimum contiguous duration (ms) to count as a "fast segment". */
const MIN_FAST_SEG_MS = 10_000;
/** Power threshold (kW) below which a position is considered regen. */
const REGEN_THRESHOLD_KW = 0;
/** Battery percentage that triggers a "low-soc" marker. */
const LOW_SOC_PCT = 20;
/** Speed percentile that defines "fast". */
const FAST_PERCENTILE = 0.95;
/** Regen power percentile (most-negative) that defines "peak". */
const REGEN_PEAK_PERCENTILE = 0.95;
/** Cap on visible markers per kind before clustering kicks in. */
const MAX_MARKERS = 25;
/** Adjacent same-kind markers within this normalized distance get merged. */
const CLUSTER_DISTANCE = 0.04; // 4% of the timeline

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Linear-interpolation percentile (matches numpy's default `linear` method).
 * Returns 0 for empty input. Tolerant of unsorted / duplicate values.
 */
function safePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

function clusterAdjacent(markers: ReplayMarker[], kind: ReplayMarkerKind): ReplayMarker[] {
  const sameKind = markers.filter((m) => m.kind === kind).sort((a, b) => a.at - b.at);
  if (sameKind.length <= MAX_MARKERS) return sameKind;
  const clustered: ReplayMarker[] = [];
  let bucket: ReplayMarker[] = [];
  for (const m of sameKind) {
    if (bucket.length === 0 || m.at - bucket[bucket.length - 1].at <= CLUSTER_DISTANCE) {
      bucket.push(m);
    } else {
      clustered.push(collapseBucket(bucket, kind));
      bucket = [m];
    }
  }
  if (bucket.length > 0) clustered.push(collapseBucket(bucket, kind));
  return clustered;
}

function collapseBucket(bucket: ReplayMarker[], kind: ReplayMarkerKind): ReplayMarker {
  if (bucket.length === 1) return bucket[0];
  const midAt = bucket.reduce((sum, m) => sum + m.at, 0) / bucket.length;
  return {
    at: midAt,
    kind,
    count: bucket.length,
    label: `${bucket.length} ${kindLabel(kind)}`,
  };
}

function kindLabel(kind: ReplayMarkerKind): string {
  switch (kind) {
    case 'fast-segment':
      return 'fast segments';
    case 'regen-peak':
      return 'regen peaks';
    case 'charge-start':
      return 'charge starts';
    case 'charge-stop':
      return 'charge stops';
    case 'low-soc':
      return 'low SoC';
    default:
      return kind;
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Compute timeline markers from a sequence of trip positions.
 *
 * Pure function — same input always produces the same output, no side effects,
 * no React/DOM dependencies. Designed to be cheap enough to run on every
 * render of the page; consumers that care can wrap it in `useMemo`.
 *
 * Edge cases handled:
 *   - Empty `positions` → empty array.
 *   - Single position → only `start` marker.
 *   - Zero-duration (all timestamps identical) → only `start` and `stop`.
 *   - Missing power / soc fields → that marker family is simply skipped.
 *   - More than {@link MAX_MARKERS} of one kind → adjacent ones are clustered.
 */
export function computeReplayMarkers(positions: DrivePosition[]): ReplayMarker[] {
  if (positions.length === 0) return [];

  const t0 = new Date(positions[0].timestamp).getTime();
  const tEnd = new Date(positions[positions.length - 1].timestamp).getTime();
  const totalMs = tEnd - t0;

  // Single position OR zero-duration drive — only emit start/stop.
  if (positions.length < 2 || totalMs <= 0) {
    const out: ReplayMarker[] = [{ at: 0, kind: 'start', label: 'Start' }];
    if (positions.length > 1) out.push({ at: 1, kind: 'stop', label: 'End' });
    return out;
  }

  const normalize = (i: number): number => {
    const t = new Date(positions[i].timestamp).getTime() - t0;
    if (!Number.isFinite(t) || totalMs === 0) return 0;
    return Math.max(0, Math.min(1, t / totalMs));
  };

  const markers: ReplayMarker[] = [
    { at: 0, kind: 'start', label: 'Start' },
    { at: 1, kind: 'stop', label: 'End' },
  ];

  /* ---- Charge segments: contiguous runs where power < threshold for >=30s ---- */
  let chargeStartIdx: number | null = null;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const isChargingNow = p.power != null && p.power < REGEN_THRESHOLD_KW;
    if (isChargingNow && chargeStartIdx === null) {
      chargeStartIdx = i;
    } else if (!isChargingNow && chargeStartIdx !== null) {
      const startTs = new Date(positions[chargeStartIdx].timestamp).getTime();
      const endTs = new Date(positions[i - 1].timestamp).getTime();
      if (endTs - startTs >= MIN_CHARGE_MS) {
        markers.push({ at: normalize(chargeStartIdx), kind: 'charge-start', label: 'Charge start' });
        markers.push({ at: normalize(i - 1), kind: 'charge-stop', label: 'Charge stop' });
      }
      chargeStartIdx = null;
    }
  }
  // Trailing run that never ended.
  if (chargeStartIdx !== null) {
    const startTs = new Date(positions[chargeStartIdx].timestamp).getTime();
    const endTs = new Date(positions[positions.length - 1].timestamp).getTime();
    if (endTs - startTs >= MIN_CHARGE_MS) {
      markers.push({ at: normalize(chargeStartIdx), kind: 'charge-start', label: 'Charge start' });
      markers.push({ at: normalize(positions.length - 1), kind: 'charge-stop', label: 'Charge stop' });
    }
  }

  /* ---- Fast segments: contiguous runs where speed > p95 for >=10s ---- */
  const speeds = positions.map((p) => p.speed ?? 0).filter((s) => s > 0);
  if (speeds.length > 0) {
    const fastThreshold = safePercentile(speeds, FAST_PERCENTILE);
    let fastStartIdx: number | null = null;
    const fastSegMidpoints: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      const s = positions[i].speed ?? 0;
      const isFastNow = s > fastThreshold;
      if (isFastNow && fastStartIdx === null) {
        fastStartIdx = i;
      } else if (!isFastNow && fastStartIdx !== null) {
        const startTs = new Date(positions[fastStartIdx].timestamp).getTime();
        const endTs = new Date(positions[i - 1].timestamp).getTime();
        if (endTs - startTs >= MIN_FAST_SEG_MS) {
          fastSegMidpoints.push((normalize(fastStartIdx) + normalize(i - 1)) / 2);
        }
        fastStartIdx = null;
      }
    }
    if (fastStartIdx !== null) {
      const startTs = new Date(positions[fastStartIdx].timestamp).getTime();
      const endTs = new Date(positions[positions.length - 1].timestamp).getTime();
      if (endTs - startTs >= MIN_FAST_SEG_MS) {
        fastSegMidpoints.push((normalize(fastStartIdx) + normalize(positions.length - 1)) / 2);
      }
    }
    for (const mid of fastSegMidpoints) {
      markers.push({ at: mid, kind: 'fast-segment', label: 'Fast segment' });
    }
  }

  /* ---- Regen peaks: positions whose regen power exceeds p95 ---- */
  const regenPowers = positions
    .map((p) => p.power)
    .filter((pw): pw is number => pw != null && pw < REGEN_THRESHOLD_KW)
    .map((pw) => -pw); // flip sign so larger = more regen
  if (regenPowers.length > 0) {
    const regenThreshold = safePercentile(regenPowers, REGEN_PEAK_PERCENTILE);
    for (let i = 0; i < positions.length; i++) {
      const pw = positions[i].power;
      if (pw != null && -pw >= regenThreshold && pw < REGEN_THRESHOLD_KW) {
        markers.push({ at: normalize(i), kind: 'regen-peak', label: 'Regen peak' });
      }
    }
  }

  /* ---- Low SoC: first time battery drops below threshold ---- */
  for (let i = 0; i < positions.length; i++) {
    const soc = positions[i].batteryLevel;
    if (soc != null && soc < LOW_SOC_PCT) {
      markers.push({ at: normalize(i), kind: 'low-soc', label: `Battery <${LOW_SOC_PCT}%` });
      break;
    }
  }

  /* ---- Cluster adjacent same-kind markers if a kind exceeds MAX_MARKERS ---- */
  const clusterKinds: ReplayMarkerKind[] = ['fast-segment', 'regen-peak'];
  const out: ReplayMarker[] = [];
  const handled = new Set<ReplayMarkerKind>();
  for (const k of clusterKinds) {
    out.push(...clusterAdjacent(markers, k));
    handled.add(k);
  }
  for (const m of markers) {
    if (!handled.has(m.kind)) out.push(m);
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * Lookup the marker (if any) closest to a normalized playhead position.
 * Used to highlight stat cards when the playhead is "over" a marker.
 *
 * @param markers   computed timeline markers
 * @param at        normalized playhead position (0..1)
 * @param tolerance maximum distance to consider a hit (default ±2% of timeline)
 */
export function nearestMarker(
  markers: ReplayMarker[],
  at: number,
  tolerance = 0.02,
): ReplayMarker | null {
  let best: ReplayMarker | null = null;
  let bestDist = Infinity;
  for (const m of markers) {
    const d = Math.abs(m.at - at);
    if (d <= tolerance && d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}
