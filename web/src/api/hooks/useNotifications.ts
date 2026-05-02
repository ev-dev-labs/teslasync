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
  ComputedMetricPreview,
  ComputedMetricSummary,
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
  ComputedMetricPreview,
  ComputedMetricSummary,
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
  alertMetrics: ['alert-metrics'] as const,
  channels: ['notification-channels'] as const,
  logs: ['notification-logs'] as const,
  logsFiltered: (filters?: NotificationFilters) =>
    ['notification-logs', 'filtered', filters ?? {}] as const,
  unreadCount: ['notification-logs', 'unread-count'] as const,
  stats: ['notification-stats'] as const,
};

/**
 * Filter shape for the notifications inbox. All fields are optional and map
 * to backend snake_case query params. Multi-value fields are CSV-encoded.
 */
export interface NotificationFilters {
  severity?: ('info' | 'warn' | 'critical')[];
  vehicle_id?: number[];
  rule_id?: number[];
  from?: string;
  to?: string;
  read?: boolean;
  archived?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

function serializeNotificationFilters(filters: NotificationFilters): string {
  const params = new URLSearchParams();
  if (filters.severity?.length) params.set('severity', filters.severity.join(','));
  if (filters.vehicle_id?.length) params.set('vehicle_id', filters.vehicle_id.join(','));
  if (filters.rule_id?.length) params.set('rule_id', filters.rule_id.join(','));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (typeof filters.read === 'boolean') params.set('read', String(filters.read));
  if (typeof filters.archived === 'boolean') params.set('archived', String(filters.archived));
  if (filters.q) params.set('q', filters.q);
  if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
  if (typeof filters.offset === 'number') params.set('offset', String(filters.offset));
  return params.toString();
}

// Exported only for unit tests; callers should not depend on the URL shape.
export const __serializeNotificationFiltersForTest = serializeNotificationFilters;

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

/**
 * useAlertMetrics returns the registry of computed-metric definitions used by
 * the rule builder when kind='computed_metric'. Stable across the session, so
 * it's cached for the whole TanStack Query default lifetime.
 */
export function useAlertMetrics() {
  return useQuery({
    queryKey: notificationKeys.alertMetrics,
    queryFn: () => request<ComputedMetricSummary[]>('/alerts/metrics'),
    select: safeArray,
    staleTime: INTERVALS.STATIC,
  });
}

/**
 * usePreviewComputedMetric calls /alerts/test with kind='computed_metric' to
 * get the live value of the metric for a given rule. Returns the would-trigger
 * verdict so the rule builder can show "this metric is currently $X — would
 * (NOT) fire". Does not actually dispatch any notification.
 */
export function usePreviewComputedMetric() {
  const { error } = useMutationToast();
  return useMutation({
    mutationFn: (data: {
      metric_id: string;
      metric_window: string;
      metric_op: string;
      metric_threshold: number;
      vehicle_id?: number | null;
    }) =>
      request<ComputedMetricPreview>('/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'computed_metric', ...data }),
      }),
    onError: (e) => error(e, 'toast.alerts.preview.error', 'Failed to preview metric'),
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

/**
 * Bulk enable alert rules. Phase-40 / Prompt 51 — accepts a list of rule
 * ids and returns the standardized BulkOperationResult envelope.
 */
export function useBulkEnableRules() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ updated?: number; failed?: Array<{ id: number; reason: string }> }>(
        '/alerts/rules/bulk/enable',
        { method: 'POST', body: JSON.stringify({ ids }) },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      success('toast.bulk.enable.success', '{{count}} enabled', {
        count: res.updated ?? 0,
      });
    },
    onError: (e) => error(e, 'toast.bulk.enable.error', 'Failed to enable selection'),
  });
}

/** Bulk disable alert rules. */
export function useBulkDisableRules() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ updated?: number; failed?: Array<{ id: number; reason: string }> }>(
        '/alerts/rules/bulk/disable',
        { method: 'POST', body: JSON.stringify({ ids }) },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
      success('toast.bulk.disable.success', '{{count}} disabled', {
        count: res.updated ?? 0,
      });
    },
    onError: (e) => error(e, 'toast.bulk.disable.error', 'Failed to disable selection'),
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

export function useNotificationLogs(filters: NotificationFilters = {}) {
  const qs = serializeNotificationFilters(filters);
  // GET /notifications/logs returns the same shape — backend `GetLogs` parses
  // the same query params for both `/notifications` and `/notifications/logs`
  // (the latter is the historical alias used by older widgets).
  return useQuery({
    queryKey: notificationKeys.logsFiltered(filters),
    queryFn: () => request<NotificationLog[]>(`/notifications/logs${qs ? `?${qs}` : ''}`),
    select: safeArray,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: () => request<{ count: number }>('/notifications/unread-count'),
    refetchInterval: INTERVALS.STANDARD,
    select: (data) => data?.count ?? 0,
  });
}

function invalidateLogsAndUnread(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: notificationKeys.logs });
  qc.invalidateQueries({ queryKey: notificationKeys.unreadCount });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ updated: number }>('/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.markRead.success', 'Marked as read');
    },
    onError: (e) => error(e, 'toast.notifications.markRead.error', 'Failed to mark as read'),
  });
}

export function useMarkNotificationsUnread() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ updated: number }>('/notifications/mark-unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.markUnread.success', 'Marked as unread');
    },
    onError: (e) => error(e, 'toast.notifications.markUnread.error', 'Failed to mark as unread'),
  });
}

export function useArchiveNotifications() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ updated: number }>('/notifications/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.archive.success', 'Archived');
    },
    onError: (e) => error(e, 'toast.notifications.archive.error', 'Failed to archive'),
  });
}

export function useUnarchiveNotifications() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ updated: number }>('/notifications/unarchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.unarchive.success', 'Restored from archive');
    },
    onError: (e) => error(e, 'toast.notifications.unarchive.error', 'Failed to unarchive'),
  });
}

export function useDeleteNotifications() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ deleted: number }>('/notifications/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.delete.success', 'Deleted');
    },
    onError: (e) => error(e, 'toast.notifications.delete.error', 'Failed to delete notifications'),
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
