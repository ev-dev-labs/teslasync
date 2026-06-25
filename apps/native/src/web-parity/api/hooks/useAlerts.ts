import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '../client';
import { useMutationToast } from './_toastHelpers';

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

export type AlertRuleSaveRequest =
  | AlertRuleInput
  | (AlertRuleUpdate & Pick<AlertRule, 'id'>);

export interface AcknowledgeAlertInput {
  id: number;
  note?: string;
}

export interface CommentAlertInput {
  id: number;
  note: string;
}

const INTERVALS = {
  STANDARD: 30_000,
  STATIC: Infinity,
} as const;

const STALE_TIMES = {
  QUICK: 10_000,
} as const;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

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

function isPositiveFiniteNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const notificationKeys = {
  alerts: ['alerts'] as const,
  alertDetail: (id: number) => ['alerts', 'detail', id] as const,
  alertRules: ['alert-rules'] as const,
  alertMetrics: ['alert-metrics'] as const,
};

export const alertKeys = notificationKeys;

export function useAlerts() {
  return useQuery({
    queryKey: notificationKeys.alerts,
    queryFn: ({ signal }) => request<Alert[]>('/alerts', { signal }),
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
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: notificationKeys.alerts });
      const previous = qc.getQueryData<Alert[]>(notificationKeys.alerts);

      qc.setQueryData<Alert[]>(notificationKeys.alerts, current =>
        Array.isArray(current)
          ? current.map(alert =>
              String(alert.id) === id ? { ...alert, is_read: true } : alert,
            )
          : current,
      );

      return { previous };
    },
    onSuccess: () =>
      success('toast.alerts.markRead.success', 'Alert marked as read'),
    onError: (err, _id, context) => {
      if (context?.previous != null) {
        qc.setQueryData(notificationKeys.alerts, context.previous);
      }
      error(err, 'toast.alerts.markRead.error', 'Failed to mark alert as read');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alerts });
    },
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

  return useMutation({
    mutationFn: ({ id, note }: AcknowledgeAlertInput) =>
      request<AlertDetail>(`/alerts/${id}/acknowledge`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(
          note && note.trim().length > 0 ? { note: note.trim() } : {},
        ),
      }),
    onMutate: async ({ id, note }) => {
      await qc.cancelQueries({ queryKey: notificationKeys.alerts });
      const previous = qc.getQueryData<Alert[]>(notificationKeys.alerts);
      const nowIso = new Date().toISOString();
      const trimmed = note?.trim();

      qc.setQueryData<Alert[]>(notificationKeys.alerts, current =>
        Array.isArray(current)
          ? current.map(alert =>
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
            )
          : current,
      );

      return { previous };
    },
    onSuccess: (detail, vars) => {
      qc.setQueryData(notificationKeys.alertDetail(vars.id), detail);
      success('toast.alerts.ack.success', 'Alert acknowledged');
    },
    onError: (err, _vars, context) => {
      if (context?.previous != null) {
        qc.setQueryData(notificationKeys.alerts, context.previous);
      }
      error(err, 'toast.alerts.ack.error', 'Failed to acknowledge alert');
    },
    onSettled: (_data, _error, vars) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alerts });
      qc.invalidateQueries({ queryKey: notificationKeys.alertDetail(vars.id) });
    },
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

  return useMutation({
    mutationFn: (id: number) =>
      request<AlertDetail>(`/alerts/${id}/reopen`, { method: 'POST' }),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: notificationKeys.alerts });
      const previous = qc.getQueryData<Alert[]>(notificationKeys.alerts);

      qc.setQueryData<Alert[]>(notificationKeys.alerts, current =>
        Array.isArray(current)
          ? current.map(alert =>
              alert.id === id
                ? {
                    ...alert,
                    acknowledged_at: null,
                    acknowledged_by: null,
                    acknowledgement_note: null,
                  }
                : alert,
            )
          : current,
      );

      return { previous };
    },
    onSuccess: (detail, id) => {
      qc.setQueryData(notificationKeys.alertDetail(id), detail);
      success('toast.alerts.reopen.success', 'Alert reopened');
    },
    onError: (err, _id, context) => {
      if (context?.previous != null) {
        qc.setQueryData(notificationKeys.alerts, context.previous);
      }
      error(err, 'toast.alerts.reopen.error', 'Failed to reopen alert');
    },
    onSettled: (_data, _error, id) => {
      qc.invalidateQueries({ queryKey: notificationKeys.alerts });
      qc.invalidateQueries({ queryKey: notificationKeys.alertDetail(id) });
    },
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
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
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
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
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
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => {
      const payload: AlertRuleUpdate = { enabled };
      return request<AlertRule>(`/alerts/rules/${id}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });
    },
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: notificationKeys.alertRules });
      const previous = qc.getQueryData<AlertRule[]>(
        notificationKeys.alertRules,
      );

      qc.setQueryData<AlertRule[]>(notificationKeys.alertRules, current =>
        Array.isArray(current)
          ? current.map(rule => (rule.id === id ? { ...rule, enabled } : rule))
          : current,
      );

      return { previous };
    },
    onSuccess: (_data, { enabled }) => {
      success(
        enabled
          ? 'toast.alerts.toggleRule.enabled'
          : 'toast.alerts.toggleRule.disabled',
        enabled ? 'Alert rule enabled' : 'Alert rule disabled',
      );
    },
    onError: (err, _vars, context) => {
      if (context?.previous != null) {
        qc.setQueryData(notificationKeys.alertRules, context.previous);
      }
      error(
        err,
        'toast.alerts.toggleRule.error',
        'Failed to toggle alert rule',
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
    },
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
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
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
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
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
      qc.invalidateQueries({ queryKey: notificationKeys.alertRules });
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

export {
  alertMessageKeys,
  useAlertMessagePresets,
  useAlertMessagePlaceholders,
  useAlertMessagePreview,
} from './useAlertMessageHelpers';
