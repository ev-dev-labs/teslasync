import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';

import { request } from '../client';
import { useMutationToast } from './_toastHelpers';

const INTERVALS = {
  STANDARD: 30_000,
  STATIC: Infinity,
} as const;

const STALE_TIMES = {
  QUICK: 10_000,
  MODERATE: 15_000,
  FAST: 30_000,
} as const;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export const nativeNotificationHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

export interface Alert {
  id: number;
  vehicle_id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  rule_id?: number | null;
  rule_signal?: string | null;
  rule_severity?: AlertRuleSeverity | string | null;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  acknowledgement_note?: string | null;
}

export type AlertEventKind =
  | 'created'
  | 'acknowledged'
  | 'reopened'
  | 'commented'
  | string;

export interface AlertEvent {
  id: number;
  occurred_at: string;
  actor?: string | null;
  kind: AlertEventKind;
  note?: string | null;
}

export interface AlertDetail extends Alert {
  events: AlertEvent[];
}

export type AlertRuleSeverity = 'info' | 'warn' | 'critical';
export type AlertRuleOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'changed'
  | 'between'
  | 'outside';
export type AlertRuleTriggerMode = 'once' | 'repeat';
export type AlertRuleKind = 'signal' | 'computed_metric';
export type ComputedMetricOp =
  | '>'
  | '>='
  | '<'
  | '<='
  | '='
  | '!='
  | '%_change_>'
  | '%_change_<';

export interface AlertRule {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  vehicle_id?: number | null;
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  signal_name: string;
  op: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity: AlertRuleSeverity;
  cooldown_min: number;
  trigger_mode: AlertRuleTriggerMode;
  snoozed_until?: string | null;
  kind?: AlertRuleKind;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  max_fires_per_resolution?: number | null;
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  msg_template?: string | null;
  include_title?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  vehicle_id?: number | null;
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  signal_name?: string;
  op?: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity?: AlertRuleSeverity;
  cooldown_min?: number;
  trigger_mode?: AlertRuleTriggerMode;
  snoozed_until?: string | null;
  kind?: AlertRuleKind;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  max_fires_per_resolution?: number | null;
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  msg_template?: string | null;
  include_title?: boolean;
}

export type AlertRuleUpdate = Partial<AlertRuleInput>;

export interface ComputedMetricSummary {
  id: string;
  label: string;
  unit: string;
  windows: string[];
  ops: ComputedMetricOp[];
}

export interface ComputedMetricPreview {
  kind: 'computed_metric';
  metric_id: string;
  metric_window: string;
  metric_op: ComputedMetricOp;
  threshold: number;
  value: number;
  would_trigger: boolean;
  previous_value?: number;
  percent_change?: number;
}

export interface AlertRuleSnoozeRequest {
  minutes?: number;
  until?: string;
}

export interface AlertTestTarget {
  all_channels?: boolean;
  channel_ids?: number[];
}

export interface AlertTestRequest {
  message?: string;
  target?: AlertTestTarget | null;
  msg_template?: string | null;
  include_title?: boolean;
}

export type NotificationChannelKind =
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'email'
  | 'webhook'
  | 'ntfy'
  | 'pushover';

export interface NotificationChannelBase {
  id: number;
  name: string;
  kind: NotificationChannelKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannelDiscord
  extends NotificationChannelBase {
  kind: 'discord';
  webhook_url: string;
  username: string | null;
  avatar_url: string | null;
}

export interface NotificationChannelSlack extends NotificationChannelBase {
  kind: 'slack';
  webhook_url: string;
  channel: string | null;
  username: string | null;
}

export interface NotificationChannelTelegram
  extends NotificationChannelBase {
  kind: 'telegram';
  bot_token: string;
  chat_id: string;
}

export interface NotificationChannelEmail extends NotificationChannelBase {
  kind: 'email';
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_address: string;
  to_addresses: string[];
  use_tls: boolean;
}

export interface NotificationChannelWebhook extends NotificationChannelBase {
  kind: 'webhook';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body_template: string;
}

export interface NotificationChannelNtfy extends NotificationChannelBase {
  kind: 'ntfy';
  server_url: string;
  topic: string;
  priority: 1 | 2 | 3 | 4 | 5;
  username: string | null;
  password: string | null;
}

export interface NotificationChannelPushover
  extends NotificationChannelBase {
  kind: 'pushover';
  user_key: string;
  app_token: string;
  device: string | null;
  priority: -2 | -1 | 0 | 1 | 2;
}

export type NotificationChannel =
  | (NotificationChannelDiscord & { kind: 'discord' })
  | (NotificationChannelSlack & { kind: 'slack' })
  | (NotificationChannelTelegram & { kind: 'telegram' })
  | (NotificationChannelEmail & { kind: 'email' })
  | (NotificationChannelWebhook & { kind: 'webhook' })
  | (NotificationChannelNtfy & { kind: 'ntfy' })
  | (NotificationChannelPushover & { kind: 'pushover' });

export type NotificationLogStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'deferred_dnd'
  | string;

export interface NotificationLog {
  id: number;
  channel_id: number;
  alert_id: number | null;
  title: string;
  message: string;
  status: NotificationLogStatus;
  severity?: string;
  error: string;
  created_at: string;
  sent_at: string | null;
  scheduled_at?: string;
  latency_ms?: number;
  read_at?: string | null;
  archived_at?: string | null;
}

export interface NotificationLogGroup {
  group_key: string | null;
  latest: NotificationLog;
  count: number;
  unread_count: number;
  vehicle_ids: number[];
}

export interface NotificationStats {
  total_sent: number;
  sent: number;
  failed: number;
  pending: number;
  total_channels: number;
  enabled_channels: number;
}

export interface QuietHoursWindow {
  id: number;
  user_id: string;
  enabled: boolean;
  start_local: string;
  end_local: string;
  timezone: string;
  weekdays: number;
  bypass_severities: string[];
  created_at: string;
  updated_at: string;
}

export interface QuietHoursWindowInput {
  enabled?: boolean;
  start_local?: string;
  end_local?: string;
  timezone?: string;
  weekdays?: number;
  bypass_severities?: string[];
}

export type AlertRuleSaveRequest =
  | AlertRuleInput
  | (AlertRuleUpdate & Pick<AlertRule, 'id'>);

export type NotificationChannelCreate =
  NotificationChannel extends infer Channel
    ? Channel extends NotificationChannel
      ? Omit<Channel, 'id' | 'created_at' | 'updated_at'>
      : never
    : never;

export type NotificationChannelUpdate = NotificationChannelCreate & {
  id: number;
};

export type NotificationChannelInput =
  | NotificationChannelCreate
  | NotificationChannelUpdate;

export interface NotificationFilters {
  severity?: ('info' | 'warn' | 'critical')[];
  vehicle_id?: number[];
  rule_id?: number[];
  from?: string;
  to?: string;
  read?: boolean;
  archived?: boolean;
  q?: string;
  group_key?: string;
  limit?: number;
  offset?: number;
}

export interface AcknowledgeAlertInput {
  id: number;
  note?: string;
}

export interface CommentAlertInput {
  id: number;
  note: string;
}

export type BulkMarkReadVars =
  | { ids: number[]; all?: never; group_key?: never }
  | { ids?: never; all: true; group_key?: never }
  | { ids?: never; all?: never; group_key: string };

interface QuietHoursListResponse {
  windows: QuietHoursWindow[];
}

export type QuietHoursSavePayload = QuietHoursWindowInput & { id?: number };

export type OptimisticUpdater<TVariables, TPrev> = (
  prev: TPrev | undefined,
  vars: TVariables,
  key: QueryKey,
) => TPrev | undefined;

export interface OptimisticContext<TPrev> {
  snapshots: Array<[QueryKey, TPrev | undefined]>;
  keys: QueryKey[];
}

export interface UseOptimisticMutationOptions<TData, TVariables, TPrev> {
  mutationFn: (vars: TVariables) => Promise<TData>;
  queryKeys: QueryKey[] | ((vars: TVariables) => QueryKey[]);
  updater: OptimisticUpdater<TVariables, TPrev>;
  broadcast?: boolean;
  onMutate?: (vars: TVariables) => void;
  onSuccess?: (
    data: TData,
    vars: TVariables,
    ctx: OptimisticContext<TPrev>,
  ) => void;
  onError?: (
    err: Error,
    vars: TVariables,
    ctx: OptimisticContext<TPrev> | undefined,
  ) => void;
  onSettled?: (
    data: TData | undefined,
    err: Error | null,
    vars: TVariables,
    ctx: OptimisticContext<TPrev> | undefined,
  ) => void;
}

export const notificationKeys = {
  alerts: ['alerts'] as const,
  alertDetail: (id: number) => ['alerts', 'detail', id] as const,
  alertRules: ['alert-rules'] as const,
  alertMetrics: ['alert-metrics'] as const,
  channels: ['notification-channels'] as const,
  logs: ['notification-logs'] as const,
  logsFiltered: (filters?: NotificationFilters) =>
    ['notification-logs', 'filtered', filters ?? {}] as const,
  groups: (filters?: NotificationFilters) =>
    ['notification-logs', 'groups', filters ?? {}] as const,
  bellUnread: (limit: number) =>
    ['notification-logs', 'bell-unread', limit] as const,
  unreadCount: ['notification-logs', 'unread-count'] as const,
  stats: ['notification-stats'] as const,
  quietHours: ['notification-quiet-hours'] as const,
};

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

function serializeNotificationFilters(filters: NotificationFilters): string {
  const params = new URLSearchParams();
  if (filters.severity?.length) {
    params.append('severity', filters.severity.join(','));
  }
  if (filters.vehicle_id?.length) {
    params.append('vehicle_id', filters.vehicle_id.join(','));
  }
  if (filters.rule_id?.length) {
    params.append('rule_id', filters.rule_id.join(','));
  }
  if (filters.from) {
    params.append('from', filters.from);
  }
  if (filters.to) {
    params.append('to', filters.to);
  }
  if (typeof filters.read === 'boolean') {
    params.append('read', String(filters.read));
  }
  if (typeof filters.archived === 'boolean') {
    params.append('archived', String(filters.archived));
  }
  if (filters.q) {
    params.append('q', filters.q);
  }
  if (filters.group_key) {
    params.append('group_key', filters.group_key);
  }
  if (typeof filters.limit === 'number') {
    params.append('limit', String(filters.limit));
  }
  if (typeof filters.offset === 'number') {
    params.append('offset', String(filters.offset));
  }
  return params.toString();
}

export const __serializeNotificationFiltersForTest =
  serializeNotificationFilters;

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: { queryKey: QueryKey },
): void {
  void qc.invalidateQueries(filters);
}

function resolveKeys<TVariables>(
  spec: QueryKey[] | ((vars: TVariables) => QueryKey[]),
  vars: TVariables,
): QueryKey[] {
  return typeof spec === 'function' ? spec(vars) : spec;
}

function invalidate(qc: QueryClient, key: QueryKey): void {
  void qc.invalidateQueries({ queryKey: key });
}

export function useOptimisticMutation<TData, TVariables, TPrev = unknown>(
  opts: UseOptimisticMutationOptions<TData, TVariables, TPrev>,
): UseMutationResult<TData, Error, TVariables, OptimisticContext<TPrev>> {
  const qc = useQueryClient();

  return useMutation<TData, Error, TVariables, OptimisticContext<TPrev>>({
    mutationFn: opts.mutationFn,
    onMutate: async vars => {
      const keys = resolveKeys(opts.queryKeys, vars);
      const snapshots: Array<[QueryKey, TPrev | undefined]> = [];
      for (const key of keys) {
        await qc.cancelQueries({ queryKey: key });
        const matches = qc.getQueriesData<TPrev>({ queryKey: key });
        for (const [matchKey, prev] of matches) {
          snapshots.push([matchKey, prev]);
          qc.setQueryData<TPrev>(matchKey, old =>
            opts.updater(old, vars, matchKey),
          );
        }
      }
      opts.onMutate?.(vars);
      return { snapshots, keys };
    },
    onError: (err, vars, ctx) => {
      ctx?.snapshots.forEach(([key, prev]) => {
        qc.setQueryData(key, prev);
      });
      opts.onError?.(err, vars, ctx);
    },
    onSettled: (data, err, vars, ctx) => {
      const keys = ctx?.keys ?? resolveKeys(opts.queryKeys, vars);
      for (const key of keys) {
        invalidate(qc, key);
      }
      opts.onSettled?.(data, err, vars, ctx);
    },
    onSuccess: opts.onSuccess
      ? (data, vars, ctx) => opts.onSuccess?.(data, vars, ctx)
      : undefined,
  });
}

function isPositiveFiniteNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function useAlerts() {
  return useQuery({
    queryKey: notificationKeys.alerts,
    queryFn: ({ signal }) => request<Alert[]>('/alerts', { signal }),
    refetchInterval: INTERVALS.STANDARD,
    select: safeArray,
  });
}

export function useMarkAlertRead() {
  const { success, error } = useMutationToast();
  return useOptimisticMutation<void, string, Alert[]>({
    mutationFn: id => request<void>(`/alerts/${id}/read`, { method: 'POST' }),
    queryKeys: [notificationKeys.alerts],
    updater: (prev, id) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      return prev.map(alert =>
        String(alert.id) === id ? { ...alert, is_read: true } : alert,
      );
    },
    broadcast: true,
    onSuccess: () =>
      success('toast.alerts.markRead.success', 'Alert marked as read'),
    onError: err =>
      error(err, 'toast.alerts.markRead.error', 'Failed to mark alert as read'),
  });
}

export function useAlertDetail(
  id: number | null | undefined,
  options?: { enabled?: boolean },
) {
  const numericId = isPositiveFiniteNumber(id) ? id : null;
  return useQuery({
    queryKey:
      numericId !== null
        ? notificationKeys.alertDetail(numericId)
        : ['alerts', 'detail', 'disabled'],
    queryFn: ({ signal }) =>
      request<AlertDetail>(`/alerts/${numericId}`, { signal }),
    enabled: numericId !== null && (options?.enabled ?? true),
    staleTime: STALE_TIMES.QUICK,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<AlertDetail, AcknowledgeAlertInput, Alert[]>({
    mutationFn: ({ id, note }) =>
      request<AlertDetail>(`/alerts/${id}/acknowledge`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(
          note && note.trim().length > 0 ? { note: note.trim() } : {},
        ),
      }),
    queryKeys: [notificationKeys.alerts],
    updater: (prev, { id, note }) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      const nowIso = new Date().toISOString();
      const trimmed = note?.trim();
      return prev.map(alert =>
        alert.id === id
          ? {
              ...alert,
              acknowledged_at: nowIso,
              acknowledgement_note:
                trimmed && trimmed.length > 0
                  ? trimmed
                  : alert.acknowledgement_note ?? null,
            }
          : alert,
      );
    },
    broadcast: true,
    onSuccess: (detail, vars) => {
      qc.setQueryData(notificationKeys.alertDetail(vars.id), detail);
      success('toast.alerts.ack.success', 'Alert acknowledged');
    },
    onError: err =>
      error(err, 'toast.alerts.ack.error', 'Failed to acknowledge alert'),
  });
}

export function useCommentAlert() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, note }: CommentAlertInput) =>
      request<AlertDetail>(`/alerts/${id}/comment`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ note: note.trim() }),
      }),
    onSuccess: (detail, vars) => {
      qc.setQueryData(notificationKeys.alertDetail(vars.id), detail);
      success('toast.alerts.comment.success', 'Comment added');
    },
    onError: err =>
      error(err, 'toast.alerts.comment.error', 'Failed to add comment'),
  });
}

export function useReopenAlert() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<AlertDetail, number, Alert[]>({
    mutationFn: id =>
      request<AlertDetail>(`/alerts/${id}/reopen`, { method: 'POST' }),
    queryKeys: [notificationKeys.alerts],
    updater: (prev, id) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      return prev.map(alert =>
        alert.id === id
          ? {
              ...alert,
              acknowledged_at: null,
              acknowledged_by: null,
              acknowledgement_note: null,
            }
          : alert,
      );
    },
    broadcast: true,
    onSuccess: (detail, id) => {
      qc.setQueryData(notificationKeys.alertDetail(id), detail);
      success('toast.alerts.reopen.success', 'Alert reopened');
    },
    onError: err =>
      error(err, 'toast.alerts.reopen.error', 'Failed to reopen alert'),
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: notificationKeys.alertRules,
    queryFn: ({ signal }) => request<AlertRule[]>('/alerts/rules', { signal }),
    select: safeArray,
  });
}

export function useAlertMetrics() {
  return useQuery({
    queryKey: notificationKeys.alertMetrics,
    queryFn: ({ signal }) =>
      request<ComputedMetricSummary[]>('/alerts/metrics', { signal }),
    select: safeArray,
    staleTime: INTERVALS.STATIC,
  });
}

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
        headers: JSON_HEADERS,
        body: JSON.stringify({ kind: 'computed_metric', ...data }),
      }),
    onError: err =>
      error(err, 'toast.alerts.preview.error', 'Failed to preview metric'),
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
          headers: JSON_HEADERS,
          body: JSON.stringify(payload),
        });
      }
      return request<AlertRule>('/alerts/rules', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
      success('toast.alerts.saveRule.success', 'Alert rule saved');
    },
    onError: err =>
      error(err, 'toast.alerts.saveRule.error', 'Failed to save alert rule'),
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
    onError: err =>
      error(
        err,
        'toast.alerts.deleteRule.error',
        'Failed to delete alert rule',
      ),
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
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });
    },
    queryKeys: [notificationKeys.alertRules],
    updater: (prev, { id, enabled }) =>
      Array.isArray(prev)
        ? prev.map(rule => (rule.id === id ? { ...rule, enabled } : rule))
        : prev,
    broadcast: true,
    onSuccess: (_data, { enabled }) => {
      success(
        enabled
          ? 'toast.alerts.toggleRule.enabled'
          : 'toast.alerts.toggleRule.disabled',
        enabled ? 'Alert rule enabled' : 'Alert rule disabled',
      );
    },
    onError: err =>
      error(err, 'toast.alerts.toggleRule.error', 'Failed to toggle alert rule'),
  });
}

export function useBulkEnableRules() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{
        updated?: number;
        failed?: Array<{ id: number; reason: string }>;
      }>('/alerts/rules/bulk/enable', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    onSuccess: res => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
      success('toast.bulk.enable.success', '{{count}} enabled', {
        count: res.updated ?? 0,
      });
    },
    onError: err =>
      error(err, 'toast.bulk.enable.error', 'Failed to enable selection'),
  });
}

export function useBulkDisableRules() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{
        updated?: number;
        failed?: Array<{ id: number; reason: string }>;
      }>('/alerts/rules/bulk/disable', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    onSuccess: res => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
      success('toast.bulk.disable.success', '{{count}} disabled', {
        count: res.updated ?? 0,
      });
    },
    onError: err =>
      error(err, 'toast.bulk.disable.error', 'Failed to disable selection'),
  });
}

export function useTestAlertRule() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: AlertTestRequest) =>
      request<void>('/alerts/test', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      success('toast.alerts.test.success', 'Test alert sent');
    },
    onError: err =>
      error(err, 'toast.alerts.test.error', 'Failed to send test alert'),
  });
}

export function useSnoozeAlertRule() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & AlertRuleSnoozeRequest) =>
      request<AlertRule>(`/alerts/rules/${id}/snooze`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.alertRules });
      const cleared = vars.minutes != null && vars.minutes <= 0;
      success(
        cleared ? 'toast.alerts.snooze.cleared' : 'toast.alerts.snooze.success',
        cleared ? 'Snooze cleared' : 'Rule snoozed',
      );
    },
    onError: err =>
      error(err, 'toast.alerts.snooze.error', 'Failed to snooze rule'),
  });
}

export function useNotificationChannels() {
  return useQuery({
    queryKey: notificationKeys.channels,
    queryFn: ({ signal }) =>
      request<NotificationChannel[]>('/notifications', { signal }),
    select: safeArray,
  });
}

export function useNotificationLogs(
  filters: NotificationFilters = {},
  options?: { enabled?: boolean },
) {
  const qs = serializeNotificationFilters(filters);
  return useQuery({
    queryKey: notificationKeys.logsFiltered(filters),
    queryFn: ({ signal }) =>
      request<NotificationLog[]>(
        `/notifications/logs${qs ? `?${qs}` : ''}`,
        { signal },
      ),
    enabled: options?.enabled ?? true,
    select: safeArray,
  });
}

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
      request<NotificationLogGroup[]>(
        `/notifications/logs?grouped=true${tail}`,
        { signal },
      ),
    enabled: options?.enabled ?? true,
    select: safeArray,
  });
}

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
      request<NotificationLog[]>(
        `/notifications/logs${qs ? `?${qs}` : ''}`,
        { signal },
      ),
    enabled,
    select: safeArray,
    staleTime: STALE_TIMES.QUICK,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: ({ signal }) =>
      request<{ count: number }>('/notifications/unread-count', { signal }),
    refetchInterval: INTERVALS.STANDARD,
    select: data => data?.count ?? 0,
  });
}

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

function invalidateLogsAndUnread(qc: QueryClient) {
  invalidateAndBroadcast(qc, { queryKey: notificationKeys.logs });
  invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<{ updated: number }, number[], NotificationLog[]>({
    mutationFn: ids =>
      request<{ updated: number }>('/notifications/mark-read', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, ids) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      return prev.map(notification =>
        idSet.has(notification.id) && !notification.read_at
          ? { ...notification, read_at: now }
          : notification,
      );
    },
    broadcast: true,
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
      success('toast.notifications.markRead.success', 'Marked as read');
    },
    onError: err =>
      error(
        err,
        'toast.notifications.markRead.error',
        'Failed to mark as read',
      ),
    onSettled: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
  });
}

export function useBulkMarkRead() {
  const qc = useQueryClient();
  return useOptimisticMutation<
    { updated: number },
    BulkMarkReadVars,
    NotificationLog[]
  >({
    mutationFn: vars =>
      request<{ updated: number }>('/notifications/mark-read', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(vars),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, vars) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      if ('group_key' in vars && vars.group_key) {
        return prev;
      }
      const now = new Date().toISOString();
      if ('all' in vars && vars.all) {
        return prev.map(notification =>
          notification.read_at
            ? notification
            : { ...notification, read_at: now },
        );
      }
      if ('ids' in vars && vars.ids) {
        const idSet = new Set(vars.ids);
        if (idSet.size === 0) {
          return prev;
        }
        return prev.map(notification =>
          idSet.has(notification.id) && !notification.read_at
            ? { ...notification, read_at: now }
            : notification,
        );
      }
      return prev;
    },
    broadcast: true,
    onSuccess: (_data, vars) => {
      if ('group_key' in vars && vars.group_key) {
        invalidateAndBroadcast(qc, { queryKey: notificationKeys.logs });
      }
    },
    onSettled: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
  });
}

export function useMarkNotificationsUnread() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<{ updated: number }, number[], NotificationLog[]>({
    mutationFn: ids =>
      request<{ updated: number }>('/notifications/mark-unread', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, ids) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      const idSet = new Set(ids);
      return prev.map(notification =>
        idSet.has(notification.id) && notification.read_at
          ? { ...notification, read_at: null }
          : notification,
      );
    },
    broadcast: true,
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
      success('toast.notifications.markUnread.success', 'Marked as unread');
    },
    onError: err =>
      error(
        err,
        'toast.notifications.markUnread.error',
        'Failed to mark as unread',
      ),
    onSettled: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
    },
  });
}

export function useArchiveNotifications() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useOptimisticMutation<{ updated: number }, number[], NotificationLog[]>({
    mutationFn: ids =>
      request<{ updated: number }>('/notifications/archive', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    queryKeys: [notificationKeys.logs],
    updater: (prev, ids) => {
      if (!Array.isArray(prev)) {
        return prev;
      }
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      return prev.map(notification =>
        idSet.has(notification.id) && !notification.archived_at
          ? { ...notification, archived_at: now }
          : notification,
      );
    },
    broadcast: true,
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.unreadCount });
      success('toast.notifications.archive.success', 'Archived');
    },
    onError: err =>
      error(err, 'toast.notifications.archive.error', 'Failed to archive'),
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
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.unarchive.success', 'Restored from archive');
    },
    onError: err =>
      error(
        err,
        'toast.notifications.unarchive.error',
        'Failed to unarchive',
      ),
  });
}

export function useDeleteNotifications() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<{ deleted: number }>('/notifications/logs', {
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      invalidateLogsAndUnread(qc);
      success('toast.notifications.delete.success', 'Deleted');
    },
    onError: err =>
      error(
        err,
        'toast.notifications.delete.error',
        'Failed to delete notifications',
      ),
  });
}

export function useNotificationStats() {
  return useQuery({
    queryKey: notificationKeys.stats,
    queryFn: ({ signal }) =>
      request<NotificationStats>('/notifications/stats', { signal }),
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
        hasId
          ? `/notifications/${(data as NotificationChannelUpdate).id}`
          : '/notifications',
        {
          method: hasId ? 'PUT' : 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
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
    onError: err =>
      error(err, 'toast.channels.save.error', 'Failed to save channel'),
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
    onError: err =>
      error(err, 'toast.channels.delete.error', 'Failed to delete channel'),
  });
}

export function useToggleChannel() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<NotificationChannel>(`/notifications/${id}/toggle`, {
        method: 'POST',
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.channels });
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.stats });
      success('toast.channels.toggle.success', 'Channel toggled');
    },
    onError: err =>
      error(err, 'toast.channels.toggle.error', 'Failed to toggle channel'),
  });
}

export function useTestChannel() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ success: boolean; error?: string }>(
        `/notifications/${id}/test`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      success('toast.channels.test.success', 'Test notification sent');
    },
    onError: err =>
      error(err, 'toast.channels.test.error', 'Failed to send test'),
  });
}

export function useQuietHours() {
  return useQuery({
    queryKey: notificationKeys.quietHours,
    queryFn: ({ signal }) =>
      request<QuietHoursListResponse>('/notifications/quiet-hours', {
        signal,
      }).then(response => safeArray<QuietHoursWindow>(response?.windows)),
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
        isUpdate
          ? `/notifications/quiet-hours/${id}`
          : '/notifications/quiet-hours',
        {
          method: isUpdate ? 'PATCH' : 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: notificationKeys.quietHours });
      const isUpdate = typeof vars.id === 'number' && vars.id > 0;
      success(
        isUpdate
          ? 'toast.quietHours.save.updated'
          : 'toast.quietHours.save.created',
        isUpdate
          ? 'Quiet hours window updated'
          : 'Quiet hours window created',
      );
    },
    onError: err =>
      error(
        err,
        'toast.quietHours.save.error',
        'Failed to save quiet hours window',
      ),
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
    onError: err =>
      error(
        err,
        'toast.quietHours.delete.error',
        'Failed to delete quiet hours window',
      ),
  });
}
