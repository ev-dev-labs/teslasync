import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Ghost Racing / EV Segments — Strava-style route segments raced against your
 * own personal best. These hooks read the three backend routes registered in
 * internal/api/router.go (under the versioned API group):
 *
 *   GET /vehicles/{vehicleID}/segments                       (detected segments)
 *   GET /segments/{segmentID}/leaderboard                    (ranked attempts)
 *   GET /segments/{segmentID}/ghost?a=<driveID>&b=<driveID>  (head-to-head race)
 *
 * `request()` prepends `/api/v1` automatically, so the paths below MUST NOT
 * include it. Query params are snake_case (`a`, `b`) to match the Go handler,
 * and every field name mirrors the Go JSON tags (snake_case) exactly. Go
 * pointer fields map to `T | null` here.
 */

/** A personal-best-by-time (or the latest) attempt reference. */
export interface SegmentBest {
  drive_id: number;
  /** Recorded drive duration, SI seconds. */
  duration_s: number;
  /** RFC 3339 UTC timestamp of when the drive started. */
  started_at: string;
}

/** A personal-best-by-efficiency attempt reference. */
export interface SegmentBestEff {
  drive_id: number;
  /** Energy efficiency, watt-hours per kilometre. */
  wh_per_km: number;
  started_at: string;
}

/**
 * One detected segment in the list response. `best_time` and `latest` are
 * present whenever the segment has attempts; `best_efficiency` is null when no
 * attempt has a measured energy reading. `id` is 0 when the best-effort persist
 * failed (the segment is still returned but cannot be drilled into).
 */
export interface SegmentSummary {
  id: number;
  name: string;
  start_address: string;
  end_address: string;
  /** Representative (median) segment distance, SI metres. */
  distance_m: number;
  attempt_count: number;
  best_time: SegmentBest | null;
  best_efficiency: SegmentBestEff | null;
  latest: SegmentBest | null;
}

/** Body of GET /vehicles/{vehicleID}/segments. `segments` is always present. */
export interface SegmentsResponse {
  segments: SegmentSummary[];
}

/** The segment header echoed by the leaderboard and ghost responses. */
export interface SegmentInfo {
  id: number;
  name: string;
  start_address: string;
  end_address: string;
  distance_m: number;
  attempt_count: number;
}

/**
 * One ranked attempt. `wh_per_km` is null when the attempt has no energy
 * reading. `delta_to_best_s` is the time gap to the fastest run (the by-time
 * PR) in BOTH orderings. `is_pr` flags the rank-1 row of its own ordering.
 */
export interface LeaderboardRow {
  rank: number;
  drive_id: number;
  started_at: string;
  duration_s: number;
  distance_m: number;
  wh_per_km: number | null;
  delta_to_best_s: number;
  is_pr: boolean;
}

/** Body of GET /segments/{segmentID}/leaderboard. */
export interface LeaderboardResponse {
  segment: SegmentInfo;
  by_time: LeaderboardRow[];
  by_efficiency: LeaderboardRow[];
}

/** One point of a drive's normalized progress series. */
export interface GhostSeriesPoint {
  /** How far along the route, 0..1 by integrated distance. */
  fraction_of_distance: number;
  /** Seconds since the drive started. */
  elapsed_s: number;
  /** Instantaneous speed at this point, SI metres per second. */
  speed_mps: number;
}

/** One racer in the ghost response. */
export interface GhostDrive {
  drive_id: number;
  duration_s: number;
  series: GhostSeriesPoint[];
}

/** The A-vs-B time gap at a shared distance fraction (delta_s < 0 -> A ahead). */
export interface GhostSplitDelta {
  fraction: number;
  delta_s: number;
}

/**
 * Body of GET /segments/{segmentID}/ghost?a=&b=. `winner_drive_id` is the
 * faster drive (null on a tie) and `margin_s` the gap in seconds between the two
 * recorded durations.
 */
export interface GhostResponse {
  segment: SegmentInfo;
  a: GhostDrive;
  b: GhostDrive;
  split_deltas: GhostSplitDelta[];
  winner_drive_id: number | null;
  margin_s: number;
}

/**
 * Detected segments for a vehicle, with each segment's personal-best-by-time,
 * best-by-efficiency, and latest attempt. Disabled until a vehicle is known so
 * an empty selection never fires a request.
 */
export function useSegments(vehicleId: number | null) {
  return useQuery({
    queryKey: ['segments', vehicleId],
    queryFn: ({ signal }) =>
      request<SegmentsResponse>(`/vehicles/${vehicleId}/segments`, { signal }),
    enabled: vehicleId !== null && vehicleId > 0,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

/**
 * The ranked attempts on a segment, ordered both by time and by energy
 * efficiency. Disabled until a segment is selected.
 */
export function useSegmentLeaderboard(segmentId: number | null) {
  return useQuery({
    queryKey: ['segment-leaderboard', segmentId],
    queryFn: ({ signal }) =>
      request<LeaderboardResponse>(`/segments/${segmentId}/leaderboard`, { signal }),
    enabled: segmentId !== null && segmentId > 0,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

/**
 * Two attempts on a segment aligned onto a shared distance-fraction axis for a
 * head-to-head ghost race, with the per-fraction time split between them.
 * Disabled until a segment and both positive drive IDs are known.
 */
export function useSegmentGhost(
  segmentId: number | null,
  a: number | null,
  b: number | null,
) {
  return useQuery({
    queryKey: ['segment-ghost', segmentId, a, b],
    queryFn: ({ signal }) =>
      request<GhostResponse>(`/segments/${segmentId}/ghost?a=${a}&b=${b}`, { signal }),
    enabled:
      segmentId !== null &&
      segmentId > 0 &&
      a !== null &&
      a > 0 &&
      b !== null &&
      b > 0 &&
      a !== b,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}
