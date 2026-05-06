/**
 * Phase-46 / Prompt 37 — webhook channel hooks.
 *
 * Re-exports the generic notification-channel CRUD hooks from
 * `@/api/hooks/useNotifications` so the new Settings webhook section
 * doesn't have to import from two different places, and adds:
 *
 *   - useWebhookChannels()      — derived list filtered to kind=webhook
 *   - useTestWebhookChannel()   — POST /notifications/{id}/webhook-test
 *                                 (HMAC-aware path; returns structured
 *                                  Result with status/latency/preview)
 *   - useWebhookSignaturePreview() — POST /notifications/webhooks/preview-signature
 *                                 (pure utility — Sign(secret, body))
 *
 * The backend route layout is documented in
 * internal/api/notification_channel_handler.go.
 */

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/api/client';
import { safeArray } from '@/lib/safeArray';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useMutationToast } from '@/api/hooks/_toastHelpers';
import {
  notificationKeys,
  useNotificationChannels,
  useSaveChannel,
  useDeleteChannel,
  useToggleChannel,
  useTestChannel,
  type NotificationChannelInput,
  type NotificationChannelCreate,
  type NotificationChannelUpdate,
} from '@/api/hooks/useNotifications';
import type {
  NotificationChannel,
  NotificationChannelWebhook,
  WebhookTestResult,
  WebhookSignaturePreviewRequest,
  WebhookSignaturePreviewResult,
} from '@/api/types';

// Re-exports so consumers don't double-import from useNotifications.
export {
  notificationKeys,
  useNotificationChannels,
  useSaveChannel,
  useDeleteChannel,
  useToggleChannel,
  useTestChannel,
};
export type {
  NotificationChannel,
  NotificationChannelWebhook,
  NotificationChannelInput,
  NotificationChannelCreate,
  NotificationChannelUpdate,
  WebhookTestResult,
  WebhookSignaturePreviewRequest,
  WebhookSignaturePreviewResult,
};

/**
 * Returns only the webhook-kind channels from the full notification
 * channels list. Memoised so the WebhookChannelsSection re-renders
 * only when a webhook channel actually changes.
 *
 * Mirrors the shape of useNotificationChannels(): { data, isLoading,
 * error, refetch }. The `data` is always an array (never undefined)
 * because we feed through `safeArray` and an empty filter result.
 */
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

/**
 * Fires a structured test event through the HMAC-aware webhook
 * delivery path on the server. Returns the response body
 * unconditionally — even on 5xx — because the UI surfaces both the
 * structured failure (`success=false`) and the raw status/latency/
 * body preview so the user can debug their receiver.
 *
 * The mutation deliberately does NOT show a toast: the page renders
 * the structured result inline. Errors thrown by `request()` are
 * still propagated to `onError` so genuine network failures (offline,
 * 401 from RequireSudo, etc.) bubble normally.
 */
export function useTestWebhookChannel() {
  return useMutation<
    WebhookTestResult,
    Error,
    { id: number; title?: string; message?: string }
  >({
    mutationFn: ({ id, title, message }) => {
      const body: { title?: string; message?: string } = {};
      if (typeof title === 'string' && title.trim() !== '') body.title = title;
      if (typeof message === 'string' && message.trim() !== '') body.message = message;
      const init: RequestInit = { method: 'POST' };
      if (Object.keys(body).length > 0) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      return request<WebhookTestResult>(`/notifications/${id}/webhook-test`, init);
    },
  });
}

/**
 * Pure-utility hook that asks the server to compute the
 * X-TeslaSync-Signature value for a given (secret, body) pair. The
 * UI uses it in the form modal to render a copy-paste-ready
 * signature preview before the channel has been saved (or while the
 * user is iterating on the secret).
 *
 * Empty secret returns BAD_REQUEST per the server contract — callers
 * should guard the input with `secret.trim() !== ''` before firing.
 */
export function useWebhookSignaturePreview() {
  return useMutation<WebhookSignaturePreviewResult, Error, WebhookSignaturePreviewRequest>({
    mutationFn: (body) =>
      request<WebhookSignaturePreviewResult>(
        '/notifications/webhooks/preview-signature',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
  });
}

/**
 * Convenience: invalidate the channels cache. Used by the Settings
 * page after a channel is created or removed to keep multiple panels
 * in sync without each one duplicating the queryClient plumbing.
 */
export function useInvalidateWebhookChannels() {
  const qc = useQueryClient();
  return () => invalidateAndBroadcast(qc, { queryKey: notificationKeys.channels });
}

/**
 * Re-export of the toast helper so the section can hoist a single
 * toast scope. Avoids importing from `@/api/hooks/_toastHelpers`
 * directly — that path is private to the hooks layer.
 */
export { useMutationToast };
