import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type {
  Automation,
  AutomationHistoryListResponse,
} from '@/api/types';

export const automationKeys = {
  all: ['automations'] as const,
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
