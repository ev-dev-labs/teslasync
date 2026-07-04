import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { STALE_TIMES } from '@/lib/constants';
import { safeArray } from '@/lib/safeArray';
import type { User } from '@/types/user';
import type { UserActivityEntry } from '@/types/admin';

export const userKeys = {
  me: ['users', 'me'] as const,
  myActivity: (params: MyActivityParams) =>
    ['users', 'me', 'activity', params] as const,
  teslaFeatureConfig: ['tesla-feature-config'] as const,
  teslaRegion: ['tesla-user-region'] as const,
  teslaOrders: ['tesla-user-orders'] as const,
  teslaProfile: ['tesla-user-profile'] as const,
};

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn: ({ signal }) => request<User>('/users/me', { signal }),
    // Identity is near-static — like the Tesla feature-config it changes
    // rarely, so don't refetch it on every mount/focus. Brings this hook in
    // line with the explicit staleTime every other query in this module sets.
    staleTime: STALE_TIMES.EXTENDED,
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: { displayName: string }) =>
      request<User>('/users/me', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.me, data);
      success('toast.user.update.success', 'Profile updated');
    },
    onError: (err) => error(err, 'toast.user.update.error', 'Failed to update profile'),
  });
}

// ─── My Recent Activity ──────────────────────────────────────────────────────

export interface MyActivityParams {
  /** ISO date string (YYYY-MM-DD). Optional — backend defaults to last 30 days. */
  start?: string;
  /** ISO date string (YYYY-MM-DD). Optional — backend defaults to today. */
  end?: string;
  /** Max rows to return. Backend caps at 200. */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
}

function buildActivityQuery(params: MyActivityParams): string {
  const search = new URLSearchParams();
  if (params.start) search.set('start', params.start);
  if (params.end) search.set('end', params.end);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Fetches the current user's own audit-log activity.
 *
 * `select: safeArray` coerces a missing or non-array payload to `[]`, so the
 * consuming page can iterate `data` without a null guard even for an empty
 * activity log. The backend surfaces 503 (ForwardAuth not configured), 401
 * (no identity header), and 400 (start after end) as errors — these reach the
 * caller as an ApiError so the page can render an explanatory state rather
 * than a silently-empty list.
 */
export function useMyRecentActivity(params: MyActivityParams = {}) {
  return useQuery({
    queryKey: userKeys.myActivity(params),
    queryFn: ({ signal }) =>
      request<UserActivityEntry[]>(`/users/me/activity${buildActivityQuery(params)}`, { signal }),
    select: safeArray,
    staleTime: STALE_TIMES.STANDARD,
  });
}

// ─── Tesla Feature Config ────────────────────────────────────────────────────

interface TeslaConfigEnvelope<T = Record<string, unknown>> {
  data: T;
  fetched_at: string | null;
}

export function useTeslaFeatureConfig() {
  return useQuery({
    queryKey: userKeys.teslaFeatureConfig,
    queryFn: ({ signal }) => request<TeslaConfigEnvelope>('/tesla/user/feature-config', { signal }),
    staleTime: STALE_TIMES.EXTENDED,
  });
}

export function useRefreshTeslaFeatureConfig() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaConfigEnvelope>('/tesla/user/feature-config/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.teslaFeatureConfig });
      success('toast.user.featureConfig.success', 'Feature config refreshed');
    },
    onError: (err) => error(err, 'toast.user.featureConfig.error', 'Failed to refresh feature config'),
  });
}

// ─── Tesla Region ────────────────────────────────────────────────────────────

interface TeslaRegionData {
  region: string;
  fleet_api_base_url: string;
}

export function useTeslaUserRegion() {
  return useQuery({
    queryKey: userKeys.teslaRegion,
    queryFn: ({ signal }) => request<TeslaConfigEnvelope<TeslaRegionData>>('/tesla/user/region', { signal }),
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useRefreshTeslaRegion() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaConfigEnvelope<TeslaRegionData>>('/tesla/user/region/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.teslaRegion });
      success('toast.user.region.success', 'Region refreshed');
    },
    onError: (err) => error(err, 'toast.user.region.error', 'Failed to refresh region'),
  });
}

// ─── Tesla User Orders ───────────────────────────────────────────────────────

export interface TeslaOrder {
  id: number;
  order_id: string;
  model: string;
  status: string;
  delivery_date: string | null;
  vin: string | null;
  referral_code?: string | null;
  is_upgradable: boolean;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

interface TeslaOrdersEnvelope {
  orders: TeslaOrder[];
  fetched_at: string | null;
}

export function useTeslaUserOrders() {
  return useQuery({
    queryKey: userKeys.teslaOrders,
    queryFn: ({ signal }) => request<TeslaOrdersEnvelope>('/tesla/user/orders', { signal }),
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshTeslaOrders() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaOrdersEnvelope>('/tesla/user/orders/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.teslaOrders });
      success('toast.user.orders.success', 'Orders refreshed');
    },
    onError: (err) => error(err, 'toast.user.orders.error', 'Failed to refresh orders'),
  });
}

// ─── Tesla User Profile ──────────────────────────────────────────────────────

export interface TeslaUserProfile {
  id: number;
  email: string;
  full_name: string;
  profile_image_url: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

interface TeslaProfileEnvelope {
  profile: TeslaUserProfile | null;
  fetched_at: string | null;
}

export function useTeslaUserProfile() {
  return useQuery({
    queryKey: userKeys.teslaProfile,
    queryFn: ({ signal }) => request<TeslaProfileEnvelope>('/tesla/user/profile', { signal }),
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshTeslaProfile() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaProfileEnvelope>('/tesla/user/profile/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.teslaProfile });
      success('toast.user.teslaProfile.success', 'Tesla profile refreshed');
    },
    onError: (err) => error(err, 'toast.user.teslaProfile.error', 'Failed to refresh Tesla profile'),
  });
}
