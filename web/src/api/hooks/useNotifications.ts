import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { Alert, AlertRule, NotificationChannel, NotificationLog, NotificationStats, RuleConditionTree } from '@/api/types';

export type { Alert, AlertRule, NotificationChannel, RuleConditionTree, NotificationLog, NotificationStats };

/**
 * Payload for creating a notification channel: omits server-managed fields.
 * Remains a discriminated union so each `kind` requires its own config shape.
 */
export type NotificationChannelCreate = NotificationChannel extends infer C
  ? C extends NotificationChannel
    ? Omit<C, 'id' | 'created_at' | 'updated_at'>
    : never
  : never;

/** Payload for updating an existing channel (includes id). */
export type NotificationChannelUpdate = NotificationChannelCreate & { id: number };

export type NotificationChannelInput =
  | NotificationChannelCreate
  | NotificationChannelUpdate;

export const notificationKeys = {
  alerts: ['alerts'] as const,
  alertRules: ['alert-rules'] as const,
  channels: ['notification-channels'] as const,
  logs: ['notification-logs'] as const,
  stats: ['notification-stats'] as const,
};

export function useAlerts() {
  return useQuery({
    queryKey: notificationKeys.alerts,
    queryFn: () => request<Alert[]>('/alerts'),
    refetchInterval: 30_000,
    select: safeArray,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/alerts/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alerts }),
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: notificationKeys.alertRules,
    queryFn: () => request<AlertRule[]>('/alerts/rules'),
    select: safeArray,
  });
}

export function useSaveAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<AlertRule>) =>
      request<AlertRule>(data.id ? `/alerts/rules/${data.id}` : '/alerts/rules', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alertRules }),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/alerts/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alertRules }),
  });
}

export function useToggleAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request<AlertRule>(`/alerts/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.alertRules }),
  });
}

export function useTestAlertRule() {
  return useMutation({
    mutationFn: (data: { name: string; severity: string; msg_template: string; notify_channels: number[] }) =>
      request<void>('/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
  });
}

export function useNotificationChannels() {
  return useQuery({
    queryKey: notificationKeys.channels,
    queryFn: () => request<NotificationChannel[]>('/notifications'),
    select: safeArray,
  });
}

export function useNotificationLogs() {
  return useQuery({
    queryKey: notificationKeys.logs,
    queryFn: () => request<NotificationLog[]>('/notifications/logs'),
    select: safeArray,
  });
}

export function useNotificationStats() {
  return useQuery({
    queryKey: notificationKeys.stats,
    queryFn: () => request<NotificationStats>('/notifications/stats'),
    refetchInterval: 30_000,
  });
}

export function useSaveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: NotificationChannelInput) => {
      const hasId = 'id' in data && typeof data.id === 'number';
      return request<NotificationChannel>(
        hasId ? `/notifications/${(data as NotificationChannelUpdate).id}` : '/notifications',
        {
          method: hasId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.channels }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      qc.invalidateQueries({ queryKey: notificationKeys.stats });
    },
  });
}

export function useToggleChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<NotificationChannel>(`/notifications/${id}/toggle`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      qc.invalidateQueries({ queryKey: notificationKeys.stats });
    },
  });
}

export function useTestChannel() {
  return useMutation({
    mutationFn: (id: number) =>
      request<{ success: boolean; error?: string }>(`/notifications/${id}/test`, { method: 'POST' }),
  });
}
