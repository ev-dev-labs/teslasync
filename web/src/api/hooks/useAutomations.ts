import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useOptimisticMutation } from './useOptimisticMutation';
import { pinnedKeys } from './usePinned';
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
  PinnedItem,
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
    queryFn: ({ signal }) => request<Automation[]>('/automations', { signal }).then((value) => assertAutomationInventory(value)),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/** List-only derived fields; no stored auto-disable authority exists. */
export type AutomationListItem = Pick<Automation,
  'id' | 'name' | 'description' | 'vehicle_id' | 'created_at' | 'updated_at'
> & Partial<Omit<Automation,
  'enabled' | 'auto_disabled' | 'execution_count' | 'failure_count' | 'last_triggered_at'
>> & {
  enabled?: boolean | null;
  auto_disabled?: boolean | null;
  execution_count?: number | null;
  failure_count?: number | null;
  last_triggered_at?: string | null;
};

export function automationNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function automationStatus(a: AutomationListItem): 'active' | 'disabled' | 'auto-disabled' | null {
  if (a.auto_disabled === true) return 'auto-disabled';
  if (a.auto_disabled !== false || typeof a.enabled !== 'boolean') return null;
  return a.enabled ? 'active' : 'disabled';
}

export function automationTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value))
    ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the supported base row; derived history/status fields may be unknown. */
export function assertAutomationInventory<T extends AutomationListItem>(value: T[]): T[];
export function assertAutomationInventory(value: unknown): AutomationListItem[];
export function assertAutomationInventory(value: unknown): AutomationListItem[] {
  if (!Array.isArray(value) || !value.every((row: unknown) =>
    isRecord(row)
    && Number.isSafeInteger(row.id) && Number(row.id) > 0
    && typeof row.name === 'string'
    && (row.enabled == null || typeof row.enabled === 'boolean')
    && (row.description == null || typeof row.description === 'string')
    && (row.vehicle_id == null || (Number.isSafeInteger(row.vehicle_id) && Number(row.vehicle_id) > 0))
    && automationTimestamp(row.created_at) != null
    && automationTimestamp(row.updated_at) != null
    && (row.auto_disabled == null || typeof row.auto_disabled === 'boolean')
    && ['execution_count', 'failure_count'].every((key) =>
      row[key] == null || automationNumber(row[key]) != null)
    && (row.last_triggered_at == null || automationTimestamp(row.last_triggered_at) != null)
  )) {
    throw new Error('Invalid automation inventory response');
  }
  return value;
}

export function assertRoutineTemplates(value: unknown): RoutineTemplate[] {
  if (!Array.isArray(value) || !value.every((row: unknown) =>
    isRecord(row)
    && typeof row.id === 'string' && row.id.trim() !== ''
    && typeof row.name === 'string'
    && typeof row.description === 'string'
    && (row.event === 'enter' || row.event === 'exit')
    && Array.isArray(row.actions)
    && row.actions.every((action: unknown) =>
      isRecord(action) && typeof action.command === 'string' && action.command.trim() !== ''
      && (action.params == null || isRecord(action.params)))
  )) {
    throw new Error('Invalid automation routine templates response');
  }
  return value;
}

export function useAutomationList() {
  return useQuery({
    queryKey: automationKeys.all,
    queryFn: ({ signal }) => request<unknown>('/automations', { signal }).then(assertAutomationInventory),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/** Validate before caching so a failed refresh retains the last valid pin order. */
export function assertPinnedAutomations(value: unknown): PinnedItem[] {
  if (!Array.isArray(value) || !value.every((row: unknown) =>
    isRecord(row)
    && Number.isSafeInteger(row.id) && Number(row.id) > 0
    && row.item_type === 'automation'
    && typeof row.item_id === 'string' && /^[1-9]\d*$/.test(row.item_id)
    && Number.isSafeInteger(Number(row.item_id))
    && Number.isSafeInteger(row.position) && Number(row.position) >= 0
    && automationTimestamp(row.pinned_at) != null
    && (row.user_id == null || (Number.isSafeInteger(row.user_id) && Number(row.user_id) > 0))
    && (row.context == null || typeof row.context === 'string')
  )) {
    throw new Error('Invalid pinned automation response');
  }
  return value;
}

export function usePinnedAutomations() {
  return useQuery({
    queryKey: pinnedKeys.list('automation'),
    queryFn: ({ signal }) => request<unknown>('/pinned?type=automation', { signal }).then(assertPinnedAutomations),
    staleTime: STALE_TIMES.SLOW,
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
  /** IANA zone for server-side daily trend buckets; bounds remain absolute. */
  timezone?: string;
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
  const { page, pageSize, automationId, status, since, until, timezone } = filters;
  return useQuery({
    queryKey: ['automation-history', 'page', page, pageSize, automationId, status, since, until, timezone ?? 'UTC'],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      if (status) params.set('status', status);
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      if (timezone) params.set('timezone', timezone);
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
  imported: { id: number; name: string; webhook_token?: string }[];
  errors: { index: number; name: string; error: string }[];
}

export function assertAutomationImportResult(value: unknown): AutomationImportResult {
  if (!isRecord(value)
    || !Array.isArray(value.imported)
    || !value.imported.every((row: unknown): row is AutomationImportResult['imported'][number] => isRecord(row)
      && Number.isSafeInteger(row.id) && Number(row.id) > 0
      && typeof row.name === 'string'
      && (row.webhook_token === undefined || typeof row.webhook_token === 'string'))
    || !Array.isArray(value.errors)
    || !value.errors.every((row: unknown): row is AutomationImportResult['errors'][number] => isRecord(row)
      && Number.isSafeInteger(row.index) && Number(row.index) >= 0
      && typeof row.name === 'string' && typeof row.error === 'string')) {
    throw new Error('Invalid automation import response');
  }
  return { imported: value.imported, errors: value.errors };
}

/**
 * useImportAutomations — POST /automations/import.
 * Uploads a typed CTI automation export envelope, then invalidates the
 * automations list + history so the newly imported rows surface without a
 * full-page reload. Success/failure are surfaced through the toast system.
 */
export function useImportAutomations() {
  const qc = useQueryClient();
  const { success, warning, error } = useMutationToast();
  return useMutation({
    mutationFn: (envelope: AutomationImportEnvelope) =>
      request<AutomationImportResult>('/automations/import', {
        method: 'POST',
        requiresLiveMode: true,
        // A fully rejected batch still contains actionable per-entry errors.
        acceptedStatuses: [422],
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      }).then(assertAutomationImportResult),
    networkMode: 'always',
    onSuccess: (data) => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      invalidateAndBroadcast(qc, { queryKey: ['automation-history'] });
      if (data.errors.length > 0) {
        if (data.imported.length === 0) {
          error(null, 'toast.automation.import.error', 'Failed to import automations');
          return;
        }
        warning('bulk.result.partial', '{{ok}} succeeded, {{failed}} failed', {
          ok: data.imported.length, failed: data.errors.length,
        });
        return;
      }
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
  const { success, warning, error } = useMutationToast();
  return useMutation({
    mutationFn: (vars: { ids: number[]; op: AutomationBulkOp }) =>
      request<AutomationBulkResult>('/automations/bulk', {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: vars.ids, op: vars.op }),
      }),
    networkMode: 'always',
    onSuccess: (data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      invalidateAndBroadcast(qc, { queryKey: ['automation-history'] });
      const completed = (vars.op === 'delete' ? data.deleted : data.updated) ?? 0;
      const failed = data.failed.length;
      if (completed === 0) {
        error(null, 'toast.automation.bulk.error', 'Bulk automation update failed');
        return;
      }
      if (failed > 0) {
        warning('bulk.result.partial', '{{ok}} succeeded, {{failed}} failed', { ok: completed, failed });
        return;
      }
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
    queryFn: ({ signal }) => request<RoutineTemplate[]>('/automations/routine-templates', { signal }).then(assertRoutineTemplates),
    staleTime: STALE_TIMES.STATIC,
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
        requiresLiveMode: true,
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: automationKeys.all });
      success('toast.automations.routine.success', 'Routine installed');
    },
    onError: (err) => error(err, 'toast.automations.routine.error', 'Failed to install routine'),
  });
}

/** Copies only the typed create contract, never IDs or execution state. */
export function automationCopyInput(full: AutomationFull, name: string): AutomationFullInput {
  const fields: Record<string, readonly string[]> = {
    trigger_signal:['signal','op','value_num','value_text','value_bool'],
    trigger_geofence:['place_id','event','dwell_minutes'],
    trigger_schedule:['cron_expr','timezone'], trigger_event:['event_type'],
    condition_signal:['signal','op','value_num','value_text','value_bool','value_min','value_max'],
    condition_time_window:['start_time','end_time','timezone','days_of_week'],
    condition_geofence:['place_id','state'], condition_other_automation:['other_automation_id','state'],
    action_command:['command_name','command_params'], action_notify:['channel_id','template'],
    action_wait:['duration_s'], action_set_setting:['setting_key','value_num','value_text','value_bool'],
    action_call_automation:['target_automation_id'],
  };
  const copyStep = (step: AutomationStepInput): AutomationStepInput => {
    const allowed = fields[step.kind];
    if (!allowed) throw new Error('Unsupported automation step kind');
    const record = step as unknown as Record<string, unknown>;
    return structuredClone(Object.fromEntries(['kind','step_order',...allowed]
      .filter(key => record[key] !== undefined).map(key => [key,record[key]]))) as AutomationStepInput;
  };
  return {name,description:full.description ?? undefined,vehicle_id:full.vehicle_id,enabled:false,
    triggers:full.triggers.map(copyStep) as AutomationTriggerInput[],
    conditions:full.conditions.map(copyStep) as AutomationConditionInput[],
    actions:full.actions.map(copyStep) as AutomationActionInput[]};
}

export function useDuplicateAutomation() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const full = await request<AutomationFull>(`/automations/${id}`);
      const input = automationCopyInput(full, t('automations.copyName', '{{name}} (copy)', {name:full.name}));
      return request<AutomationFull>('/automations', {method:'POST',requiresLiveMode:true,
        headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    },
    networkMode:'always',
    onSuccess:()=>{invalidateAndBroadcast(qc,{queryKey:automationKeys.all});success('toast.automation.create.success','Automation created');},
    onError:(err)=>error(err,'toast.automation.create.error','Failed to create automation'),
  });
}
