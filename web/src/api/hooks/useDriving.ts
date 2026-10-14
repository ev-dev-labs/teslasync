import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { validateAnalyticalHistory } from '@/lib/analyticalHistory';
import { STALE_TIMES, INTERVALS } from '@/lib/constants';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useMutationToast } from './_toastHelpers';
import type { Drive as ApiDrive } from '../types';
import type {
  Drive,
  DriveDetail,
  DrivePosition,
  DriveTelemetryPoint,
  DriveScore,
  DrivingStats,
  DrivingDynamicsData,
  AccelerationDistributionData,
  DrivetrainHealthData,
  SpeedProfileData,
  RegenEfficiencyData,
  RouteEfficiencyData,
  DrivingCoachData,
  TripPlan,
  TripPlanRequest,
  TripConfidence,
  TripConfidenceRequest,
  GeocodeResult,
} from '@/types/driving';
import type {
  DriveDiagnosticResponse,
  DriveDiagnosticWindow,
} from '@/types/admin-diagnostics';
import type { RoadAnomalyResponse } from '@/types/roadAnomalies';

/** Fetches paginated driving sessions for a vehicle, optionally filtered by date range. */
export const getDrives = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ApiDrive[]>(`/drives?${params}`)
}

export const drivingKeys = {
  drives: (vehicleId?: string, window?: DriveWindow) =>
    (window?.start || window?.end || window?.limit
      ? ['drives', vehicleId, window.start ?? null, window.end ?? null, window.limit ?? null] as const
      : ['drives', vehicleId] as const),
  history: (vehicleId?: string, limit = 1000, window?: Pick<DriveWindow, 'start' | 'end'>) =>
    (window?.start || window?.end
      ? ['drives', vehicleId, 'history', limit, window.start ?? null, window.end ?? null] as const
      : ['drives', vehicleId, 'history', limit] as const),
  calendar: (vehicleId?: string, start?: string, end?: string) =>
    ['drives', vehicleId, 'calendar', start, end] as const,
  // Detail key is namespaced under 'drive' (singular) so it never collides
  // with `drives(vehicleId)` when the vehicleId numerically equals the drive
  // id. The collision swapped the cached value between `Drive[]` (list) and
  // `DriveDetail` (object) on every navigation between /drives and
  // /drives/{id}, surfacing as "No telemetry recorded" + NaNm + "In progress"
  // because `Drive[].distanceM`, `.endTs`, `.durationS`, `.telemetry` are
  // all undefined on an array.
  drive: (id: string) => ['drive', id] as const,
  score: (vehicleId?: string) => ['drive-score', vehicleId] as const,
  stats: (vehicleId?: string, window?: Pick<DriveWindow, 'start' | 'end'>) =>
    (window?.start || window?.end
      ? ['driving-stats', vehicleId, window.start ?? null, window.end ?? null] as const
      : ['driving-stats', vehicleId] as const),
  dynamics: (vehicleId?: string) => ['driving-dynamics', vehicleId] as const,
  accelerationDistribution: (vehicleId?: string) => ['acceleration-distribution', vehicleId] as const,
  drivetrainHealth: (vehicleId?: string) => ['drivetrain-health', vehicleId] as const,
  speedProfile: (vehicleId?: string) => ['speed-profile', vehicleId] as const,
  regenEfficiency: (vehicleId?: string) => ['regen-efficiency', vehicleId] as const,
  routeEfficiency: (vehicleId?: string) => ['route-efficiency', vehicleId] as const,
  coach: (vehicleId?: string, days?: number) => ['driving-coach', vehicleId, days] as const,
  whyEnded: (driveId: string, window: DriveDiagnosticWindow) =>
    ['drive', driveId, 'why-ended', window] as const,
  roadAnomalies: (driveId: string) => ['drive', driveId, 'road-anomalies'] as const,
};

/** Historical, on-demand analysis; do not scan signal history until expanded. */
export function useDriveRoadAnomalies(driveId: string, enabled = true) {
  return useQuery({
    queryKey: drivingKeys.roadAnomalies(driveId),
    queryFn: ({ signal }) =>
      request<RoadAnomalyResponse>(`/drives/${encodeURIComponent(driveId)}/road-anomalies`, { signal }),
    enabled: enabled && !!driveId,
    staleTime: STALE_TIMES.MODERATE,
  });
}

/**
 * Options for scoping a drives query on the server.
 *
 * Without them the API applies its own 50-row default page, so a caller that
 * filters or paginates client-side can only ever see the newest 50 drives no
 * matter what range or page size the user asked for.
 */
export interface DriveWindow {
  /** Inclusive RFC3339 instant or `YYYY-MM-DD` lower bound. */
  start?: string;
  /**
   * Exclusive RFC3339 instant, or inclusive `YYYY-MM-DD` upper bound.
   * Vehicle-calendar pages should pass `useRangeState().endInstantExclusive`.
   */
  end?: string;
  /** Row cap for one request. The API rejects anything above 1,000. */
  limit?: number;
  refetchInterval?: number;
}

export function useDrives(vehicleId?: string, options?: DriveWindow | number) {
  // The second parameter used to be a bare refetch interval; keep that shape
  // working so callers that only poll are unaffected.
  const opts: DriveWindow = typeof options === 'number' ? { refetchInterval: options } : (options ?? {});
  const boundedLimit = opts.limit == null
    ? undefined
    : Math.max(1, Math.min(1000, Math.floor(opts.limit)));
  const window: DriveWindow = { start: opts.start, end: opts.end, limit: boundedLimit };

  return useQuery({
    queryKey: drivingKeys.drives(vehicleId, window),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (vehicleId) params.set('vehicle_id', vehicleId);
      if (opts.start) params.set('start', opts.start);
      if (opts.end) params.set('end', opts.end);
      if (boundedLimit != null) params.set('limit', String(boundedLimit));
      const qs = params.toString();
      // Go nil slices remain empty-compatible; other invalid shapes must not replace cached evidence.
      return request<Drive[] | null>(qs ? `/drives?${qs}` : '/drives', { signal })
        .then((rows) => validateAnalyticalHistory(rows === null ? [] : rows, 'drive'));
    },
    enabled: !!vehicleId,
    refetchInterval: opts.refetchInterval,
    staleTime: STALE_TIMES.FAST,
  });
}

/**
 * Fetches a deliberately larger, isolated history window for client-side
 * analytical models. The list page keeps its existing lightweight query and
 * cache key; analytical pages opt into this hook so an annual/cumulative model
 * is never silently trained on the API's default 50-row page.
 *
 * The backend caps one request at 1,000 rows. Callers must still describe the
 * result as an observed history window rather than guaranteed lifetime data.
 * Workspace callers pass startInstant/endInstantExclusive unchanged as
 * start/end; both bounds scope the server result and its isolated cache key.
 */
export function useDriveHistory(
  vehicleId?: string,
  limit = 1000,
  window?: Pick<DriveWindow, 'start' | 'end'>,
) {
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(boundedLimit) });
  if (window?.start) params.set('start', window.start);
  if (window?.end) params.set('end', window.end);
  return useQuery({
    queryKey: drivingKeys.history(vehicleId, boundedLimit, window),
    queryFn: ({ signal }) =>
      request<Drive[]>(
        `/drives?${params}`,
        { signal },
      ).then((rows) => validateAnalyticalHistory(rows, 'drive')),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.MODERATE,
  });
}

const CALENDAR_PAGE_SIZE = 1000;

/** Fetch every drive in a valid bounded history window, preserving both exact bounds on every page. */
export function useDriveCalendarHistory(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: drivingKeys.calendar(vehicleId, start, end),
    queryFn: async ({ signal }) => {
      if (!vehicleId || !start || !end) {
        throw new Error('Drive calendar vehicle and date range are required');
      }
      if (!isDriveDateBound(start) || !isDriveDateBound(end) || Date.parse(start) > Date.parse(end)) {
        throw new Error('Drive calendar requires a valid start and end date range');
      }
      const drives: Drive[] = [];
      const seenIds = new Set<number>();
      for (let offset = 0; ; offset += CALENDAR_PAGE_SIZE) {
        const params = new URLSearchParams({
          vehicle_id: vehicleId,
          start,
          end,
          limit: String(CALENDAR_PAGE_SIZE),
          offset: String(offset),
        });
        const page = await request<Drive[]>(`/drives?${params}`, { signal });
        if (!Array.isArray(page) || page.length > CALENDAR_PAGE_SIZE) {
          throw new Error('Invalid drive calendar history response');
        }
        for (const drive of page) {
          if (!drive || !Number.isSafeInteger(drive.id) || seenIds.has(drive.id)) {
            throw new Error('Drive calendar history changed while loading; retry');
          }
          seenIds.add(drive.id);
        }
        drives.push(...page);
        if (page.length < CALENDAR_PAGE_SIZE) return drives;
      }
    },
    enabled: !!vehicleId && !!start && !!end,
    staleTime: STALE_TIMES.MODERATE,
  });
}

export function useDrive(id: string) {
  return useQuery({
    queryKey: drivingKeys.drive(id),
    queryFn: ({ signal }) => request<DriveDetail>(`/drives/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.live === true ? INTERVALS.FAST : false;
    },
  });
}

/** Independent all-completed-drive score. The server ignores date range parameters. */
export function useDriveScore(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.score(vehicleId),
    queryFn: ({ signal }) =>
      request<DriveScore>(
        vehicleId ? `/drives/score?vehicle_id=${vehicleId}` : '/drives/score', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

/** Full completed-drive aggregate; bounds scope started_at, never the list page. */
export function useDrivingStats(vehicleId?: string, window?: Pick<DriveWindow, 'start' | 'end'>) {
  return useQuery({
    queryKey: drivingKeys.stats(vehicleId, window),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (vehicleId) params.set('vehicle_id', vehicleId);
      if (window?.start) params.set('start', window.start);
      if (window?.end) params.set('end', window.end);
      const qs = params.toString();
      return request<DrivingStats>(qs ? `/drives/stats?${qs}` : '/drives/stats', { signal });
    },
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingDynamics(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.dynamics(vehicleId),
    queryFn: ({ signal }) =>
      request<DrivingDynamicsData>(
        vehicleId ? `/drives/dynamics?vehicle_id=${vehicleId}` : '/drives/dynamics', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useAccelerationDistribution(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.accelerationDistribution(vehicleId),
    queryFn: ({ signal }) =>
      request<AccelerationDistributionData>(
        vehicleId
          ? `/drives/acceleration-distribution?vehicle_id=${vehicleId}`
          : '/drives/acceleration-distribution', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivetrainHealth(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drivetrainHealth(vehicleId),
    queryFn: ({ signal }) =>
      request<DrivetrainHealthData>(
        vehicleId
          ? `/drivetrain/health?vehicle_id=${vehicleId}`
          : '/drivetrain/health', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

/**
 * RFC3339 bounds are [start, end). The server's ParseDateRange converts the
 * exclusive end to an inclusive PostgreSQL microsecond before BETWEEN.
 * Date-only bounds retain the endpoint's inclusive UTC-calendar semantics.
 * Omit both bounds for full history; a single bound is not supported.
 */
export function useSpeedProfile(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.speedProfile(vehicleId), start, end],
    queryFn: ({ signal }) => {
      if (start || end) {
        if (!start || !end || !isDriveDateBound(start)
          || !isDriveDateBound(end) || Date.parse(start) > Date.parse(end)) {
          throw new Error('Speed profile requires a valid start and end date range');
        }
      }
      if (!vehicleId) return request<SpeedProfileData>('/analytics/speed-profile', { signal });
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<SpeedProfileData>(`/analytics/speed-profile?${params}`, { signal });
    },
    enabled: !!vehicleId,
  });
}

export function isDriveDateBound(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const calendarDate = value.slice(0, 10);
  return new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) === calendarDate;
}

export function useRegenEfficiency(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.regenEfficiency(vehicleId), start, end],
    queryFn: ({ signal }) => {
      if (!vehicleId) return request<RegenEfficiencyData>('/analytics/regen', { signal });
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<RegenEfficiencyData>(`/analytics/regen?${params}`, { signal });
    },
    enabled: !!vehicleId,
  });
}

export function useRouteEfficiency(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.routeEfficiency(vehicleId), start, end],
    queryFn: ({ signal }) => {
      if (!vehicleId) return request<RouteEfficiencyData>('/analytics/route-efficiency', { signal });
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<RouteEfficiencyData>(`/analytics/route-efficiency?${params}`, { signal });
    },
    enabled: !!vehicleId,
  });
}

export function useDrivePositions(driveId: string) {
  return useQuery({
    queryKey: ['drive-positions', driveId],
    queryFn: ({ signal }) => request<DrivePosition[]>(`/drives/${driveId}/positions`, { signal }),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDriveTelemetry(driveId: string) {
  return useQuery({
    queryKey: ['drive-telemetry', driveId],
    queryFn: ({ signal }) => request<DriveTelemetryPoint[]>(`/drives/${driveId}/telemetry`, { signal }),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDrivingCoach(vehicleId?: string, days = 30, refetchInterval?: number) {
  return useQuery({
    queryKey: drivingKeys.coach(vehicleId, days),
    queryFn: ({ signal }) => request<DrivingCoachData>(`/analytics/driving-coach?vehicle_id=${vehicleId}&days=${days}`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.SLOW,
    refetchInterval,
  });
}

/* ── Trip Planner hooks─────────────────────────────────── */

export function usePlanTrip() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: TripPlanRequest) =>
      request<TripPlan>('/trip-planner/plan', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => success('toast.trip.plan.success', 'Trip planned'),
    onError: (err) => error(err, 'toast.trip.plan.error', 'Failed to plan trip'),
  });
}

/** Mutation to check en-route arrival confidence for remaining distance. */
export function useTripConfidence() {
  const { error } = useMutationToast();
  return useMutation({
    mutationFn: (params: TripConfidenceRequest) =>
      request<TripConfidence>('/trip-planner/confidence', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onError: (err) => error(err, 'toast.trip.confidence.error', 'Failed to check arrival confidence'),
  });
}

export function useGeocodeSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['geocode-search', query],
    queryFn: ({ signal }) => request<GeocodeResult[]>(`/geocode/search?q=${encodeURIComponent(query)}&limit=5`, { signal }),
    enabled: enabled && query.length >= 3,
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

/**
 * Result envelope for the standardized bulk endpoints.
 * Exactly one of `deleted` / `updated` is populated to match the verb of the
 * underlying endpoint; `failed` enumerates per-id failures with a stable
 * machine-readable reason ("not_found", "forbidden").
 */
export interface BulkOperationResult {
  deleted?: number;
  updated?: number;
  failed?: Array<{ id: number; reason: string }>;
}

/** Bulk delete drives. POST {ids:number[]} → BulkOperationResult. */
export function useBulkDeleteDrives() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<BulkOperationResult>('/drives/bulk', {
        method: 'DELETE',
        requiresLiveMode: true,
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (res) => {
        invalidateAndBroadcast(qc, { queryKey: ['drives'] });
        invalidateAndBroadcast(qc, { queryKey: ['drive'] });
        invalidateAndBroadcast(qc, { queryKey: ['analytics', 'fsd'] });
        success('toast.bulk.delete.success', '{{count}} deleted', {
        count: res.deleted ?? 0,
      });
    },
    onError: (err) =>
      error(err, 'toast.bulk.delete.error', 'Failed to delete selection'),
  });
}

/**
 * `useDriveWhyEnded` — diagnostic feed for the "Why did this drive end?"
 * section on DriveDetailPage. Joins the FSM transition history with the
 * raw signal window around the drive's end_ts (or now() while live).
 *
 * Lazy by default: pass `enabled=false` while the section is collapsed so
 * the network request only fires on operator expand. Refetches every
 * INTERVALS.STANDARD because both feeds are append-only on the server.
 *
 * Server validates `window` ∈ {30s, 60s, 5m, 15m} and rejects anything
 * else with 400 — the page renders a server-validated dropdown so this
 * hook does not pre-validate.
 */
export function useDriveWhyEnded(
  driveId: string | number,
  window: DriveDiagnosticWindow = '60s',
  enabled = true,
) {
  const id = String(driveId);
  return useQuery({
    queryKey: drivingKeys.whyEnded(id, window),
    queryFn: ({ signal }) =>
      request<DriveDiagnosticResponse>(
        `/drives/${encodeURIComponent(id)}/why-ended?window=${window}`,
        { signal },
      ),
    enabled: enabled && id !== '' && id !== '0',
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
