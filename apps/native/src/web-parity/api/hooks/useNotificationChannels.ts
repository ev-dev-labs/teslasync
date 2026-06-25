import {useMemo} from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {request, type ApiRequestOptions} from '../client';
import {useMutationToast} from './_toastHelpers';

const JSON_HEADERS = {'Content-Type': 'application/json'} as const;

export const nativeNotificationChannelHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

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

function invalidateAndBroadcast(
  queryClient: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void queryClient.invalidateQueries(filters);
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

export interface NotificationChannelDiscord extends NotificationChannelBase {
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

export interface NotificationChannelTelegram extends NotificationChannelBase {
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

export interface NotificationChannelPushover extends NotificationChannelBase {
  kind: 'pushover';
  user_key: string;
  app_token: string;
  device: string | null;
  priority: -2 | -1 | 0 | 1 | 2;
}

export type NotificationChannel =
  | (NotificationChannelDiscord & {kind: 'discord'})
  | (NotificationChannelSlack & {kind: 'slack'})
  | (NotificationChannelTelegram & {kind: 'telegram'})
  | (NotificationChannelEmail & {kind: 'email'})
  | (NotificationChannelWebhook & {kind: 'webhook'})
  | (NotificationChannelNtfy & {kind: 'ntfy'})
  | (NotificationChannelPushover & {kind: 'pushover'});

export interface WebhookTestResult {
  success: boolean;
  status_code: number;
  latency_ms: number;
  body_preview?: string;
  truncated?: boolean;
  signature?: string;
  error?: string;
}

export interface WebhookSignaturePreviewRequest {
  secret: string;
  body: string;
}

export interface WebhookSignaturePreviewResult {
  signature: string;
}

export type NotificationChannelCreate = NotificationChannel extends infer C
  ? C extends NotificationChannel
    ? Omit<C, 'id' | 'created_at' | 'updated_at'>
    : never
  : never;

export type NotificationChannelUpdate = NotificationChannelCreate & {id: number};

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

export function useNotificationChannels() {
  return useQuery({
    queryKey: notificationKeys.channels,
    queryFn: ({signal}) =>
      request<NotificationChannel[]>('/notifications', {signal}),
    select: safeArray,
  });
}

export function useSaveChannel() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation({
    mutationFn: (data: NotificationChannelInput) => {
      const hasId = 'id' in data && typeof data.id === 'number';
      return request<NotificationChannel>(
        hasId ? `/notifications/${data.id}` : '/notifications',
        {
          method: hasId ? 'PUT' : 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(queryClient, {queryKey: notificationKeys.channels});
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
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/notifications/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, {queryKey: notificationKeys.channels});
      invalidateAndBroadcast(queryClient, {queryKey: notificationKeys.stats});
      success('toast.channels.delete.success', 'Channel deleted');
    },
    onError: err =>
      error(err, 'toast.channels.delete.error', 'Failed to delete channel'),
  });
}

export function useToggleChannel() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation({
    mutationFn: (id: number) =>
      request<NotificationChannel>(`/notifications/${id}/toggle`, {
        method: 'POST',
      }),
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, {queryKey: notificationKeys.channels});
      invalidateAndBroadcast(queryClient, {queryKey: notificationKeys.stats});
      success('toast.channels.toggle.success', 'Channel toggled');
    },
    onError: err =>
      error(err, 'toast.channels.toggle.error', 'Failed to toggle channel'),
  });
}

export function useTestChannel() {
  const {success, error} = useMutationToast();

  return useMutation({
    mutationFn: (id: number) =>
      request<{success: boolean; error?: string}>(
        `/notifications/${id}/test`,
        {method: 'POST'},
      ),
    onSuccess: () => {
      success('toast.channels.test.success', 'Test notification sent');
    },
    onError: err =>
      error(err, 'toast.channels.test.error', 'Failed to send test'),
  });
}

export function useWebhookChannels() {
  const all = useNotificationChannels();
  const webhooks = useMemo<NotificationChannelWebhook[]>(() => {
    const list = safeArray<NotificationChannel>(all.data);
    return list.filter(
      (ch): ch is NotificationChannelWebhook => ch.kind === 'webhook',
    );
  }, [all.data]);

  return {
    ...all,
    data: webhooks,
  };
}

export function useTestWebhookChannel() {
  return useMutation<
    WebhookTestResult,
    Error,
    {id: number; title?: string; message?: string}
  >({
    mutationFn: ({id, title, message}) => {
      const body: {title?: string; message?: string} = {};
      if (typeof title === 'string' && title.trim() !== '') {
        body.title = title;
      }
      if (typeof message === 'string' && message.trim() !== '') {
        body.message = message;
      }

      const init: ApiRequestOptions = {method: 'POST'};
      if (Object.keys(body).length > 0) {
        init.headers = JSON_HEADERS;
        init.body = JSON.stringify(body);
      }

      return request<WebhookTestResult>(
        `/notifications/${id}/webhook-test`,
        init,
      );
    },
  });
}

export function useWebhookSignaturePreview() {
  return useMutation<
    WebhookSignaturePreviewResult,
    Error,
    WebhookSignaturePreviewRequest
  >({
    mutationFn: body =>
      request<WebhookSignaturePreviewResult>(
        '/notifications/webhooks/preview-signature',
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        },
      ),
  });
}

export function useInvalidateWebhookChannels() {
  const queryClient = useQueryClient();
  return () =>
    invalidateAndBroadcast(queryClient, {queryKey: notificationKeys.channels});
}

export {useMutationToast};
