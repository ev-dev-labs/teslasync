import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { STALE_TIMES } from '@/lib/constants';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type { PinnedItem, PinnedItemType } from '../types';

/**
 * TanStack Query hooks for unified pin storage.
 *
 * Surfaces (vehicle picker, dashboard widgets, alerts, geofences,
 * automations, commands) call `usePinned(type, context?)` to know which
 * rows to float to the top, and `useTogglePin(type)` to flip the pin.
 *
 * Wire contract: see `internal/api/pinned_handler.go`.
 */

export const pinnedKeys = {
  all: ['pinned'] as const,
  /**
   * Context-agnostic prefix for a single item type. Matches every
   * `list(type, *)` bucket (all contexts) under TanStack Query's
   * prefix-based `invalidateQueries`, unlike `list(type)` which pins the
   * third tuple slot to `null` and would miss context-scoped queries.
   */
  type: (type: PinnedItemType) => ['pinned', type] as const,
  list: (type: PinnedItemType, context?: string) =>
    ['pinned', type, context ?? null] as const,
};

function buildQuery(type: PinnedItemType, context?: string): string {
  const usp = new URLSearchParams();
  usp.set('type', type);
  if (context != null) usp.set('context', context);
  return `?${usp.toString()}`;
}

/**
 * Shared empty result reused as the null-body fallback in {@link selectPinned}
 * so a 204 / malformed response resolves to a single stable `[]` reference
 * rather than churning a new array (and re-rendering consumers) on each read.
 */
const EMPTY_PINNED: PinnedItem[] = [];

/**
 * Coerces the raw list body to an array. The backend always emits `[]`
 * (see `pinned_handler.go` `List`), but a 204 / malformed body would
 * otherwise surface as `null` here and break the never-undefined guarantee
 * every consumer (`.some`, `.map`) relies on.
 */
function selectPinned(rows: PinnedItem[]): PinnedItem[] {
  return rows ?? EMPTY_PINNED;
}

/**
 * Fetch the current user's pins of a given type, optionally narrowed to a
 * sub-surface (e.g. a specific dashboard ID when pinning widgets). Always
 * returns an array — never undefined — so consumers can `.some(...)` or
 * `.map(...)` without a null guard.
 */
export function usePinned(type: PinnedItemType, context?: string) {
  return useQuery({
    queryKey: pinnedKeys.list(type, context),
    queryFn: ({ signal }) => request<PinnedItem[]>(`/pinned${buildQuery(type, context)}`, { signal }),
    select: selectPinned,
    staleTime: STALE_TIMES.SLOW,
  });
}

export interface TogglePinInput {
  itemId: string;
  context?: string;
  pin: boolean;
}

/**
 * Pin or unpin a single item. The `pin` flag chooses between POST (create)
 * and DELETE (by id, looked up from the cache). The mutation invalidates
 * every `pinned[type]` query so dependent surfaces re-render in pin order.
 *
 * NOTE: Not migrated to `useOptimisticMutation` — the unpin path needs to
 * read the existing pinned-row id from the cache to build the DELETE URL,
 * and an optimistic removal would drop the row from the cache before the
 * mutationFn could look it up. Keep this on the explicit useMutation path
 * until either (a) the backend learns to delete-by-(type,item_id) so we
 * skip the lookup, or (b) the helper grows a `beforeMutate` hook that
 * fires ahead of the optimistic write.
 */
export function useTogglePin(type: PinnedItemType) {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: async ({ itemId, context, pin }: TogglePinInput) => {
      if (pin) {
        return request<PinnedItem>('/pinned', {
          method: 'POST',
          body: JSON.stringify({
            item_type: type,
            item_id: itemId,
            ...(context != null ? { context } : {}),
          }),
        });
      }
      // Unpin: look up the existing row id from the cache for the matching
      // (type, context) bucket. Fall back to a fresh fetch when the cache
      // hasn't been hydrated yet.
      const cached = qc.getQueryData<PinnedItem[]>(pinnedKeys.list(type, context));
      const existing =
        cached?.find(p => String(p.item_id) === String(itemId)) ??
        ((await request<PinnedItem[]>(`/pinned${buildQuery(type, context)}`)) ?? []).find(
          p => String(p.item_id) === String(itemId),
        );
      if (!existing) return null;
      await request<void>(`/pinned/${existing.id}`, { method: 'DELETE' });
      return null;
    },
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: pinnedKeys.all });
      if (vars.pin) {
        success('toast.pin.pinned.success', 'Pinned');
      } else {
        success('toast.pin.unpinned.success', 'Unpinned');
      }
    },
    onError: (e, vars) => {
      if (vars.pin) {
        error(e, 'toast.pin.pinned.error', 'Failed to pin');
      } else {
        error(e, 'toast.pin.unpinned.error', 'Failed to unpin');
      }
    },
  });
}

export interface ReorderPinInput {
  id: number;
  position: number;
}

/**
 * Reorder a single pin within its bucket. The drag handler is expected to
 * issue one mutation per moved item. The mutation invalidates every
 * `pinned[type]` query so consumers re-render in the new order.
 */
export function useReorderPin(type: PinnedItemType) {
  const qc = useQueryClient();
  const { error } = useMutationToast();

  return useMutation({
    mutationFn: ({ id, position }: ReorderPinInput) =>
      request<PinnedItem>(`/pinned/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ position }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: pinnedKeys.type(type) });
    },
    onError: (e) => error(e, 'toast.pin.reorder.error', 'Failed to reorder pins'),
  });
}
