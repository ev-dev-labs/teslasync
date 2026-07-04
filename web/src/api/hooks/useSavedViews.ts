import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { STALE_TIMES } from '@/lib/constants';
import { safeArray } from '@/lib/safeArray';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useOptimisticMutation } from './useOptimisticMutation';
import type { SavedView, SavedViewCreateInput, SavedViewUpdateInput } from '../types';

/**
 * TanStack Query hooks for the saved-views table.
 *
 * Each list page that wants to give the user a "save this filter combo"
 * affordance calls `useSavedViews(route)` to enumerate views for that
 * surface, then hands the result to `<SavedViewMenu route currentQuery
 * onApply />` (web/src/components/data-display).
 *
 * Wire contract: see `internal/api/saved_views_handler.go`.
 */

export const savedViewsKeys = {
  all: ['saved-views'] as const,
  list: (route: string) => ['saved-views', route] as const,
};

function buildQuery(route: string): string {
  const usp = new URLSearchParams();
  usp.set('route', route);
  return `?${usp.toString()}`;
}

/**
 * Fetch the current user's saved views for a list-page route. Once the
 * query resolves it ALWAYS yields an array — never `null` or a stray
 * object — so consumers can `.map(...)` and `.find(...)` without a null
 * guard. This is enforced by the `select: safeArray` coercion rather than
 * trusting the wire payload, matching every other list hook in the
 * codebase (useExports, useGuardEvents, …).
 *
 * staleTime is set to STANDARD (60s) — saved views change rarely, but
 * we still want the menu to reflect a fresh "Save current view" within
 * one minute of writing it on another tab.
 */
export function useSavedViews(route: string) {
  return useQuery({
    queryKey: savedViewsKeys.list(route),
    queryFn: ({ signal }) => request<SavedView[]>(`/saved-views${buildQuery(route)}`, { signal }),
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

/**
 * Create a new saved view. Invalidates the route's list query so the
 * menu reflects the new entry immediately. Surfaces a toast so the user
 * can see the save succeeded (or why it failed — duplicate name, etc.).
 */
export function useCreateSavedView() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: (input: SavedViewCreateInput) =>
      request<SavedView>('/saved-views', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (created) => {
      invalidateAndBroadcast(qc, { queryKey: savedViewsKeys.list(created.route) });
      success('toast.savedViews.create.success', 'Saved view created');
    },
    onError: (e) => error(e, 'toast.savedViews.create.error', 'Failed to save view'),
  });
}

export interface UpdateSavedViewArgs {
  id: number;
  route: string;
  patch: SavedViewUpdateInput;
}

/**
 * Patch an existing saved view. The caller passes the route alongside
 * the id so we can invalidate the right list cache without a round-trip
 * to read the row back.
 */
export function useUpdateSavedView() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({ id, patch }: UpdateSavedViewArgs) =>
      request<SavedView>(`/saved-views/${id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: savedViewsKeys.list(vars.route) });
      success('toast.savedViews.update.success', 'View updated');
    },
    onError: (e) => error(e, 'toast.savedViews.update.error', 'Failed to update view'),
  });
}

export interface DeleteSavedViewArgs {
  id: number;
  route: string;
}

/**
 * Delete a saved view by id. The caller passes the route so we can
 * invalidate the right list cache.
 */
export function useDeleteSavedView() {
  const { success, error } = useMutationToast();

  return useOptimisticMutation<void, DeleteSavedViewArgs, SavedView[]>({
    mutationFn: ({ id }) =>
      request<void>(`/saved-views/${id}`, { method: 'DELETE' }),
    queryKeys: ({ route }) => [savedViewsKeys.list(route)],
    updater: (prev, { id }) => prev?.filter((v) => v.id !== id),
    broadcast: true,
    onMutate: () => {
      // The row is gone from the menu the instant the user confirms;
      // toast still waits for the server so a network error surfaces
      // alongside the row reappearing.
    },
    onSuccess: () => {
      success('toast.savedViews.delete.success', 'View deleted');
    },
    onError: (e) =>
      error(e, 'toast.savedViews.delete.error', 'Failed to delete view'),
  });
}

export interface SetDefaultSavedViewArgs {
  id: number;
  route: string;
  isDefault: boolean;
}

/**
 * Toggle the default flag on a saved view. Backed by the same Update
 * endpoint as useUpdateSavedView — exposed as its own hook for clarity
 * at call sites that don't need to send a generic patch.
 */
export function useSetDefaultSavedView() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({ id, isDefault }: SetDefaultSavedViewArgs) =>
      request<SavedView>(`/saved-views/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_default: isDefault }),
      }),
    onSuccess: (_data, vars) => {
      invalidateAndBroadcast(qc, { queryKey: savedViewsKeys.list(vars.route) });
      success(
        vars.isDefault ? 'toast.savedViews.setDefault.success' : 'toast.savedViews.unsetDefault.success',
        vars.isDefault ? 'Default view set' : 'Default cleared',
      );
    },
    onError: (e) => error(e, 'toast.savedViews.setDefault.error', 'Failed to update default'),
  });
}
