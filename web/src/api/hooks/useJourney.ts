import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopedPath } from '../scope';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';

/**
 * Journey Autopilot: trip sessions + versioned plans. Reads the backend
 * routes registered in internal/api/router.go:
 *
 *   POST /journey/sessions
 *   GET  /journey/sessions?vehicle_id=&status=&limit=
 *   GET  /journey/sessions/{id}
 *   POST /journey/sessions/{id}/start|pause|resume|complete|abort
 *   POST /journey/sessions/{id}/plans
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags. Durations are SI seconds; the UI converts at render.
 */

export type JourneyStatus = 'planned' | 'active' | 'paused' | 'completed' | 'aborted';

export interface JourneySession {
  id: number;
  vehicle_id: number;
  name: string;
  origin_name: string;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_name: string;
  dest_lat: number | null;
  dest_lng: number | null;
  status: JourneyStatus;
  plan_version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface JourneyPlanVersion {
  id: number;
  session_id: number;
  version: number;
  plan: unknown;
  note: string;
  created_at: string;
}

export interface JourneyDetail {
  session: JourneySession;
  plans: JourneyPlanVersion[];
  next_statuses: JourneyStatus[];
}

export interface CreateJourneyRequest {
  vehicle_id: number;
  name: string;
  origin_name?: string;
  origin_lat?: number | null;
  origin_lng?: number | null;
  dest_name?: string;
  dest_lat?: number | null;
  dest_lng?: number | null;
}

export interface ScoreCandidate {
  site: string;
  lat: number;
  lng: number;
  arrive_at: string;
}

export interface ScoredStop {
  site: string;
  score: number;
  wait_s: number | null;
  per_kwh: number | null;
  health: number | null;
  corridor_m: number;
  evidence: string[];
}

export interface StopScores {
  session_id: number;
  energy_wh: number;
  stops: ScoredStop[];
  winner: string;
  plan_version: number;
}

export interface ScoreStopsRequest {
  id: number;
  candidates: ScoreCandidate[];
  energy_wh: number;
}

export interface DepartureSlot {
  depart_at: string;
  level: 'none' | 'watch' | 'warning';
  score: number;
}

export interface DepartureAdvice {
  session_id: number;
  slots: DepartureSlot[];
  recommended_at: string | null;
  charge: { soc_pct: number | null; limit_pct: number | null } | null;
  evidence: string[];
}

export type ChecklistStatus = 'ok' | 'attention' | 'action' | 'unknown';

export interface ChecklistItem {
  key: string;
  status: ChecklistStatus;
  detail: string;
}

export interface ChecklistRun {
  id: number;
  session_id: number;
  run_at: string;
  items: ChecklistItem[];
}

export interface JourneyCheckpoint {
  id: number;
  session_id: number;
  recorded_at: string;
  lat: number;
  lng: number;
  soc_pct: number | null;
  odometer_m: number | null;
}

export interface JourneyProgress {
  total_m: number;
  done_m: number;
  left_m: number;
}

export type JourneyRangeVerdict = 'ok' | 'attention' | 'action' | 'unknown';

export interface JourneyRange {
  have_wh: number | null;
  need_wh: number | null;
  eff_wh_km: number | null;
  verdict: JourneyRangeVerdict;
}

export interface JourneyNextStop {
  site: string;
  wait_s: number | null;
}

export interface JourneyLiveView {
  session: JourneySession;
  latest: JourneyCheckpoint | null;
  trail: JourneyCheckpoint[];
  progress: JourneyProgress | null;
  range: JourneyRange;
  next: JourneyNextStop | null;
  evidence: string[];
}

export type JourneyDeviationVerdict = 'on_track' | 'drifted' | 'off_route' | 'unknown';

export interface JourneyReplanAssessment {
  session_id: number;
  deviation: { deviation_m: number | null; verdict: JourneyDeviationVerdict };
  latest: JourneyCheckpoint | null;
  evidence: string[];
}

export interface JourneyArrival {
  session_id: number;
  dest_name: string;
  left_m: number | null;
  pace_ms: number | null;
  eta_at: string | null;
  moving: boolean;
  verdict: ChecklistStatus;
  shortfall_wh: number | null;
  evidence: string[];
}

export interface JourneyChecklistRecap {
  ready: number;
  total: number;
}

export interface JourneyReport {
  session_id: number;
  status: JourneyStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  distance_m: number | null;
  fixes: number;
  plans: number;
  replans: number;
  detour: number | null;
  checklist: JourneyChecklistRecap | null;
  evidence: string[];
}

export const journeyKeys = {
  all: ['journey'] as const,
  list: (vehicleId: number | null, status: string) =>
    ['journey', 'sessions', vehicleId, status] as const,
  detail: (id: number | null) => ['journey', 'session', id] as const,
  departure: (id: number | null, from: string | null, to: string | null) =>
    ['journey', 'departure', id, from, to] as const,
  checklist: (id: number | null) => ['journey', 'checklist', id] as const,
  live: (id: number | null) => ['journey', 'live', id] as const,
  replan: (id: number | null) => ['journey', 'replan', id] as const,
  arrival: (id: number | null) => ['journey', 'arrival', id] as const,
  report: (id: number | null) => ['journey', 'report', id] as const,
};

function isValidVehicle(vehicleId: number | null | undefined): vehicleId is number {
  return vehicleId != null && vehicleId > 0;
}

/** Lists journey sessions for a vehicle, newest first. */
export function useJourneys(
  vehicleId: number | null | undefined,
  status = '',
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: journeyKeys.list(vehicleId ?? null, status),
    queryFn: ({ signal }) => {
      if (!isValidVehicle(vehicleId)) {
        throw new Error('vehicle_id must be a positive integer');
      }
      return request<JourneySession[]>(
        scopedPath('/journey/sessions', {
          vehicleId,
          filters: { status: status || null },
        }),
        { signal },
      );
    },
    enabled: (options?.enabled ?? true) && isValidVehicle(vehicleId),
    ...queryPolicy('operational'),
    select: safeArray,
  });
}

/** Reads one session with its plan history and reachable statuses. */
export function useJourney(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.detail(id ?? null),
    queryFn: ({ signal }) =>
      request<JourneyDetail>(`/journey/sessions/${id}`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('operational'),
  });
}

/** Plans a new journey (starts in `planned`). */
export function useCreateJourney() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: CreateJourneyRequest) =>
      request<JourneySession>('/journey/sessions', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (session) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.all });
      success('toast.journey.create.success', 'Journey planned', {
        name: session.name,
      });
    },
    onError: (err) => error(err, 'toast.journey.create.error', 'Failed to plan journey'),
  });
}

export type JourneyTransition = 'start' | 'pause' | 'resume' | 'complete' | 'abort';

/** Ranks candidate stops on wait, price, health, and corridor deviation. */
export function useScoreStops() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, candidates, energy_wh }: ScoreStopsRequest) =>
      request<StopScores>(`/journey/sessions/${id}/score-stops`, {
        method: 'POST',
        body: JSON.stringify({ candidates, energy_wh }),
      }),
    onSuccess: (scores) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.detail(scores.session_id) });
      success('toast.journey.score.success', 'Stops scored — {{winner}} wins', {
        winner: scores.winner,
      });
    },
    onError: (err) => error(err, 'toast.journey.score.error', 'Failed to score stops'),
  });
}

/** Ranks departure slots for a session. from/to are RFC3339; null = server default. */
export function useDeparture(
  id: number | null | undefined,
  from: string | null,
  to: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: journeyKeys.departure(id ?? null, from, to),
    queryFn: ({ signal }) =>
      request<DepartureAdvice>(
        scopedPath(`/journey/sessions/${id}/departure`, {
          filters: { from, to },
        }),
        { signal },
      ),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('operational'),
  });
}

/** Reads the latest checklist run for a session. */
export function useChecklist(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.checklist(id ?? null),
    queryFn: ({ signal }) =>
      request<ChecklistRun>(`/journey/sessions/${id}/checklist`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('operational'),
  });
}

/** Evaluates readiness live and persists the run. */
export function useRefreshChecklist() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<ChecklistRun>(`/journey/sessions/${id}/checklist/runs`, { method: 'POST' }),
    onSuccess: (run) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.checklist(run.session_id) });
      const blocking = run.items.filter((i) => i.status === 'action').length;
      success(
        blocking === 0
          ? 'toast.journey.checklist.clear'
          : 'toast.journey.checklist.attention',
        blocking === 0 ? 'Ready to roll' : '{{count}} items need attention',
        { count: blocking },
      );
    },
    onError: (err) => error(err, 'toast.journey.checklist.error', 'Checklist failed'),
  });
}

/** Reads the glanceable live snapshot for a session (progress, range, trail). */
export function useJourneyLive(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.live(id ?? null),
    queryFn: ({ signal }) =>
      request<JourneyLiveView>(`/journey/sessions/${id}/live`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('live'),
  });
}

/** Snapshots one trail point; the server backfills missing fields from live telemetry. */
export function useCheckIn() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<JourneyCheckpoint>(`/journey/sessions/${id}/checkpoints`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (checkpoint) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.live(checkpoint.session_id) });
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.replan(checkpoint.session_id) });
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.arrival(checkpoint.session_id) });
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.report(checkpoint.session_id) });
      success('toast.journey.checkin.success', 'Checked in');
    },
    onError: (err) => error(err, 'toast.journey.checkin.error', 'Check-in failed'),
  });
}

/** Reads the corridor-deviation assessment for a session. */
export function useReplanAssessment(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.replan(id ?? null),
    queryFn: ({ signal }) =>
      request<JourneyReplanAssessment>(`/journey/sessions/${id}/replan`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('operational'),
  });
}

/** Re-ranks the saved candidates from the latest fix; persists a replan version. */
export function useRequestReplan() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, energy_wh }: { id: number; energy_wh?: number }) =>
      request<StopScores>(`/journey/sessions/${id}/replan`, {
        method: 'POST',
        body: JSON.stringify(energy_wh == null ? {} : { energy_wh }),
      }),
    onSuccess: (scores) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.detail(scores.session_id) });
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.live(scores.session_id) });
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.replan(scores.session_id) });
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.report(scores.session_id) });
      success('toast.journey.replan.success', 'Replanned — {{winner}} wins', {
        winner: scores.winner,
      });
    },
    onError: (err) => error(err, 'toast.journey.replan.error', 'Replan failed'),
  });
}

/** Reads the arrival prep snapshot (ETA from recent pace plus charge advice). */
export function useArrival(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.arrival(id ?? null),
    queryFn: ({ signal }) =>
      request<JourneyArrival>(`/journey/sessions/${id}/arrival`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('live'),
  });
}

/** Reads the debrief card for a session (a "so far" card while live). */
export function useReport(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.report(id ?? null),
    queryFn: ({ signal }) =>
      request<JourneyReport>(`/journey/sessions/${id}/report`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('operational'),
  });
}

/** Moves a session along its status machine. */
export function useTransitionJourney() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: JourneyTransition }) =>
      request<JourneySession>(`/journey/sessions/${id}/${action}`, { method: 'POST' }),
    onSuccess: (session) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.all });
      success('toast.journey.transition.success', 'Journey {{status}}', {
        status: session.status,
      });
    },
    onError: (err) => error(err, 'toast.journey.transition.error', 'Failed to update journey'),
  });
}
