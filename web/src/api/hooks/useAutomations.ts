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
  AutomationPresetsResponse,
  AutomationPreset,
  AutomationTriggerInput,
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
    queryFn: () => request<Automation[]>('/automations'),
    refetchInterval: INTERVALS.STANDARD,
    select: safeArray,
  });
}

export function useAutomationHistory(limit = 20) {
  return useQuery({
    queryKey: automationKeys.history(limit),
    queryFn: () =>
      request<AutomationHistoryListResponse>(`/automations/history?limit=${limit}`),
    refetchInterval: INTERVALS.STANDARD,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    queryKeys: [automationKeys.all],
    updater: (prev, { id, enabled }) =>
      prev?.map((a) => (a.id === id ? { ...a, enabled } : a)),
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
        { method: 'PATCH' },
      ),
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
      request<void>(`/automations/${id}`, { method: 'DELETE' }),
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
 * useBulkAutomationsUpdate — POST /automations/bulk
 * Phase-45 / Prompt 32. Issues an allowlisted bulk op against `ids`,
 * invalidates the automations list + history, and toasts on outcome.
 */
export function useBulkAutomationsUpdate() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vars: { ids: number[]; op: AutomationBulkOp }) =>
      request<AutomationBulkResult>('/automations/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: vars.ids, op: vars.op }),
      }),
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
      request<void>(`/automations/${id}/test-run`, { method: 'POST' }),
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
    queryFn: () => request<AutomationFull>(`/automations/${id}`),
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
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
  const queryParam = category ? `?category=${category}` : '';
  return useQuery({
    queryKey: category ? presetKeys.category(category) : presetKeys.all,
    queryFn: () =>
      request<AutomationPresetsResponse>(`/automations/presets${queryParam}`),
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useAutomationPreset(id: string | undefined) {
  return useQuery({
    queryKey: presetKeys.detail(id!),
    queryFn: () => request<AutomationPreset>(`/automations/presets/${id}`),
    enabled: !!id,
    staleTime: STALE_TIMES.STATIC,
  });
}
