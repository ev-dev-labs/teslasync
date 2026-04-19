import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type {
  Automation,
  AutomationHistoryListResponse,
  AutomationPresetsResponse,
  AutomationPreset,
} from '@/api/types';

/** Shape of the request body for creating/updating an automation. */
export interface AutomationFormData {
  name: string;
  description: string;
  vehicle_id: number | null;
  enabled?: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  cooldown_minutes: number;
  max_executions_hour: number;
  stop_on_failure: boolean;
  notify_on_run: boolean;
  notify_on_failure: boolean;
  priority: number;
  tags: string[];
  preset_id?: string | null;
}

export const automationKeys = {
  all: ['automations'] as const,
  detail: (id: number) => ['automations', id] as const,
  history: (limit?: number) => ['automation-history', limit] as const,
};

export function useAutomations() {
  return useQuery({
    queryKey: automationKeys.all,
    queryFn: () => request<Automation[]>('/automations'),
    refetchInterval: 30_000,
    select: safeArray,
  });
}

export function useAutomationHistory(limit = 20) {
  return useQuery({
    queryKey: automationKeys.history(limit),
    queryFn: () =>
      request<AutomationHistoryListResponse>(`/automations/history?limit=${limit}`),
    refetchInterval: 30_000,
  });
}

export function useToggleAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request<{ id: number; enabled: boolean }>(`/automations/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useReEnableAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ id: number; enabled: boolean; auto_disabled: boolean }>(
        `/automations/${id}/re-enable`,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      qc.invalidateQueries({ queryKey: ['automation-history'] });
    },
  });
}

export function useTestRunAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/automations/${id}/test-run`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation-history'] });
    },
  });
}

export function useAutomation(id: number | undefined) {
  return useQuery({
    queryKey: automationKeys.detail(id!),
    queryFn: () => request<Automation>(`/automations/${id}`),
    enabled: id != null && id > 0,
  });
}

export function useCreateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AutomationFormData) =>
      request<Automation>(`/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

export function useUpdateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AutomationFormData }) =>
      request<Automation>(`/automations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
      qc.invalidateQueries({ queryKey: automationKeys.detail(id) });
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
    staleTime: Infinity,
  });
}

export function useAutomationPreset(id: string | undefined) {
  return useQuery({
    queryKey: presetKeys.detail(id!),
    queryFn: () => request<AutomationPreset>(`/automations/presets/${id}`),
    enabled: !!id,
    staleTime: Infinity,
  });
}
