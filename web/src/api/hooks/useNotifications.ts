import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useOptimisticMutation } from './useOptimisticMutation';
import type {
  Alert,
  AlertDetail,
  AlertEvent,
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
  NotificationLogGroup,
  NotificationEventType,
  NotificationPreference,
  NotificationStats,
  QuietHoursWindow,
  QuietHoursWindowInput,
} from '@/api/types';

export type {
  Alert,
  AlertDetail,
  AlertEvent,
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
  NotificationLogGroup,
  NotificationEventType,
  NotificationPreference,
  NotificationStats,
  QuietHoursWindow,
  QuietHoursWindowInput,
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
  priorityAlerts: ['alerts', 'priority'] as const,
  alertHistory: (limit: number) => ['alerts', 'history', limit] as const,
  alertDetail: (id: number) => ['alerts', 'detail', id] as const,
  alertRules: ['alert-rules'] as const,
  alertMetrics: ['alert-metrics'] as const,
  channels: ['notification-channels'] as const,
  eventTypes: ['notification-event-types'] as const,
  preferences: (channelId: number) => ['notification-preferences', channelId] as const,
  logs: ['notification-logs'] as const,
  logsFiltered: (filters?: NotificationFilters) =>
    ['notification-logs', 'filtered', filters ?? {}] as const,
  // Grouped/threaded inbox cache sits beside `logsFiltered` so a
  // same-filter swap between flat and grouped views doesn't fight the cache.
  // Members of a single group reuse `logsFiltered` keyed on `{ group_key }`
  // so expand-row payloads dedupe with matching flat-list queries.
  groups: (filters?: NotificationFilters) =>
    ['notification-logs', 'groups', filters ?? {}] as const,
  // Bell preview cache is keyed only by `limit` so every Layout mount
  // reuses the same entry. It sits under the `notification-logs` prefix so
  // bulk mark-read invalidation cascades into it without bespoke wiring.
  bellUnread: (limit: number) => ['notification-logs', 'bell-unread', limit] as const,
  unreadCount: ['notification-logs', 'unread-count'] as const,
  stats: ['notification-stats'] as const,
  quietHours: ['notification-quiet-hours'] as const,
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
  // Restricts the flat list to one notification thread. The backend
  // validates this as a 64-char lower-hex sha256 and returns 400 otherwise.
  group_key?: string;
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
  if (filters.group_key) params.set('group_key', filters.group_key);
  if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
  if (typeof filters.offset === 'number') params.set('offset', String(filters.offset));
  return params.toString();
}

// Exported only for unit tests; callers should not depend on the URL shape.
export const __serializeNotificationFiltersForTest = serializeNotificationFilters;

export function useAlerts() {
  return useQuery({
    queryKey: notificationKeys.alerts,
    queryFn: ({ signal }) => request<Alert[]>('/alerts', { signal }),
    refetchInterval: INTERVALS.STANDARD,
    select: safeArray,
  });
}

const PRIORITY_ALERT_PREVIEW_CAP = 50;

export interface PriorityAlertsSnapshot {
  alerts: Alert[];
  count: number;
  hasMore: boolean;
}

export function usePriorityAlerts() {
  return useQuery({
    queryKey: notificationKeys.priorityAlerts,
    queryFn: async ({ signal }): Promise<PriorityAlertsSnapshot> => {
      const limit = PRIORITY_ALERT_PREVIEW_CAP + 1;
      const base = `read=false&archived=false&limit=${limit}`;
      const [criticalResponse, warningResponse] = await Promise.all([
        request<Alert[]>(`/alerts?severity=critical&${base}`, { signal }),
        request<Alert[]>(`/alerts?severity=warn&${base}`, { signal }),
      ]);
      const critical = safeArray(criticalResponse);
      const warnings = safeArray(warningResponse);
      const hasMore =
        critical.length > PRIORITY_ALERT_PREVIEW_CAP ||
        warnings.length > PRIORITY_ALERT_PREVIEW_CAP;
      const alerts = [
        ...critical.slice(0, PRIORITY_ALERT_PREVIEW_CAP),
        ...warnings.slice(0, PRIORITY_ALERT_PREVIEW_CAP),
      ];
      return {
        alerts,
        count: critical.length + warnings.length,
        hasMore,
      };
    },
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * Fetches the largest backend-supported alert page for analytical views.
 * Ordinary inbox consumers keep the lightweight polling query above.
 */
export function useAlertHistory(limit = 1000) {
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return useQuery({
    queryKey: notificationKeys.alertHistory(boundedLimit),
    queryFn: ({ signal }) =>
      request<Alert[]>(`/alerts?limit=${boundedLimit}`, { signal }),
    staleTime: STALE_TIMES.MODERATE,
    select: safeArray,
  });
}

export function useMarkAlertRead() {
  const { success, error } = useMutationToast();
  return useOptimisticMutation<void, string, Alert[]>({
    mutationFn: (id) =>
      request<void>(`/alerts/${id}/read`, { method: 'POST' }),
    queryKeys: [notificationKeys.alerts],
    updater: (prev, id) => {
      // The `['alerts']` prefix matches sibling caches (e.g. `alertDetail`)
      // whose payload is a single object, not an array. Guard so the
      // optimistic helper's broadcast over every prefixed cache only mutates
      // the array-shaped inbox list and leaves object caches untouched.
      if (!Array.isArray(prev)) return prev;
      return prev.map((a) => (String(a.id) === id ? { ...a, is_read: true } : a));
    },
    broadcast: true,
    onMutate: () => {
      // Row already dimmed by the helper. Toast waits for server ack so a
      // failed mark-read doesn't mislead the user.
    },
    onSuccess: () =>
      success('toast.alerts.markRead.success', 'Alert marked as read'),
    onError: (e) =>
      error(e, 'toast.alerts.markRead.error', 'Failed to mark alert as read'),
  });
}

// Alert acknowledgement and audit timeline.

/**
 * useAlertDetail fetches a single alert with its full event timeline. Used by
 * the alert detail modal/page; the list endpoint omits the events array to
 * keep the inbox payload small.
 *
 * `enabled` defaults to `true` when `id` is a positive integer; pass an
 * explicit `enabled: false` to defer the fetch (e.g. while a modal is closed).
 */
export function useAlertDetail(
  id: number | null | undefined,
  options?: { enabled?: boolean },
) {
  const numericId = typeof id === 'number' && Number.isFinite(id) && id > 0 ? id : null;
  return useQuery({
    queryKey: numericId !== null ? notificationKeys.alertDetail(numericId) : ['alerts', 'detail', 'disabled'],
    queryFn: ({ signal }) =>
      request<AlertDetail>(`/alerts/${numericId}`, { signal }),
    enabled: numericId !== null && (options?.enabled ?? true),
    staleTime: STALE_TIMES.QUICK,
  });
}

export interface AcknowledgeAlertInput {
  id: number;
  note?: string;
}

/**
 * useAcknowledgeAlert posts to /alerts/{id}/acknowledge with an optional note.
 * Optimistically marks the alert as acknowledged in the inbox cache so the
 * row updates instantly; the server-confirmed AlertDetail is then written
 * back into the alertDetail cache so the detail view re-renders without an
 * extra fetch.
 */
export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<AlertDetail, AcknowledgeAlertInput, Alert[]>({
    mutationFn: ({ id, note }) =>
      request<AlertDetail>(`/alerts/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note && note.trim().length > 0 ? { note: note.trim() } : {}),
      }),
    queryKeys: [notificationKeys.alerts],
    updater: (prev, { id, note }) => {
      // Skip non-array sibling caches under the `['alerts']` prefix (e.g.
      // `alertDetail`) — only the inbox list payload is mutated optimistically.
      if (!Array.isArray(prev)) return prev;
      const nowIso = new Date().toISOString();
      const trimmed = note?.trim();
      return prev.map((a) =>
        a.id === id
          ? {
              ...a,
              acknowledged_at: nowIso,
              acknowledgement_note: trimmed && trimmed.length > 0 ? trimmed : a.acknowledgement_note ?? null,
            }
          : a,
      );
    },
    broadcast: true,
    onSuccess: (detail, vars) => {
      qc.setQueryData(notificationKeys.alertDetail(vars.id), detail);
      success('toast.alerts.ack.success', 'Alert acknowledged');
    },
    onError: (e) =>
      error(e, 'toast.alerts.ack.error', 'Failed to acknowledge alert'),
  });
}

export interface CommentAlertInput {
  id: number;
  note: string;
}

/**
 * useCommentAlert posts to /alerts/{id}/comment with a non-empty note. Does
 * NOT touch ack state — pure timeline append. Invalidates the alertDetail
 * cache so the timeline refetches; the inbox list cache is untouched because
 * comments don't change any list-visible field.
 */
export function useCommentAlert() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, note }: CommentAlertInput) =>
      request<AlertDetail>(`/alerts/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      }),
    onSuccess: (detail, vars) => {
      qc.setQueryData(notificationKeys.alertDetail(vars.id), detail);
      success('toast.alerts.comment.success', 'Comment added');
    },
    onError: (e) =>
      error(e, 'toast.alerts.comment.error', 'Failed to add comment'),
  });
}

/**
 * useReopenAlert posts to /alerts/{id}/reopen. Used by the "Undo" affordance
 * on the Acknowledge toast and by the explicit Reopen button in the detail
 * view. Optimistically clears the ack columns in the inbox cache.
 */
export function useReopenAlert() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<AlertDetail, number, Alert[]>({
    mutationFn: (id) =>
      request<AlertDetail>(`/alerts/${id}/reopen`, { method: 'POST' }),
    queryKeys: [notificationKeys.alerts],
    updater: (prev, id) => {
      // Skip non-array sibling caches under the `['alerts']` prefix.
      if (!Array.isArray(prev)) return prev;
      return prev.map((a) =>
        a.id === id
          ? {
              ...a,
              acknowledged_at: null,
              acknowledged_by: null,
              acknowledgement_note: null,
            }
          : a,
      );
    },
    broadcast: true,
    onSuccess: (detail, id) => {
      qc.setQueryData(notificationKeys.alertDetail(id), detail);
      success('toast.alerts.reopen.success', 'Alert reopened');
    },
    onError: (e) =>
      error(e, 'toast.alerts.reopen.error', 'Failed to reopen alert'),
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: notificationKeys.alertRules,
    queryFn: ({ signal }) => request<AlertRule[]>('/alerts/rules', { signal }),
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
    queryFn: ({ signal }) => request<ComputedMetricSummary[]>('/alerts/metrics', { signal }),
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
      success('toast.alerts.deleteRule.success', 'Alert rule deleted');
    },
    onError: (e) => error(e, 'toast.alerts.deleteRule.error', 'Failed to delete alert rule'),
  });
}

export function useToggleAlertRule() {
  const { success, error } = useMutationToast();
  return useOptimisticMutation<
    AlertRule,
    { id: number; enabled: boolean },
    AlertRule[]
  >({
    mutationFn: ({ id, enabled }) => {
      const payload: AlertRuleUpdate = { enabled };
      return request<AlertRule>(`/alerts/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    queryKeys: [notificationKeys.alertRules],
    updater: (prev, { id, enabled }) =>
      prev?.map((r) => (r.id === id ? { ...r, enabled } : r)),
    broadcast: true,
    onMutate: () => {
      // Toggle UI already flipped; toast waits for server confirmation
      // so the announcement matches the persisted state.
    },
    onSuccess: (_data, { enabled }) => {
      success(
        enabled ? 'toast.alerts.toggleRule.enabled' : 'toast.alerts.toggleRule.disabled',
        enabled ? 'Alert rule enabled' : 'Alert rule disabled',
      );
    },
    onError: (e) =>
      error(e, 'toast.alerts.toggleRule.error', 'Failed to toggle alert rule'),
  });
}

/**
 * Bulk enable alert rules. Accepts rule ids and returns the standardized
 * BulkOperationResult envelope.
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
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
 * A snooze request CLEARS an existing snooze — rather than extending one —
 * when the caller passes a non-positive `minutes` OR an `until` timestamp at
 * or before now. This mirrors the backend's unsnooze semantics and the
 * AlertRuleSnoozeRequest doc comment. The previous inline check only looked at
 * `minutes`, so a past-`until` clear was mis-announced to the user as
 * "Rule snoozed" instead of "Snooze cleared".
 */
function snoozeRequestClears(req: AlertRuleSnoozeRequest): boolean {
  if (req.minutes != null && req.minutes <= 0) return true;
  if (typeof req.until === 'string' && req.until.trim() !== '') {
    const untilMs = Date.parse(req.until);
    return !Number.isNaN(untilMs) && untilMs <= Date.now();
  }
  return false;
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
      const cleared = snoozeRequestClears(vars);
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
    queryFn: ({ signal }) => request<NotificationChannel[]>('/notifications', { signal }),
    select: safeArray,
  });
}

export function useNotificationEventTypes() {
  return useQuery({
    queryKey: notificationKeys.eventTypes,
    queryFn: ({ signal }) =>
      request<NotificationEventType[]>('/notifications/event-types', { signal }),
    select: safeArray,
    staleTime: INTERVALS.STATIC,
  });
}

export function useNotificationPreferences(channelId: number | null) {
  const enabled = channelId !== null && Number.isInteger(channelId) && channelId > 0;
  return useQuery({
    queryKey: enabled
      ? notificationKeys.preferences(channelId)
      : ['notification-preferences', 'disabled'],
    queryFn: ({ signal }) =>
      request<NotificationPreference[]>(`/notifications/${channelId}/preferences`, { signal }),
    enabled,
    select: safeArray,
  });
}

export interface UpdateNotificationPreferenceInput {
  channel_id: number;
  event_type: string;
  enabled: boolean;
}

export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ channel_id, event_type, enabled }: UpdateNotificationPreferenceInput) =>
      request<void>(`/notifications/${channel_id}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type, enabled }),
      }),
    onMutate: async (vars) => {
      const queryKey = notificationKeys.preferences(vars.channel_id);
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<NotificationPreference[]>(queryKey);
      qc.setQueryData<NotificationPreference[]>(queryKey, (current = []) => {
        const exists = current.some((item) => item.event_type === vars.event_type);
        if (exists) {
          return current.map((item) =>
            item.event_type === vars.event_type
              ? { ...item, enabled: vars.enabled }
              : item,
          );
        }
        return [
          ...current,
          {
            id: 0,
            channel_id: vars.channel_id,
            event_type: vars.event_type,
            enabled: vars.enabled,
          },
        ];
      });
      return { previous };
    },
    onSuccess: () => {
      success(
        'toast.notifications.preferences.saved',
        'Notification preference updated',
      );
    },
    onError: (e, vars, context) => {
      if (context) {
        qc.setQueryData(notificationKeys.preferences(vars.channel_id), context.previous);
      }
      error(
        e,
        'toast.notifications.preferences.error',
        'Failed to update notification preference',
      );
    },
    onSettled: (_data, _mutationError, vars) => {
      invalidateAndBroadcast(qc, {
        queryKey: notificationKeys.preferences(vars.channel_id),
      });
    },
  });
}

export function useNotificationLogs(
  filters: NotificationFilters = {},
  options?: { enabled?: boolean },
) {
  const qs = serializeNotificationFilters(filters);
  // GET /notifications/logs returns the same shape — backend `GetLogs` parses
  // the same query params for both `/notifications` and `/notifications/logs`
  // (the latter is the historical alias used by older widgets).
  return useQuery({
    queryKey: notificationKeys.logsFiltered(filters),
    queryFn: ({ signal }) => request<NotificationLog[]>(`/notifications/logs${qs ? `?${qs}` : ''}`, { signal }),
    enabled: options?.enabled ?? true,
    select: safeArray,
  });
}

/**
 * Fetches the inbox in grouped/threaded form.
 *
 * Server returns one row per `(alert_rule_id, severity)` thread plus one
 * row per "singleton" (notifications without a derivable group_key). The
 * `count` and `unread_count` reflect the FILTERED subset, NOT a global
 * tally — UI should phrase the chip as "+N similar".
 *
 * Composing with `?group_key=` is a server-side error (the handler 400s),
 * so this hook clears any group_key the caller might have left in the
 * filters object before serializing. Mirrors the backend's mutual-
 * exclusion contract so the cache key stays stable across `view` swaps.
 */
export function useNotificationGroups(
  filters: NotificationFilters = {},
  options?: { enabled?: boolean },
) {
  const sanitized: NotificationFilters = { ...filters };
  delete sanitized.group_key;
  const qs = serializeNotificationFilters(sanitized);
  const tail = qs ? `&${qs}` : '';
  return useQuery({
    queryKey: notificationKeys.groups(sanitized),
    queryFn: ({ signal }) =>
      request<NotificationLogGroup[]>(`/notifications/logs?grouped=true${tail}`, { signal }),
    enabled: options?.enabled ?? true,
    select: safeArray,
  });
}

/**
 * Fetches the members of a single thread on expand.
 *
 * Reuses the flat list endpoint with `?group_key=…` so the response shape
 * matches `useNotificationLogs` exactly and inline-render code paths can
 * be shared. Disabled when `groupKey` is null/empty so the row's collapsed
 * state doesn't trigger any network traffic.
 *
 * Inherits filters (severity/vehicle/from/to/etc.) from the parent inbox so
 * the expanded list mirrors the same window the user is viewing — anything
 * that didn't make it into the group's `count` won't show up here either.
 */
export function useGroupMembers(
  groupKey: string | null | undefined,
  filters: NotificationFilters = {},
  options?: { enabled?: boolean },
) {
  const trimmed = (groupKey ?? '').trim();
  const enabled = trimmed.length > 0 && (options?.enabled ?? true);
  const merged: NotificationFilters = { ...filters, group_key: trimmed };
  const qs = serializeNotificationFilters(merged);
  return useQuery({
    queryKey: enabled
      ? notificationKeys.logsFiltered(merged)
      : ['notification-logs', 'group-members', 'disabled'],
    queryFn: ({ signal }) =>
      request<NotificationLog[]>(`/notifications/logs${qs ? `?${qs}` : ''}`, { signal }),
    enabled,
    select: safeArray,
    staleTime: STALE_TIMES.QUICK,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: ({ signal }) => request<{ count: number }>('/notifications/unread-count', { signal }),
    refetchInterval: INTERVALS.STANDARD,
    select: (data) => data?.count ?? 0,
  });
}

/**
 * Header bell popover preview list.
 *
 * Returns the latest N unread, non-archived notifications for the bell
 * popover's in-place triage panel. Backend filters via
 * `read=false&archived=false`; there is NO `unread_only=true` flag in
 * `parseNotificationLogFilters`.
 *
 * Cache key sits under the shared `notification-logs` prefix so the
 * post-mutation invalidations in `invalidateLogsAndUnread` (and the
 * `queryKeys: [notificationKeys.logs]` hook in `useBulkMarkRead`)
 * cascade in: marking everything read elsewhere zeroes the popover
 * preview without bespoke wiring. `staleTime` is short — 30s — so an
 * SSE-driven new-notification toast that arrives mid-session triggers
 * a refetch the next time the popover opens, instead of showing stale
 * rows from the previous open.
 */
export function useUnreadNotifications(params: { limit: number }) {
  const limit = Math.max(1, Math.floor(params.limit));
  return useQuery({
    queryKey: notificationKeys.bellUnread(limit),
    queryFn: ({ signal }) =>
      request<NotificationLog[]>(
        `/notifications/logs?read=false&archived=false&limit=${limit}`,
        { signal },
      ),
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

function invalidateLogsAndUnread(qc: ReturnType<typeof useQueryClient>) {
  invalidateAndBroadcast(qc, { queryKey: notificationKeys.logs });
  invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<
    { updated: number },
    number[],
    NotificationLog[]
  >({
    mutationFn: (ids) =>
      request<{ updated: number }>('/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, ids) => {
      // The `['notification-logs']` prefix matches caches with non-array
      // shapes (e.g. `unread-count: {count: number}`). Guard so map-based
      // mutation only runs on the array-shaped inbox/preview/groups payloads.
      if (!Array.isArray(prev)) return prev;
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      return prev.map((n) =>
        idSet.has(n.id) && !n.read_at ? { ...n, read_at: now } : n,
      );
    },
    broadcast: true,
    onMutate: () => {
      // Rows already de-emphasized by the helper. The unread-count badge
      // is invalidated separately on settle so it eventually matches.
    },
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
      success('toast.notifications.markRead.success', 'Marked as read');
    },
    onError: (e) =>
      error(e, 'toast.notifications.markRead.error', 'Failed to mark as read'),
    onSettled: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
  });
}

/**
 * Bulk mark-read with optional whole-inbox or thread flags.
 *
 * Variants accepted (mirrors the relaxed backend contract; mutually exclusive):
 *
 *   { ids: number[] }       → mark exactly those rows as read.
 *   { all: true }           → mark every currently-unread, non-archived row as read.
 *   { group_key: string }   → mark every member of a thread as read.
 *
 * Differs from `useMarkNotificationsRead` in three ways:
 *   1. Accepts `{ ids? | all? | group_key? }` — needed so the page can wire one
 *      mutation to the toolbar button, the "Mark all read" header action, AND
 *      the per-thread "Mark group read" action without juggling separate hooks.
 *   2. Optimistic updater handles `ids` and `all` shapes — for `group_key` it
 *      skips the optimistic step (the cache doesn't store `group_key` on each
 *      row, so we'd have to re-derive the sha256 client-side) and just relies
 *      on the post-settle invalidation. Worst case: the row stays bold for one
 *      refetch tick, which is acceptable given the action is explicit.
 *   3. Emits NO success/error toast of its own — the caller (NotificationsPage)
 *      shows a custom toast with an Undo action that fires the reverse
 *      mutation. Auto-emitting a generic success toast here would race
 *      against that custom toast and the Undo control would be confusing.
 *
 * Failures still roll the optimistic update back via the helper's snapshot
 * machinery; the caller is responsible for surfacing the error to the user.
 */
export type BulkMarkReadVars =
  | { ids: number[]; all?: never; group_key?: never }
  | { ids?: never; all: true; group_key?: never }
  | { ids?: never; all?: never; group_key: string };

export function useBulkMarkRead() {
  const qc = useQueryClient();
  return useOptimisticMutation<
    { updated: number },
    BulkMarkReadVars,
    NotificationLog[]
  >({
    mutationFn: (vars) =>
      request<{ updated: number }>('/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, vars) => {
      // Skip non-array sibling caches under the `['notification-logs']`
      // prefix (e.g. `unread-count: {count}`). Mutating `.map` on those
      // shapes throws "n.map is not a function" and breaks the toast.
      if (!Array.isArray(prev)) return prev;
      // group_key path — no optimistic update because cached rows don't
      // carry group_key. The post-settle invalidation refreshes both the
      // flat list and the grouped/thread caches so the UI converges.
      if ('group_key' in vars && vars.group_key) {
        return prev;
      }
      const now = new Date().toISOString();
      if ('all' in vars && vars.all) {
        return prev.map((n) => (n.read_at ? n : { ...n, read_at: now }));
      }
      if ('ids' in vars && vars.ids) {
        const idSet = new Set(vars.ids);
        if (idSet.size === 0) return prev;
        return prev.map((n) =>
          idSet.has(n.id) && !n.read_at ? { ...n, read_at: now } : n,
        );
      }
      return prev;
    },
    broadcast: true,
    onSuccess: (_data, vars) => {
      // Group-key path skipped optimistic, so explicitly invalidate the
      // grouped cache too — the flat-list invalidation is handled by
      // queryKeys: [notificationKeys.logs] in the helper.
      if ('group_key' in vars && vars.group_key) {
        invalidateAndBroadcast(qc, { queryKey: notificationKeys.logs });
      }
    },
    onSettled: () => {
      // Unread-count badge is a sibling cache that the helper doesn't know
      // about — invalidate it explicitly so the bell badge eventually
      // converges with the optimistic write applied above.
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
  });
}

export function useMarkNotificationsUnread() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<
    { updated: number },
    number[],
    NotificationLog[]
  >({
    mutationFn: (ids) =>
      request<{ updated: number }>('/notifications/mark-unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, ids) => {
      // Skip non-array sibling caches under the `['notification-logs']` prefix.
      if (!Array.isArray(prev)) return prev;
      const idSet = new Set(ids);
      return prev.map((n) =>
        idSet.has(n.id) && n.read_at ? { ...n, read_at: null } : n,
      );
    },
    broadcast: true,
    onMutate: () => {
      // Rows already re-emphasized; unread-count badge reconciles on settle.
    },
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
      success('toast.notifications.markUnread.success', 'Marked as unread');
    },
    onError: (e) =>
      error(e, 'toast.notifications.markUnread.error', 'Failed to mark as unread'),
    onSettled: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
  });
}

export function useArchiveNotifications() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<
    { updated: number },
    number[],
    NotificationLog[]
  >({
    mutationFn: (ids) =>
      request<{ updated: number }>('/notifications/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, ids) => {
      // Skip non-array sibling caches under the `['notification-logs']` prefix.
      if (!Array.isArray(prev)) return prev;
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      return prev.map((n) =>
        idSet.has(n.id) && !n.archived_at ? { ...n, archived_at: now } : n,
      );
    },
    broadcast: true,
    onMutate: () => {
      // Rows visually moved to the archive bucket immediately; toast waits
      // for server ack so a failed archive surfaces clearly.
    },
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
      success('toast.notifications.archive.success', 'Archived');
    },
    onError: (e) =>
      error(e, 'toast.notifications.archive.error', 'Failed to archive'),
    onSettled: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
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
    queryFn: ({ signal }) => request<NotificationStats>('/notifications/stats', { signal }),
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.channels });
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.channels });
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.stats });
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
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.channels });
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.stats });
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

// Quiet hours / DND.
//
// Server-backed CRUD for per-user Do-Not-Disturb windows. The dispatcher
// consults the active windows on every notification and defers anything
// whose severity is not on the bypass list — see
// internal/notification/quiet_hours.go for the server-side decider.

interface QuietHoursListResponse {
  windows: QuietHoursWindow[];
}

export type QuietHoursSavePayload = QuietHoursWindowInput & { id?: number };

export function useQuietHours() {
  return useQuery({
    queryKey: notificationKeys.quietHours,
    queryFn: ({ signal }) =>
      request<QuietHoursListResponse>('/notifications/quiet-hours', { signal }).then(
        (r) => safeArray<QuietHoursWindow>(r?.windows),
      ),
    staleTime: STALE_TIMES.MODERATE,
  });
}

export function useSaveQuietHours() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: QuietHoursSavePayload) => {
      const { id, ...body } = data;
      const isUpdate = typeof id === 'number' && id > 0;
      return request<QuietHoursWindow>(
        isUpdate ? `/notifications/quiet-hours/${id}` : '/notifications/quiet-hours',
        {
          method: isUpdate ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.quietHours });
      const isUpdate = typeof vars.id === 'number' && vars.id > 0;
      success(
        isUpdate ? 'toast.quietHours.save.updated' : 'toast.quietHours.save.created',
        isUpdate ? 'Quiet hours window updated' : 'Quiet hours window created',
      );
    },
    onError: (e) => error(e, 'toast.quietHours.save.error', 'Failed to save quiet hours window'),
  });
}

export function useDeleteQuietHours() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/notifications/quiet-hours/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.quietHours });
      success('toast.quietHours.delete.success', 'Quiet hours window removed');
    },
    onError: (e) => error(e, 'toast.quietHours.delete.error', 'Failed to delete quiet hours window'),
  });
}
