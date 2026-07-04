import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Hooks for the named dashboard layout library backed by `dashboard_layouts`;
 * see `internal/api/dashboard_layout_handler.go` for the wire contract.
 *
 * Separate from the legacy dashboard-layout blob hooks in `useSettings.ts`;
 * these manage per-row presets for the `<LayoutSwitcher>` flow.
 */

export interface NamedDashboardLayout {
  id: number;
  user_id?: number | null;
  vehicle_id?: number | null;
  name: string;
  is_default: boolean;
  /** Opaque SavedDashboard JSON blob; consumers narrow it via the widget reconciler. */
  layout: unknown;
  created_at: string;
  updated_at: string;
}

export interface CreateDashboardLayoutInput {
  name: string;
  vehicle_id?: number | null;
  is_default?: boolean;
  layout: unknown;
}

export interface UpdateDashboardLayoutInput {
  id: number;
  name?: string;
  is_default?: boolean;
  layout?: unknown;
}

export const dashboardLayoutLibraryKeys = {
  all: ['dashboard-layouts-library'] as const,
  list: (vehicleId: number | null | undefined) =>
    ['dashboard-layouts-library', vehicleId ?? 'global'] as const,
};

/**
 * List the user's saved layouts, optionally scoped to a single vehicle.
 * The backend returns vehicle-pinned and user-global (`vehicle_id IS NULL`)
 * layouts so the switcher can show both in one list.
 *
 * `select: safeArray` guarantees a real array on success even if the endpoint
 * ever regresses to a null/non-array body, so the `<LayoutSwitcher>` can
 * `.map()` over `data` without a null guard (matches the list-hook convention
 * in useExports.ts).
 */
export function useNamedDashboardLayouts(vehicleId?: number | null) {
  return useQuery({
    queryKey: dashboardLayoutLibraryKeys.list(vehicleId),
    queryFn: ({ signal }) => {
      const qs = vehicleId != null ? `?vehicle_id=${vehicleId}` : '';
      return request<NamedDashboardLayout[]>(`/dashboard/layouts${qs}`, { signal });
    },
    select: safeArray,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useCreateDashboardLayout() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (input: CreateDashboardLayoutInput) =>
      request<NamedDashboardLayout>('/dashboard/layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardLayoutLibraryKeys.all });
      success('toast.dashboard.layoutSaved.success', 'Layout saved to library');
    },
    onError: (e) => error(e, 'toast.dashboard.layoutSaved.error', 'Failed to save layout'),
  });
}

export function useUpdateDashboardLayout() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateDashboardLayoutInput) =>
      request<NamedDashboardLayout>(`/dashboard/layouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardLayoutLibraryKeys.all });
      success('toast.dashboard.layoutUpdated.success', 'Layout updated');
    },
    onError: (e) => error(e, 'toast.dashboard.layoutUpdated.error', 'Failed to update layout'),
  });
}

export function useDeleteDashboardLayout() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/dashboard/layouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardLayoutLibraryKeys.all });
      success('toast.dashboard.layoutDeleted.success', 'Layout deleted');
    },
    onError: (e) => error(e, 'toast.dashboard.layoutDeleted.error', 'Failed to delete layout'),
  });
}

/** Mark a layout as the default for its (user, vehicle) scope. */
export function useApplyDashboardLayout() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<NamedDashboardLayout>(`/dashboard/layouts/${id}/apply`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardLayoutLibraryKeys.all });
      success('toast.dashboard.layoutApplied.success', 'Layout applied');
    },
    onError: (e) => error(e, 'toast.dashboard.layoutApplied.error', 'Failed to apply layout'),
  });
}
