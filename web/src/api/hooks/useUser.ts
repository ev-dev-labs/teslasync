import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type { User } from '@/types/user';

export const userKeys = {
  me: ['users', 'me'] as const,
  teslaFeatureConfig: ['tesla-feature-config'] as const,
  teslaRegion: ['tesla-user-region'] as const,
};

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me,
    queryFn: () => request<User>('/users/me'),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { displayName: string }) =>
      request<User>('/users/me', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (data) => {
      queryClient.setQueryData(userKeys.me, data);
    },
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
    queryFn: () => request<TeslaConfigEnvelope>('/tesla/user/feature-config'),
    staleTime: 10 * 60_000,
  });
}

export function useRefreshTeslaFeatureConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<TeslaConfigEnvelope>('/tesla/user/feature-config/refresh', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.teslaFeatureConfig }),
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
    queryFn: () => request<TeslaConfigEnvelope<TeslaRegionData>>('/tesla/user/region'),
    staleTime: Infinity,
  });
}

export function useRefreshTeslaRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<TeslaConfigEnvelope<TeslaRegionData>>('/tesla/user/region/refresh', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.teslaRegion }),
  });
}
