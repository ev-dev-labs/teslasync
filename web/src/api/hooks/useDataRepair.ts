import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';

/**
 * Data-repair hooks — the ONE data layer for the /data-repair page.
 *
 * Field naming follows the SI-canonical backend contract exactly:
 *   - GET  /data-repair/suggestions             → SessionRepairReport (read-only diagnosis)
 *   - GET  /data-repair/stale-sessions          → { stale_charging, stale_drives }
 *   - PUT  /data-repair/charging/{id}   (sudo)   → PartialUpdate (ChargingPartialAllowed)
 *   - POST /data-repair/charging/{id}/close      → explicit reviewed/manual ended_at
 *   - DEL  /data-repair/charging/{id}   (sudo)
 *   - PUT  /data-repair/drive/{id}      (sudo)   → PartialUpdate (DrivePartialAllowed)
 *   - POST /data-repair/drive/{id}/close         → explicit reviewed/manual ended_at
 *   - DEL  /data-repair/drive/{id}      (sudo)
 *
 * NOTE the drive routes are SINGULAR (`/drive/`), matching `internal/api/router.go`.
 * The pre-refactor page used `/drives/`, which 404'd every drive mutation.
 *
 * A repair is NEVER applied automatically. `useRepairSuggestions` only reads;
 * the apply mutations fire exclusively from an explicit, confirmed operator
 * action on one reviewed suggestion.
 *
 * Update payloads MUST be keyed by the SI-canonical column names the repo
 * whitelist accepts (`end_soc_pct`, `total_energy_added_wh`,
 * `peak_power_w`, `cost_decimal`, `distance_m`, `duration_s`, `max_speed_mps`,
 * …). Any other key is silently dropped by the backend filter.
 */

export const dataRepairKeys = {
  stale: ['data-repair', 'stale-sessions'] as const,
  suggestions: (scope?: RepairSuggestionScope) =>
    ['data-repair', 'suggestions', scope ?? {}] as const,
};

// ─── Evidence-based repair suggestions ───────────────────────────────────────

/**
 * Machine token for the detection rule behind a suggestion. Mirrors
 * `systemmodel.SessionRepairRule` — the UI maps each token to a localized
 * explanation, so the union must stay in lockstep with the Go constants.
 */
export type RepairRule =
  | 'drive_open_charging_started'
  | 'drive_open_park_observed'
  | 'drive_end_after_contradiction'
  | 'charging_open_charge_ended'
  | 'charging_open_drive_started'
  | 'charging_end_after_contradiction';

export type RepairConfidence = 'high' | 'medium';

export type RepairSessionKind = 'drive' | 'charging';

/** Durable table an observation was read from (`systemmodel.SessionRepairEvidenceSource`). */
export type RepairEvidenceSource =
  | 'signal_log'
  | 'drive_telemetry'
  | 'charging_telemetry'
  | 'drives'
  | 'charging_sessions';

/** One durable observation used to justify — or to bound — a suggestion. */
export interface RepairEvidence {
  ts: string;
  source: RepairEvidenceSource;
  field: string;
  value: string;
}

/**
 * A proposed, NOT-yet-applied session-boundary repair.
 *
 * Nothing here has been written. `applicable` reports whether the apply
 * endpoint would currently accept it; when false, `blocked_reason` carries the
 * machine token to explain and the Apply control must stay disabled.
 */
export interface RepairSuggestion {
  kind: RepairSessionKind;
  session_id: number;
  vehicle_id: number;
  rule: RepairRule;
  confidence: RepairConfidence;
  started_at: string;
  stored_ended_at: string | null;
  stored_duration_s: number | null;
  last_in_session_evidence: RepairEvidence | null;
  contradicting_evidence: RepairEvidence;
  suggested_ended_at: string;
  /** SI seconds. */
  suggested_duration_s: number;
  /** SI seconds of unobserved time between the last in-session evidence and the contradiction. */
  evidence_gap_s: number;
  applicable: boolean;
  blocked_reason?: string;
}

export interface RepairSuggestionsResponse {
  generated_at: string;
  lookback_days: number;
  scanned_drives: number;
  scanned_charging_sessions: number;
  drive_suggestions: RepairSuggestion[];
  charging_suggestions: RepairSuggestion[];
  truncated: boolean;
}

export interface RepairSuggestionScope {
  vehicle_id?: number;
  lookback_days?: number;
  limit?: number;
}

/**
 * useRepairSuggestions — GET /data-repair/suggestions.
 *
 * Read-only diagnosis. Deliberately NOT polled: the report is an operator
 * worklist that must not shuffle underneath a review, and refreshing it is an
 * explicit action.
 */
export function useRepairSuggestions(scope?: RepairSuggestionScope) {
  const params = new URLSearchParams();
  if (scope?.vehicle_id != null) params.set('vehicle_id', String(scope.vehicle_id));
  if (scope?.lookback_days != null) params.set('lookback_days', String(scope.lookback_days));
  if (scope?.limit != null) params.set('limit', String(scope.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: dataRepairKeys.suggestions(scope),
    queryFn: ({ signal }) =>
      request<RepairSuggestionsResponse>(`/data-repair/suggestions${qs ? `?${qs}` : ''}`, { signal }),
    staleTime: 30_000,
  });
}

/**
 * Body of the explicit apply. `expected_stored_ended_at` is the optimistic
 * concurrency pin the backend validates:
 *   - `''`                → assert the session is still OPEN
 *   - RFC3339 timestamp   → assert the stored `ended_at` still equals it
 */
export interface ApplyRepairInput {
  id: number;
  ended_at: string;
  rule: RepairRule;
  expected_stored_ended_at: string;
}

/** Explicit operator-entered boundary; never synthesized from browser time. */
export interface ManualCloseRepairInput {
  id: number;
  ended_at: string;
  rule: 'manual';
  expected_stored_ended_at: string;
}

export interface ApplyRepairResponse {
  status: 'closed' | 'already_applied';
  session_id: number;
  ended_at: string;
  duration_s?: number;
  recomputed_fields?: string[];
}

/**
 * Builds the request body from a suggestion so the page never hand-assembles
 * the concurrency pin (a wrong pin silently disables the conflict guard).
 */
export function repairApplyInput(suggestion: RepairSuggestion): ApplyRepairInput {
  return {
    id: suggestion.session_id,
    ended_at: suggestion.suggested_ended_at,
    rule: suggestion.rule,
    expected_stored_ended_at: suggestion.stored_ended_at ?? '',
  };
}

/** Invalidate both worklists — an applied repair changes the stale inventory too. */
function invalidateRepairViews(qc: ReturnType<typeof useQueryClient>): void {
  invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
  invalidateAndBroadcast(qc, { queryKey: ['data-repair', 'suggestions'] });
}

/**
 * useApplyDriveRepair — POST /data-repair/drive/{id}/close with a reviewed
 * boundary. Sudo-gated server-side; `requiresLiveMode` blocks it in read-only
 * operational mode before the request leaves the browser.
 */
export function useApplyDriveRepair() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...body }: ApplyRepairInput) =>
      request<ApplyRepairResponse>(`/data-repair/drive/${id}/close`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairViews(qc);
      success('toast.dataRepair.drive.apply.success', 'Drive boundary repaired');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.apply.error', 'Failed to repair drive boundary'),
  });
}

/** useApplyChargingRepair — POST /data-repair/charging/{id}/close with a reviewed boundary. */
export function useApplyChargingRepair() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...body }: ApplyRepairInput) =>
      request<ApplyRepairResponse>(`/data-repair/charging/${id}/close`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairViews(qc);
      success('toast.dataRepair.charging.apply.success', 'Charging boundary repaired');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.apply.error', 'Failed to repair charging boundary'),
  });
}

/** A charging session that is still open (no `ended_at`) past the stale cutoff. */
export interface StaleChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at?: string | null;
  start_soc_pct?: number | null;
  end_soc_pct?: number | null;
  delta_soc_pct?: number | null;
  total_energy_added_wh?: number | null;
  peak_power_w?: number | null;
  avg_power_w?: number | null;
  cost_decimal?: number | null;
  cost_currency?: string | null;
}

/** A drive that is still open (no `end_ts`) past the stale cutoff. */
export interface StaleDrive {
  id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts?: string | null;
  duration_s?: number | null;
  distance_m?: number | null;
  start_battery_pct?: number | null;
  end_battery_pct?: number | null;
  max_speed_mps?: number | null;
  avg_speed_mps?: number | null;
  energy_used_wh?: number | null;
}

export interface StaleSessionsResponse {
  stale_charging: StaleChargingSession[];
  stale_drives: StaleDrive[];
}

/** Partial patch keyed by SI-canonical column names accepted by the repo whitelist. */
export type RepairPatch = Record<string, string | number>;

/**
 * useStaleSessions — GET /data-repair/stale-sessions.
 * Polls every 30s so the worklist reflects sessions that self-close in the
 * background while the operator is triaging.
 */
export function useStaleSessions() {
  return useQuery({
    queryKey: dataRepairKeys.stale,
    queryFn: ({ signal }) =>
      request<StaleSessionsResponse>('/data-repair/stale-sessions', { signal }),
    refetchInterval: 30_000,
  });
}

// ─── Charging mutations ──────────────────────────────────────────────────────

export function useUpdateCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RepairPatch }) =>
      request(`/data-repair/charging/${id}`, {
        method: 'PUT',
        requiresLiveMode: true,
        body: JSON.stringify(patch),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.charging.update.success', 'Charging session updated');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.update.error', 'Failed to update charging session'),
  });
}

export function useCloseCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...body }: ManualCloseRepairInput) =>
      request(`/data-repair/charging/${id}/close`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.charging.close.success', 'Charging session closed');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.close.error', 'Failed to close charging session'),
  });
}

export function useDiscardCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request(`/data-repair/charging/${id}`, {
        method: 'DELETE',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.charging.discard.success', 'Charging session discarded');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.discard.error', 'Failed to discard charging session'),
  });
}

// ─── Drive mutations ─────────────────────────────────────────────────────────

export function useUpdateDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RepairPatch }) =>
      request(`/data-repair/drive/${id}`, {
        method: 'PUT',
        requiresLiveMode: true,
        body: JSON.stringify(patch),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.drive.update.success', 'Drive updated');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.update.error', 'Failed to update drive'),
  });
}

export function useCloseDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...body }: ManualCloseRepairInput) => request(`/data-repair/drive/${id}/close`, {
      method: 'POST',
      requiresLiveMode: true,
      body: JSON.stringify(body),
    }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.drive.close.success', 'Drive closed');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.close.error', 'Failed to close drive'),
  });
}

export function useDiscardDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request(`/data-repair/drive/${id}`, {
      method: 'DELETE',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.drive.discard.success', 'Drive discarded');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.discard.error', 'Failed to discard drive'),
  });
}
