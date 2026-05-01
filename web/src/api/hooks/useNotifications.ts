import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import type {
  Alert,
  AlertRule,
  AlertRuleInput,
  AlertRuleSnoozeRequest,
  AlertRuleTriggerMode,
  AlertRuleUpdate,
  AlertTestRequest,
  AlertTestTarget,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
} from '@/api/types';

export type {
  Alert,
  AlertRule,
  AlertRuleInput,
  AlertRuleSnoozeRequest,
  AlertRuleTriggerMode,
  AlertRuleUpdate,
  AlertTestRequest,
  AlertTestTarget,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
};

export type AlertRuleSaveRequest = AlertRuleInput | (AlertRuleUpdate & Pick<AlertRule, 'id'>);

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
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/alerts/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alerts });
      success('toast.alerts.markRead.success', 'Alert marked as read');
    },
    onError: (e) => error(e, 'toast.alerts.markRead.error', 'Failed to mark alert as read'),
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
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: AlertRuleSaveRequest) => {
      if ('id' in data) {
        const { id, ...payload } = data;
        return request<AlertRule>(`/alerts/rules/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      return request<AlertRule>('/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      success('toast.alerts.saveRule.success', 'Alert rule saved');
    },
    onError: (e) => error(e, 'toast.alerts.saveRule.error', 'Failed to save alert rule'),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/alerts/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      success('toast.alerts.deleteRule.success', 'Alert rule deleted');
    },
    onError: (e) => error(e, 'toast.alerts.deleteRule.error', 'Failed to delete alert rule'),
  });
}

export function useToggleAlertRule() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => {
      const payload: AlertRuleUpdate = { enabled };
      return request<AlertRule>(`/alerts/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_data, { enabled }) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      success(
        enabled ? 'toast.alerts.toggleRule.enabled' : 'toast.alerts.toggleRule.disabled',
        enabled ? 'Alert rule enabled' : 'Alert rule disabled',
      );
    },
    onError: (e) => error(e, 'toast.alerts.toggleRule.error', 'Failed to toggle alert rule'),
  });
}

export function useTestAlertRule() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: AlertTestRequest) =>
      request<void>('/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      success('toast.alerts.test.success', 'Test alert sent');
    },
    onError: (e) => error(e, 'toast.alerts.test.error', 'Failed to send test alert'),
  });
}

/**
 * useSnoozeAlertRule mutes a single rule for a fixed duration.
 * Pass minutes=0 (or a past `until`) to clear an existing snooze.
 * Snooze is layered on top of cooldown / trigger_mode and auto-expires.
 */
export function useSnoozeAlertRule() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & AlertRuleSnoozeRequest) =>
      request<AlertRule>(`/alerts/rules/${id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      const cleared = vars.minutes != null && vars.minutes <= 0;
      success(
        cleared ? 'toast.alerts.snooze.cleared' : 'toast.alerts.snooze.success',
        cleared ? 'Snooze cleared' : 'Rule snoozed',
      );
    },
    onError: (e) => error(e, 'toast.alerts.snooze.error', 'Failed to snooze rule'),
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
  const { success, error } = useMutationToast();
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
      success(
        isUpdate ? 'toast.channels.save.updated' : 'toast.channels.save.created',
        isUpdate ? 'Channel updated' : 'Channel created',
      );
    },
    onError: (e) => error(e, 'toast.channels.save.error', 'Failed to save channel'),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      qc.invalidateQueries({ queryKey: notificationKeys.stats });
      success('toast.channels.delete.success', 'Channel deleted');
    },
    onError: (e) => error(e, 'toast.channels.delete.error', 'Failed to delete channel'),
  });
}

export function useToggleChannel() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<NotificationChannel>(`/notifications/${id}/toggle`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.channels });
      qc.invalidateQueries({ queryKey: notificationKeys.stats });
      success('toast.channels.toggle.success', 'Channel toggled');
    },
    onError: (e) => error(e, 'toast.channels.toggle.error', 'Failed to toggle channel'),
  });
}

export function useTestChannel() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ success: boolean; error?: string }>(`/notifications/${id}/test`, { method: 'POST' }),
    onSuccess: () => {
      success('toast.channels.test.success', 'Test notification sent');
    },
    onError: (e) => error(e, 'toast.channels.test.error', 'Failed to send test'),
  });
}
