import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useOptimisticMutation } from './useOptimisticMutation';
import type {
  Automation,
  AutomationFull,
  AutomationActionInput,
  AutomationConditionInput,
  AutomationHistoryListResponse,
  AutomationExecutionDetail,
  AutomationHistoryStatus,
  AutomationPresetsResponse,
  AutomationPreset,
  AutomationTriggerInput,
  RoutineTemplate,
  InstallRoutineRequest,
} from '@/api/types';

export type AutomationStepInput =
  | AutomationTriggerInput
  | AutomationConditionInput
  | AutomationActionInput;

export type AutomationFullInput = {
  name: string;
  description?: string;
  vehicle_id?: number | null;
  enabled?: boolean;
  triggers: AutomationTriggerInput[];
  conditions: AutomationConditionInput[];
  actions: AutomationActionInput[];
};

export const automationKeys = {
  all: ['automations'] as const,
  detail: (id: number) => ['automations', id] as const,
  history: (limit?: number) => ['automation-history', limit] as const,
};

export function useAutomations() {
  return useQuery({
    queryKey: automationKeys.all,
    queryFn: ({ signal }) => request<Automation[]>('/automations', { signal }),
    refetchInterval: INTERVALS.STANDARD,
    select: safeArray,
  });
}

export function useAutomationHistory(limit = 20) {
  return useQuery({
    queryKey: automationKeys.history(limit),
    queryFn: ({ signal }) =>
      request<AutomationHistoryListResponse>(`/automations/history?limit=${limit}`, { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/** Server-side history pagination; do not filter a recent-only page in memory. */
export interface AutomationHistoryPageFilters {
  page: number;
  pageSize: number;
  automationId?: number;
  status?: AutomationHistoryStatus;
  since?: string;
  until?: string;
}

/** Fail closed: a missing server envelope must never masquerade as empty history. */
function assertHistoryPage(value: unknown): AutomationHistoryListResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid automation history response');
  const page = value as Partial<AutomationHistoryListResponse>;
  const summary = page.summary;
  if (
    !Array.isArray(page.items)
    || !Number.isSafeInteger(page.total) || page.total! < 0
    || !Number.isSafeInteger(page.limit) || page.limit! <= 0
    || !Number.isSafeInteger(page.offset) || page.offset! < 0
    || !summary
    || !Number.isSafeInteger(summary.total_executions)
    || !Number.isSafeInteger(summary.succeeded)
    || !Number.isSafeInteger(summary.failed)
    || !Number.isSafeInteger(summary.partial)
    || !Number.isFinite(summary.success_rate)
    || !Number.isFinite(summary.avg_duration_ms)
    || !Array.isArray(page.trend)
    || !page.trend.every((point) =>
      point != null && typeof point.day === 'string'
      && typeof point.status === 'string'
      && Number.isSafeInteger(point.count) && point.count >= 0)
    || !page.items.every((item) =>
      item != null && Number.isSafeInteger(item.id)
      && typeof item.automation_name === 'string'
      && typeof item.triggered_at === 'string'
      && typeof item.status === 'string')
  ) {
    throw new Error('Invalid automation history response');
  }
  return page as AutomationHistoryListResponse;
}

export function useAutomationHistoryPage(filters: AutomationHistoryPageFilters) {
  const { page, pageSize, automationId, status, since, until } = filters;
  return useQuery({
    queryKey: ['automation-history', 'page', page, pageSize, automationId, status, since, until],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      if (status) params.set('status', status);
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      // The global endpoint does not accept automation_id; the per-automation
      // endpoint uses the same paginated response and applies that filter in SQL.
      const path = automationId != null
        ? `/automations/${automationId}/history`
        : '/automations/history';
      return request<AutomationHistoryListResponse>(`${path}?${params}`, { signal }).then(assertHistoryPage);
    },
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useAutomationExecutionDetail(id: number | null) {
  return useQuery({
    queryKey: ['automation-history', 'detail', id],
    queryFn: ({ signal }) =>
      request<AutomationExecutionDetail>(`/automations/history/${id}`, { signal }),
    enabled: id != null,
    staleTime: STALE_TIMES.STANDARD,
  });
}

/** Typed CTI automation export envelope accepted by `POST /automations/import`. */
export interface AutomationImportEnvelope {
  version: number;
  exported_at?: string;
  automations: unknown[];
}

export interface AutomationImportResult {
  imported?: number;
  skipped?: number;
}

/**
 * useImportAutomations — POST /automations/import.
 * Uploads a typed CTI automation export envelope, then invalidates the
 * automations list + history so the newly imported rows surface without a
 * full-page reload. Success/failure are surfaced through the toast system.
 */
export function useImportAutomations() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (envelope: AutomationImportEnvelope) =>
      request<AutomationImportResult>('/automations/import', {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      invalidateAndBroadcast(qc, { queryKey: ['automation-history'] });
      success('toast.automation.import.success', 'Automations imported');
    },
    onError: (err) =>
      error(err, 'toast.automation.import.error', 'Failed to import automations'),
  });
}

export function useToggleAutomation() {
  const { success, error } = useMutationToast();
  return useOptimisticMutation<
    { id: number; enabled: boolean },
    { id: number; enabled: boolean },
    Automation[]
  >({
    mutationFn: ({ id, enabled }) =>
      request<{ id: number; enabled: boolean }>(`/automations/${id}/toggle`, {
        method: 'PATCH',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    queryKeys: [automationKeys.all],
    networkMode: 'always',
    updater: (prev, { id, enabled }) => {
      // The `['automations']` prefix also matches the object-shaped
      // `['automations', id]` detail cache written by `useAutomation`.
      // Guard so the optimistic `.map` only runs on the array-shaped list
      // and non-array sibling caches are left untouched — otherwise
      // `prev.map` throws "prev.map is not a function" and breaks the toggle.
      if (!Array.isArray(prev)) return prev;
      return prev.map((a) => (a.id === id ? { ...a, enabled } : a));
    },
    broadcast: true,
    onMutate: () => {
      // Optimistic flip already applied by the helper. Toast waits for
      // server confirmation so a failed PATCH doesn't end up reading
      // "Enabled" while the switch has already snapped back to off.
    },
    onSuccess: (_data, { enabled }) => {
      if (enabled) {
        success('toast.automation.enabled', 'Automation enabled');
      } else {
        success('toast.automation.disabled', 'Automation disabled');
      }
    },
    onError: (err) =>
      error(err, 'toast.automation.toggle.error', 'Failed to toggle automation'),
  });
}

export function useReEnableAutomation() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ id: number; enabled: boolean; auto_disabled: boolean }>(
        `/automations/${id}/re-enable`,
        { method: 'PATCH', requiresLiveMode: true },
      ),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      success('toast.automation.reEnable.success', 'Automation re-enabled');
    },
    onError: (err) => error(err, 'toast.automation.reEnable.error', 'Failed to re-enable automation'),
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}`, {
        method: 'DELETE',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      invalidateAndBroadcast(qc, { queryKey: ['automation-history'] });
      success('toast.automation.delete.success', 'Automation deleted');
    },
    onError: (err) => error(err, 'toast.automation.delete.error', 'Failed to delete automation'),
  });
}

export type AutomationBulkOp = 'enable' | 'disable' | 'delete';

export interface AutomationBulkResult {
  updated?: number;
  deleted?: number;
  failed: { id: number; reason: string }[];
}

/**
 * useBulkAutomationsUpdate — POST /automations/bulk.
 * Issues an allowlisted bulk op against `ids`, invalidates the
 * automations list + history, and toasts on outcome.
 */
export function useBulkAutomationsUpdate() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vars: { ids: number[]; op: AutomationBulkOp }) =>
      request<AutomationBulkResult>('/automations/bulk', {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: vars.ids, op: vars.op }),
      }),
    networkMode: 'always',
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      invalidateAndBroadcast(qc, { queryKey: ['automation-history'] });
      const key = `toast.automation.bulk.${vars.op}.success`;
      const fallback = vars.op === 'delete'
        ? 'Automations deleted'
        : vars.op === 'enable'
          ? 'Automations enabled'
          : 'Automations disabled';
      success(key, fallback);
    },
    onError: (err) =>
      error(err, 'toast.automation.bulk.error', 'Bulk automation update failed'),
  });
}

export function useTestRunAutomation() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}/test-run`, {
        method: 'POST',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-history'] });
      success('toast.automation.testRun.success', 'Test run started');
    },
    onError: (err) => error(err, 'toast.automation.testRun.error', 'Failed to start test run'),
  });
}

export function useAutomation(id: number | string | undefined) {
  const numericId = typeof id === 'string' ? Number(id) : id;
  return useQuery({
    queryKey: automationKeys.detail(numericId!),
    // Fetch with the validated numeric id so the request URL, the query
    // key, and the `enabled` guard all agree (a string like "05" resolves
    // to the same cache key AND the same canonical `/automations/5` URL).
    queryFn: ({ signal }) => request<AutomationFull>(`/automations/${numericId}`, { signal }),
    enabled: numericId != null && !Number.isNaN(numericId) && numericId > 0,
  });
}

export function useCreateAutomationFull() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (input: AutomationFullInput) =>
      request<AutomationFull>('/automations', {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      success('toast.automation.create.success', 'Automation created');
    },
    onError: (err) => error(err, 'toast.automation.create.error', 'Failed to create automation'),
  });
}

export function useUpdateAutomationFull() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AutomationFullInput }) =>
      request<AutomationFull>(`/automations/${id}`, {
        method: 'PUT',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    networkMode: 'always',
    onSuccess: (_d, vars) => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      invalidateAndBroadcast(qc, { queryKey: automationKeys.detail(vars.id) });
      success('toast.automation.update.success', 'Automation updated');
    },
    onError: (err) => error(err, 'toast.automation.update.error', 'Failed to update automation'),
  });
}

// ── Preset hooks ──────────────────────────────────────────────────────────────

export const presetKeys = {
  all: ['automation-presets'] as const,
  category: (cat: string) => ['automation-presets', cat] as const,
  detail: (id: string) => ['automation-preset', id] as const,
};

export function useAutomationPresets(category?: string) {
  const queryParam = category ? `?category=${encodeURIComponent(category)}` : '';
  return useQuery({
    queryKey: category ? presetKeys.category(category) : presetKeys.all,
    queryFn: ({ signal }) =>
      request<AutomationPresetsResponse>(`/automations/presets${queryParam}`, { signal }),
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useAutomationPreset(id: string | undefined) {
  return useQuery({
    queryKey: presetKeys.detail(id!),
    queryFn: ({ signal }) =>
      request<AutomationPreset>(`/automations/presets/${encodeURIComponent(id!)}`, { signal }),
    enabled: !!id,
    staleTime: STALE_TIMES.STATIC,
  });
}

// ── Geofence routine templates ─────────────────────────────────────────

export const routineKeys = {
  all: ['automation-routines'] as const,
};

/** Fetches the parameterized geofence routine catalogue. */
export function useRoutineTemplates() {
  return useQuery({
    queryKey: routineKeys.all,
    queryFn: ({ signal }) => request<RoutineTemplate[]>('/automations/routine-templates', { signal }),
    staleTime: STALE_TIMES.STATIC,
    select: safeArray,
  });
}

/** Mutation to install a routine for a chosen place. */
export function useInstallRoutine() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...params }: InstallRoutineRequest & { id: string }) =>
      request<Automation>(`/automations/routine-templates/${encodeURIComponent(id)}/install`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      success('toast.automations.routine.success', 'Routine installed');
    },
    onError: (err) => error(err, 'toast.automations.routine.error', 'Failed to install routine'),
  });
}
