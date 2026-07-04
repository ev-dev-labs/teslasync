import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, isApiError } from '../client';
import { useMutationToast } from './_toastHelpers';
import { STALE_TIMES } from '@/lib/constants';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type { PushSubscribeBody, PushSubscriptionRow } from '../types';

/**
 * TanStack Query hooks for the push_subscriptions API. The actual
 * `subscribe()` / `unsubscribe()` lifecycle (talking to
 * the browser's PushManager + service worker) lives in
 * `web/src/hooks/useWebPush.ts`; the hooks below only deal with the
 * server side of the contract (POST/GET/DELETE /push/subscribe and
 * GET /push/public-key).
 *
 * Wire contract: `internal/api/push_handler.go`.
 */

export const pushKeys = {
  publicKey: ['push', 'public-key'] as const,
  list: ['push', 'subscriptions'] as const,
};

/**
 * Fetch the VAPID public key. Returns `null` (not undefined, to keep
 * loading/disabled distinguishable) when the server returns 404 — the
 * UI interprets that as "browser push is not configured on this install"
 * and hides the Enable button.
 */
export function usePushPublicKey() {
  return useQuery({
    queryKey: pushKeys.publicKey,
    queryFn: async ({ signal }): Promise<string | null> => {
      try {
        const res = await request<{ publicKey?: string } | null>('/push/public-key', { signal });
        // Null-safe: a null/empty body (or an empty key) is "disabled",
        // not a crash — `res?.publicKey` guards the missing-object case.
        return res?.publicKey || null;
      } catch (err) {
        // 404 from the server means VAPID is unconfigured — surface as
        // "disabled" rather than an error so the channel card can render
        // its explanatory empty state. Prefer the structured HTTP status
        // (robust against copy changes); fall back to message-matching
        // for non-ApiError rejections.
        if (isApiError(err) && err.status === 404) {
          return null;
        }
        if (err instanceof Error && /not configured/i.test(err.message)) {
          return null;
        }
        throw err;
      }
    },
    staleTime: STALE_TIMES.RARE,
    retry: false,
  });
}

/**
 * List every push subscription registered with the server. In single-user
 * mode this is install-wide; the multi-tenant future scopes it per user
 * server-side. Used by the per-device list in the Browser Push channel
 * card.
 */
export function usePushSubscriptions() {
  return useQuery({
    queryKey: pushKeys.list,
    queryFn: ({ signal }) => request<PushSubscriptionRow[]>('/push/subscribe', { signal }),
    staleTime: STALE_TIMES.STANDARD,
  });
}

/**
 * Register or refresh a browser subscription on the server. Invalidates
 * the per-device list so the new row appears immediately.
 *
 * Idempotent — repeated POSTs from the same browser update p256dh / auth
 * in place rather than duplicating rows.
 */
export function useSubscribePush() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (body: PushSubscribeBody) =>
      request<PushSubscriptionRow>('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: pushKeys.list });
      success('toast.webpush.subscribe.success', 'Browser push enabled on this device');
    },
    onError: (e) => error(e, 'toast.webpush.subscribe.error', 'Failed to enable browser push'),
  });
}

/**
 * Remove a single subscription by endpoint. Used both by the per-device
 * "Remove" action and by the unsubscribe path in `useWebPush.unsubscribe()`.
 *
 * The toast helper deliberately uses neutral copy ("removed") rather
 * than "disabled" so the same hook can power both flows.
 */
export function useUnsubscribePush() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (endpoint: string) =>
      request<void>('/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: pushKeys.list });
      success('toast.webpush.unsubscribe.success', 'Browser push removed for this device');
    },
    onError: (e) => error(e, 'toast.webpush.unsubscribe.error', 'Failed to remove browser push'),
  });
}
