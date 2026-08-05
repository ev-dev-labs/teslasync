import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

export type BenchmarkMetricName =
  | 'degradation_pct'
  | 'efficiency_wh_per_km'
  | 'charging_reliability_pct'
  | 'operation_reliability_pct';

export type BenchmarkQuality = 'suppressed' | 'limited' | 'moderate' | 'strong';

export interface BenchmarkPrivacyStatus {
  vehicle_id: number;
  opted_in: boolean;
  opted_in_at: string | null;
  revoked_at: string | null;
  epsilon_budget: number;
  epsilon_spent: number;
  epsilon_remaining: number;
  minimum_cohort_size: number;
  mechanism_version: number;
}

export interface BenchmarkMetric {
  metric_name: BenchmarkMetricName;
  unit: 'pct' | 'wh_per_km';
  lower_bound: number;
  upper_bound: number;
  epsilon_spent: number;
  noisy_cohort_size: number | null;
  noisy_mean: number | null;
  noisy_p25: number | null;
  noisy_p75: number | null;
  noise_scale: number | null;
  suppressed: boolean;
  quality: BenchmarkQuality;
  target_value: number | null;
  /** Noise-adjusted performance percentile; 100 always means better. */
  percentile: number | null;
  higher_is_better: boolean;
}

export interface BenchmarkRelease {
  release_id: number;
  period_start: string;
  period_end: string;
  model_family: string;
  model_year_bucket: number;
  mechanism_version: number;
  minimum_cohort_size: number;
  epsilon_spent: number;
  suppressed: boolean;
  suppression_reason:
    | 'insufficient_cohort'
    | 'insufficient_metric_data'
    | 'privacy_budget_exhausted'
    | null;
  created_at: string;
  metrics: BenchmarkMetric[];
}

export interface BenchmarkReleasePage {
  items: BenchmarkRelease[];
  limit: number;
  offset: number;
}

export const benchmarkKeys = {
  all: ['privacy-benchmarks'] as const,
  status: (vehicleId: number | null) =>
    ['privacy-benchmarks', 'status', vehicleId] as const,
  releases: (vehicleId: number | null, limit: number, offset: number) =>
    ['privacy-benchmarks', 'releases', vehicleId, limit, offset] as const,
};

export function useBenchmarkPrivacyStatus(vehicleId: number | null) {
  return useQuery({
    queryKey: benchmarkKeys.status(vehicleId),
    queryFn: ({ signal }) =>
      request<BenchmarkPrivacyStatus>(
        `/benchmarks/privacy?vehicle_id=${encodeURIComponent(String(vehicleId))}`,
        { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

export function useBenchmarkReleases(
  vehicleId: number | null,
  limit = 12,
  offset = 0,
  enabled = true,
) {
  return useQuery({
    queryKey: benchmarkKeys.releases(vehicleId, limit, offset),
    queryFn: ({ signal }) =>
      request<BenchmarkReleasePage>(
        `/benchmarks/releases?vehicle_id=${encodeURIComponent(String(vehicleId))}`
          + `&limit=${limit}&offset=${offset}`,
        { signal },
      ),
    enabled: !!vehicleId && enabled,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

function invalidateBenchmarks(
  queryClient: ReturnType<typeof useQueryClient>,
  vehicleId: number,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: benchmarkKeys.status(vehicleId) }),
    queryClient.invalidateQueries({ queryKey: benchmarkKeys.all }),
  ]);
}

export function useOptInBenchmarks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: number) =>
      request<BenchmarkPrivacyStatus>('/benchmarks/privacy/consent', {
        method: 'PUT',
        body: JSON.stringify({ vehicle_id: vehicleId }),
      }),
    onSuccess: (status, vehicleId) => {
      queryClient.setQueryData(benchmarkKeys.status(vehicleId), status);
      return queryClient.invalidateQueries({ queryKey: benchmarkKeys.all });
    },
  });
}

export function useCreateBenchmarkRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ vehicle_id, period_end }: {
      vehicle_id: number;
      period_end?: string;
    }) =>
      request<BenchmarkRelease>('/benchmarks/releases', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id,
          ...(period_end ? { period_end } : {}),
        }),
      }),
    onSuccess: (_release, variables) =>
      invalidateBenchmarks(queryClient, variables.vehicle_id),
  });
}

export function useRevokeBenchmarks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vehicleId: number) =>
      request<void>(
        `/benchmarks/privacy/consent?vehicle_id=${encodeURIComponent(String(vehicleId))}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, vehicleId) => {
      queryClient.removeQueries({ queryKey: benchmarkKeys.all });
      return queryClient.invalidateQueries({ queryKey: benchmarkKeys.status(vehicleId) });
    },
  });
}
