import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
 *   - DEL  /data-repair/charging/{id}   (sudo)   → checksummed quarantine
 *   - PUT  /data-repair/drive/{id}      (sudo)   → PartialUpdate (DrivePartialAllowed)
 *   - POST /data-repair/drive/{id}/close         → explicit reviewed/manual ended_at
 *   - DEL  /data-repair/drive/{id}      (sudo)   → checksummed quarantine
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
  cases: (filters?: RepairCaseFilters) =>
    ['data-repair', 'cases', filters ?? {}] as const,
  case: (id: number) => ['data-repair', 'cases', id] as const,
  quarantines: (filters?: RepairQuarantineFilters) =>
    ['data-repair', 'quarantine', filters ?? {}] as const,
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
  case_id?: number;
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

export interface RepairPreviewValue {
  type: 'null' | 'timestamp' | 'int64' | 'float64' | 'string';
  null?: boolean;
  timestamp?: string;
  int64?: number;
  float64?: number;
  string?: string;
}

export interface RepairPreviewFieldChange {
  field: string;
  before: RepairPreviewValue;
  after: RepairPreviewValue;
}

export interface RepairPreviewPreservedField {
  field: string;
  value: RepairPreviewValue;
  reason: string;
}

export interface RepairImpactPreview {
  kind: RepairSessionKind;
  session_id: number;
  rule: string;
  source: 'manual' | 'suggestion';
  status: 'ready' | 'already_applied';
  started_at: string;
  current_ended_at: string | null;
  proposed_ended_at: string;
  current_duration_s: number | null;
  proposed_duration_s: number;
  fields_changed: RepairPreviewFieldChange[];
  fields_preserved: RepairPreviewPreservedField[];
  warnings: string[];
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

export function useRepairImpactPreview(kind: RepairSessionKind) {
  return useMutation({
    mutationFn: ({ id, ...body }: ApplyRepairInput | ManualCloseRepairInput) =>
      request<RepairImpactPreview>(`/data-repair/${kind === 'drive' ? 'drive' : 'charging'}/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
  });
}

/** Invalidate both worklists — an applied repair changes the stale inventory too. */
function invalidateRepairViews(qc: ReturnType<typeof useQueryClient>): void {
  invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
  invalidateAndBroadcast(qc, { queryKey: ['data-repair', 'suggestions'] });
}

function invalidateDriveDerivedViews(qc: ReturnType<typeof useQueryClient>): void {
  invalidateAndBroadcast(qc, { queryKey: ['drives'] });
  invalidateAndBroadcast(qc, { queryKey: ['drive'] });
  invalidateAndBroadcast(qc, { queryKey: ['analytics', 'fsd'] });
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
      invalidateRepairCases(qc);
      invalidateDriveDerivedViews(qc);
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
      invalidateRepairCases(qc);
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

export function useQuarantineCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      request(`/data-repair/charging/${id}`, {
        method: 'DELETE',
        requiresLiveMode: true,
        body: JSON.stringify({ reason }),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairViews(qc);
      invalidateRepairCases(qc);
      success('toast.dataRepair.charging.quarantine.success', 'Charging session moved to quarantine');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.quarantine.error', 'Failed to quarantine charging session'),
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
      invalidateDriveDerivedViews(qc);
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
      invalidateDriveDerivedViews(qc);
      success('toast.dataRepair.drive.close.success', 'Drive closed');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.close.error', 'Failed to close drive'),
  });
}

export function useQuarantineDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => request(`/data-repair/drive/${id}`, {
      method: 'DELETE',
      requiresLiveMode: true,
      body: JSON.stringify({ reason }),
    }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairViews(qc);
      invalidateRepairCases(qc);
      invalidateDriveDerivedViews(qc);
      success('toast.dataRepair.drive.quarantine.success', 'Drive moved to quarantine');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.quarantine.error', 'Failed to quarantine drive'),
  });
}

// ─── Durable repair-case workflow ───────────────────────────────────────────

export type RepairCaseStatus =
  | 'open'
  | 'in_review'
  | 'applied'
  | 'dismissed'
  | 'quarantined'
  | 'restored'
  | 'resolved';

export interface RepairCase {
  id: number;
  fingerprint: string;
  kind: RepairSessionKind;
  session_id: number;
  related_session_id?: number | null;
  vehicle_id: number;
  rule: string;
  confidence: RepairConfidence;
  status: RepairCaseStatus;
  applicable: boolean;
  blocked_reason?: string | null;
  suggested_ended_at?: string | null;
  evidence_started_at: string;
  evidence_stored_ended_at?: string | null;
  evidence_contradiction_ts: string;
  evidence_contradiction_src: string;
  evidence_contradiction_field: string;
  evidence_contradiction_value: string;
  evidence_last_in_session_ts?: string | null;
  evidence_last_in_session_src?: string | null;
  evidence_last_in_session_field?: string | null;
  evidence_last_in_session_value?: string | null;
  evidence_gap_s: number;
  assigned_to?: string | null;
  resolution_note?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  applied_at?: string | null;
  dismissed_at?: string | null;
  quarantined_at?: string | null;
  restored_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepairCaseComment {
  id: number;
  case_id: number;
  actor: string;
  body: string;
  created_at: string;
}

export interface RepairQuarantine {
  id: number;
  case_id: number;
  kind: RepairSessionKind;
  session_id: number;
  vehicle_id: number;
  schema_version: number;
  checksum: string;
  reason: string;
  quarantined_by: string;
  quarantined_at: string;
  restored_by?: string | null;
  restored_at?: string | null;
}

export interface RepairCaseFilters {
  vehicle_id?: number;
  status?: RepairCaseStatus;
  kind?: RepairSessionKind;
  confidence?: RepairConfidence;
  assigned_to?: string;
  cursor_last_seen_at?: string;
  cursor_id?: number;
  limit?: number;
}

export interface RepairCaseListResponse {
  cases: RepairCase[];
  has_more: boolean;
  next_cursor?: {
    last_seen_at: string;
    id: number;
  } | null;
}

export interface RepairCaseDetailResponse {
  case: RepairCase;
  comments: RepairCaseComment[];
  quarantine?: RepairQuarantine | null;
}

export interface RepairQuarantineFilters {
  vehicle_id?: number;
  kind?: RepairSessionKind;
  restored?: boolean;
  cursor_quarantined_at?: string;
  cursor_id?: number;
  limit?: number;
}

export interface RepairQuarantineListResponse {
  quarantines: RepairQuarantine[];
  has_more: boolean;
  next_cursor?: {
    quarantined_at: string;
    id: number;
  } | null;
}

function caseParams(filters?: RepairCaseFilters): string {
  const params = new URLSearchParams();
  if (filters?.vehicle_id != null) params.set('vehicle_id', String(filters.vehicle_id));
  if (filters?.status) params.set('status', filters.status);
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.confidence) params.set('confidence', filters.confidence);
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to);
  if (filters?.cursor_last_seen_at) {
    params.set('cursor_last_seen_at', filters.cursor_last_seen_at);
  }
  if (filters?.cursor_id != null) params.set('cursor_id', String(filters.cursor_id));
  if (filters?.limit != null) params.set('limit', String(filters.limit));
  return params.toString();
}

export function useRepairCases(filters?: RepairCaseFilters) {
  const qs = caseParams(filters);
  return useQuery({
    queryKey: dataRepairKeys.cases(filters),
    queryFn: ({ signal }) =>
      request<RepairCaseListResponse>(`/data-repair/cases${qs ? `?${qs}` : ''}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useRepairCase(caseId: number | null) {
  return useQuery({
    queryKey: dataRepairKeys.case(caseId ?? 0),
    queryFn: ({ signal }) =>
      request<RepairCaseDetailResponse>(`/data-repair/cases/${caseId}`, { signal }),
    enabled: caseId != null && caseId > 0,
    staleTime: 10_000,
  });
}

function invalidateRepairCases(qc: ReturnType<typeof useQueryClient>): void {
  invalidateAndBroadcast(qc, { queryKey: ['data-repair', 'cases'] });
  invalidateAndBroadcast(qc, { queryKey: ['data-repair', 'quarantine'] });
}

export interface RepairCaseTransitionInput {
  case_id: number;
  status: RepairCaseStatus;
  expected_updated_at: string;
  resolution_note?: string;
}

export function useTransitionRepairCase() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ case_id, ...body }: RepairCaseTransitionInput) =>
      request<RepairCase>(`/data-repair/cases/${case_id}/transition`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairCases(qc);
      success('toast.dataRepair.case.transition.success', 'Repair case updated');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.case.transition.error', 'Failed to update repair case'),
  });
}

export interface BulkRepairCaseTransitionInput {
  case_ids: number[];
  status: Extract<RepairCaseStatus, 'in_review' | 'dismissed'>;
  resolution_note?: string;
}

export function useBulkTransitionRepairCases() {
  const qc = useQueryClient();
  const { success, warning, error } = useMutationToast();
  return useMutation({
    mutationFn: (body: BulkRepairCaseTransitionInput) =>
      request<{ updated: number; skipped: number }>('/data-repair/cases/bulk-transition', {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
    onSuccess: (result) => {
      invalidateRepairCases(qc);
      if (result.skipped > 0) {
        warning(
          result.updated > 0
            ? 'toast.dataRepair.case.bulk.partial'
            : 'toast.dataRepair.case.bulk.skipped',
          result.updated > 0
            ? 'Updated {{updated}} repair cases; {{skipped}} skipped'
            : 'No repair cases were updated; {{skipped}} skipped',
          result,
        );
        return;
      }
      success(
        'toast.dataRepair.case.bulk.success',
        'Updated {{count}} repair cases',
        { count: result.updated },
      );
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.case.bulk.error', 'Failed to update repair cases'),
  });
}

export function useAssignRepairCase() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({
      case_id,
      assigned_to,
    }: {
      case_id: number;
      assigned_to: string | null;
    }) =>
      request<RepairCase>(`/data-repair/cases/${case_id}/assignment`, {
        method: 'PUT',
        requiresLiveMode: true,
        body: JSON.stringify({ assigned_to }),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairCases(qc);
      success('toast.dataRepair.case.assign.success', 'Case assignment updated');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.case.assign.error', 'Failed to update case assignment'),
  });
}

export function useAddRepairCaseComment() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ case_id, body }: { case_id: number; body: string }) =>
      request<RepairCaseComment>(`/data-repair/cases/${case_id}/comments`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify({ body }),
      }),
    networkMode: 'always',
    onSuccess: (_result, variables) => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.case(variables.case_id) });
      success('toast.dataRepair.case.comment.success', 'Comment added');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.case.comment.error', 'Failed to add comment'),
  });
}

export function useRunRepairScan() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (input?: { vehicle_id?: number }) =>
      request<{ discovered: number; refreshed: number; truncated: boolean }>(
        '/data-repair/cases/scan',
        {
          method: 'POST',
          requiresLiveMode: true,
          body: JSON.stringify(input ?? {}),
        },
      ),
    networkMode: 'always',
    onSuccess: () => {
      invalidateRepairCases(qc);
      success('toast.dataRepair.scan.success', 'Data integrity scan completed');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.scan.error', 'Data integrity scan failed'),
  });
}

function quarantineParams(filters?: RepairQuarantineFilters): string {
  const params = new URLSearchParams();
  if (filters?.vehicle_id != null) params.set('vehicle_id', String(filters.vehicle_id));
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.restored != null) params.set('restored', String(filters.restored));
  if (filters?.cursor_quarantined_at) {
    params.set('cursor_quarantined_at', filters.cursor_quarantined_at);
  }
  if (filters?.cursor_id != null) params.set('cursor_id', String(filters.cursor_id));
  if (filters?.limit != null) params.set('limit', String(filters.limit));
  return params.toString();
}

export function useRepairQuarantines(filters?: RepairQuarantineFilters) {
  const qs = quarantineParams(filters);
  return useQuery({
    queryKey: dataRepairKeys.quarantines(filters),
    queryFn: ({ signal }) =>
      request<RepairQuarantineListResponse>(
        `/data-repair/quarantine${qs ? `?${qs}` : ''}`,
        { signal },
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useQuarantineRepairCase() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ case_id, reason }: { case_id: number; reason: string }) =>
      request<RepairQuarantine>(`/data-repair/cases/${case_id}/quarantine`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify({ reason }),
      }),
    networkMode: 'always',
    onSuccess: (result) => {
      invalidateRepairCases(qc);
      invalidateRepairViews(qc);
      if (result.kind === 'drive') {
        invalidateDriveDerivedViews(qc);
      }
      success('toast.dataRepair.quarantine.success', 'Session moved to quarantine');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.quarantine.error', 'Failed to quarantine session'),
  });
}

export function useRestoreQuarantine() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ quarantine_id, reason }: { quarantine_id: number; reason: string }) =>
      request<RepairQuarantine>(`/data-repair/quarantine/${quarantine_id}/restore`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify({ reason }),
      }),
    networkMode: 'always',
    onSuccess: (result) => {
      invalidateRepairCases(qc);
      invalidateRepairViews(qc);
      if (result.kind === 'drive') {
        invalidateDriveDerivedViews(qc);
      }
      success('toast.dataRepair.restore.success', 'Session restored');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.restore.error', 'Failed to restore session'),
  });
}
