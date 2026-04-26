import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
import type {
  Automation,
  AutomationFull,
  AutomationStep,
  AutomationHistoryListResponse,
  AutomationPresetsResponse,
  AutomationPreset,
} from '@/api/types';

// Distributes over the AutomationStep discriminated union so variant-specific
// fields (e.g. cron_expr on trigger_time) survive the Omit. Without this
// conditional, TS would collapse to the intersection of common keys only.
export type AutomationStepInput = AutomationStep extends infer T
  ? T extends AutomationStep
    ? Omit<T, 'id' | 'automation_id' | 'created_at'>
    : never
  : never;

export type AutomationFullInput = Omit<
  AutomationFull,
  'id' | 'created_at' | 'updated_at' | 'triggers' | 'conditions' | 'actions'
> & {
  triggers: AutomationStepInput[];
  conditions: AutomationStepInput[];
  actions: AutomationStepInput[];
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
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request<{ id: number; enabled: boolean }>(`/automations/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_data, { enabled }) => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      toast.success(`Automation ${enabled ? 'enabled' : 'disabled'}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to toggle automation: ${err.message}`);
    },
  });
}

export function useReEnableAutomation() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ id: number; enabled: boolean; auto_disabled: boolean }>(
        `/automations/${id}/re-enable`,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      toast.success('Automation re-enabled');
    },
    onError: (err: Error) => {
      toast.error(`Failed to re-enable automation: ${err.message}`);
    },
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      qc.invalidateQueries({ queryKey: ['automation-history'] });
      toast.success('Automation deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete automation: ${err.message}`);
    },
  });
}

export function useTestRunAutomation() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}/test-run`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-history'] });
      toast.success('Test run started');
    },
    onError: (err: Error) => {
      toast.error(`Failed to start test run: ${err.message}`);
    },
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
  const toast = useToast();
  return useMutation({
    mutationFn: (input: AutomationFullInput) =>
      request<AutomationFull>('/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      toast.success('Automation created');
    },
    onError: (err: Error) => {
      toast.error(`Failed to create automation: ${err.message}`);
    },
  });
}

export function useUpdateAutomationFull() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AutomationFullInput }) =>
      request<AutomationFull>(`/automations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      qc.invalidateQueries({ queryKey: automationKeys.detail(vars.id) });
      toast.success('Automation updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update automation: ${err.message}`);
    },
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
