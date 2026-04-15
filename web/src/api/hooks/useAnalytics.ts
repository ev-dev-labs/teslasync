import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { AnalyticsSummary, MileageStats, CostBreakdown, TimelineEvent, StateSummary, WeeklyDigestData, MonthlyStat } from '@/types/analytics';
import type { FleetAnalytics } from '@/api/types';

export const analyticsKeys = {
  summary: (days: number) => ['analytics', 'summary', days] as const,
  fleet: (days: number, start?: string) => ['analytics', 'fleet', days, start] as const,
  mileage: (vehicleId: string) => ['analytics', 'mileage', vehicleId] as const,
  monthlyMileage: (vehicleId: string) => ['analytics', 'monthly-mileage', vehicleId] as const,
  cost: (vehicleId: string) => ['analytics', 'cost', vehicleId] as const,
  timeline: (vehicleId: string) => ['analytics', 'timeline', vehicleId] as const,
  stateSummary: (vehicleId: string) => ['analytics', 'state-summary', vehicleId] as const,
  weeklyDigest: (vehicleId: string) => ['analytics', 'weekly-digest', vehicleId] as const,
};

export function useAnalyticsSummary(days = 30) {
  return useQuery({
    queryKey: analyticsKeys.summary(days),
    queryFn: () => request<AnalyticsSummary>(`/analytics/fleet?days=${days}`),
  });
}

/** Full fleet analytics with drive/charging/battery deep analytics. */
export function useFleetAnalytics(days = 30, start?: string) {
  const qs = start ? `start=${start}` : `days=${days}`;
  return useQuery({
    queryKey: analyticsKeys.fleet(days, start),
    queryFn: () => request<FleetAnalytics>(`/analytics/fleet?${qs}`),
  });
}

export function useMileageStats(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.mileage(vehicleId),
    queryFn: () => request<MileageStats>(`/mileage/stats?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
  });
}

export function useMonthlyMileage(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.monthlyMileage(vehicleId),
    queryFn: () => request<MonthlyStat[]>(`/mileage/monthly?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useCostBreakdown(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.cost(vehicleId),
    queryFn: () => request<CostBreakdown>(`/analytics/tco?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
  });
}

export function useTimeline(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.timeline(vehicleId),
    queryFn: () => request<{ transitions: TimelineEvent[] }>(`/vehicle-states/timeline?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: (data) => safeArray(data?.transitions),
  });
}

export function useStateSummary(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.stateSummary(vehicleId),
    queryFn: () => request<StateSummary[]>(`/vehicle-states/summary?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useWeeklyDigest(vehicleId: string) {
  return useQuery({
    queryKey: analyticsKeys.weeklyDigest(vehicleId),
    queryFn: () => request<WeeklyDigestData>(`/vehicles/${vehicleId}/weekly-digest`),
    enabled: !!vehicleId,
    retry: false,
    staleTime: Infinity,
  });
}
