import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {isApiError, request} from '../client';
import {useMutationToast} from './_toastHelpers';

const STALE_TIMES = {
  STANDARD: 30_000,
  RARE: 5 * 60_000,
} as const;

export const nativePushHookCapabilities = {
  browserPushManagerAvailable: false,
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

function invalidateAndBroadcast(
  queryClient: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void queryClient.invalidateQueries(filters);
}

/**
 * One row of `push_subscriptions`. Mirrors `internal/models.PushSubscription`.
 * The `keys` shape is intentionally not nested because the server stores
 * `p256dh` / `auth` flat alongside `endpoint`.
 */
export interface PushSubscriptionRow {
  id: number;
  user_id: number | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Browser PushSubscription.toJSON() shape used by `/push/subscribe`.
 *
 * Native cannot create this browser PushManager payload itself; callers must
 * provide an endpoint/key pair from a compatible registration bridge.
 */
export interface PushSubscribeBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * TanStack Query hooks for the push_subscriptions API. The browser
 * `subscribe()` / `unsubscribe()` lifecycle from `web/src/hooks/useWebPush.ts`
 * has no native implementation in this parity slice; these hooks only preserve
 * the server-side contract.
 *
 * Wire contract: `internal/api/push_handler.go`.
 */

export const pushKeys = {
  publicKey: ['push', 'public-key'] as const,
  list: ['push', 'subscriptions'] as const,
};

/**
 * Fetch the VAPID public key. Returns `null` (not undefined, to keep
 * loading/disabled distinguishable) when the server returns 404 - the
 * UI interprets that as "browser push is not configured on this install"
 * and hides the Enable button.
 */
export function usePushPublicKey() {
  return useQuery({
    queryKey: pushKeys.publicKey,
    queryFn: async ({signal}): Promise<string | null> => {
      try {
        const res = await request<{publicKey: string}>('/push/public-key', {
          signal,
        });
        return res.publicKey || null;
      } catch (err) {
        if (
          (isApiError(err) && err.status === 404) ||
          (err instanceof Error && /404|not configured/i.test(err.message))
        ) {
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
 * List every push subscription registered with the server. In single-user mode
 * this is install-wide; the multi-tenant future scopes it per user server-side.
 * Used by the per-device list in the Browser Push channel card.
 */
export function usePushSubscriptions() {
  return useQuery({
    queryKey: pushKeys.list,
    queryFn: ({signal}) =>
      request<PushSubscriptionRow[]>('/push/subscribe', {signal}),
    staleTime: STALE_TIMES.STANDARD,
  });
}

/**
 * Register or refresh a browser subscription on the server. Invalidates the
 * per-device list so the new row appears immediately.
 *
 * Idempotent - repeated POSTs from the same browser update p256dh / auth in
 * place rather than duplicating rows.
 */
export function useSubscribePush() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (body: PushSubscribeBody) =>
      request<PushSubscriptionRow>('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: pushKeys.list});
      success(
        'toast.webpush.subscribe.success',
        'Browser push enabled on this device',
      );
    },
    onError: e =>
      error(
        e,
        'toast.webpush.subscribe.error',
        'Failed to enable browser push',
      ),
  });
}

/**
 * Remove a single subscription by endpoint. Used both by the per-device
 * "Remove" action and by the unsubscribe path in `useWebPush.unsubscribe()`.
 *
 * The toast helper deliberately uses neutral copy ("removed") rather than
 * "disabled" so the same hook can power both flows.
 */
export function useUnsubscribePush() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (endpoint: string) =>
      request<void>('/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({endpoint}),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: pushKeys.list});
      success(
        'toast.webpush.unsubscribe.success',
        'Browser push removed for this device',
      );
    },
    onError: e =>
      error(
        e,
        'toast.webpush.unsubscribe.error',
        'Failed to remove browser push',
      ),
  });
}
