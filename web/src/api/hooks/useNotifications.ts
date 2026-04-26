import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
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
    refetchInterval: INTERVALS.STANDARD,
    select: safeArray,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/alerts/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alerts });
      toast.success('Alert marked as read');
    },
    onError: (err: Error) => {
      toast.error(`Failed to mark alert as read: ${err.message}`);
    },
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
  const toast = useToast();
  return useMutation({
    mutationFn: (data: Partial<AlertRule>) =>
      request<AlertRule>(data.id ? `/alerts/rules/${data.id}` : '/alerts/rules', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      toast.success('Alert rule saved');
    },
    onError: (err: Error) => {
      toast.error(`Failed to save alert rule: ${err.message}`);
    },
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/alerts/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      toast.success('Alert rule deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete alert rule: ${err.message}`);
    },
  });
}

export function useToggleAlertRule() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request<AlertRule>(`/alerts/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_data, { enabled }) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      toast.success(`Alert rule ${enabled ? 'enabled' : 'disabled'}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to toggle alert rule: ${err.message}`);
    },
  });
}

export function useTestAlertRule() {
  const toast = useToast();
  return useMutation({
    mutationFn: (data: { name: string; severity: string; msg_template: string; notify_channels: number[] }) =>
      request<void>('/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast.success('Test alert sent');
    },
    onError: (err: Error) => {
      toast.error(`Failed to send test alert: ${err.message}`);
    },
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
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSaveChannel() {
  const qc = useQueryClient();
  const toast = useToast();
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
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      const isUpdate = 'id' in vars && typeof vars.id === 'number';
      toast.success(isUpdate ? 'Channel updated' : 'Channel created');
    },
    onError: (err: Error) => {
      toast.error(`Failed to save channel: ${err.message}`);
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      qc.invalidateQueries({ queryKey: notificationKeys.stats });
      toast.success('Channel deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete channel: ${err.message}`);
    },
  });
}

export function useToggleChannel() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<NotificationChannel>(`/notifications/${id}/toggle`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      qc.invalidateQueries({ queryKey: notificationKeys.stats });
      toast.success('Channel toggled');
    },
    onError: (err: Error) => {
      toast.error(`Failed to toggle channel: ${err.message}`);
    },
  });
}

export function useTestChannel() {
  const toast = useToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ success: boolean; error?: string }>(`/notifications/${id}/test`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Test notification sent');
    },
    onError: (err: Error) => {
      toast.error(`Failed to send test: ${err.message}`);
    },
  });
}
