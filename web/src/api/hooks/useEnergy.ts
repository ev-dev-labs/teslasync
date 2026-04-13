import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type {
  EnergyStats,
  BatteryHealth,
  BatteryCellSummary,
  DegradationData,
  EnergyFlowData,
  VampireDrainStats,
  VampireDrainEvent,
  ProjectedRangeData,
  SleepEfficiencyData,
} from '@/types/energy';

export function useEnergyStats(vehicleId: string | null, days = 30) {
  return useQuery({
    queryKey: ['energy-stats', vehicleId, days],
    queryFn: () => request<EnergyStats>(`/vehicles/${vehicleId}/energy?days=${days}`),
    enabled: vehicleId !== null,
  });
}

export function useBatteryHealth(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-health', vehicleId],
    queryFn: () => request<BatteryHealth>(`/vehicles/${vehicleId}/battery`),
    enabled: vehicleId !== null,
  });
}

export function useBatteryCells(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-cells', vehicleId],
    queryFn: () => request<BatteryCellSummary>(`/vehicles/${vehicleId}/battery/cells`),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: Infinity,
  });
}

export function useBatteryDegradation(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-degradation', vehicleId],
    queryFn: () => request<DegradationData>(`/analytics/battery-degradation?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

export function useEnergyFlow(vehicleId: string | null) {
  return useQuery({
    queryKey: ['energy-flow', vehicleId],
    queryFn: () => request<EnergyFlowData>(`/vehicles/${vehicleId}/energy/flow`),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
    retry: false,
    staleTime: Infinity,
  });
}

export function useVampireDrainStats(vehicleId: string | null) {
  return useQuery({
    queryKey: ['vampire-drain-stats', vehicleId],
    queryFn: () => request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

export function useVampireDrainEvents(vehicleId: string | null, limit = 50) {
  return useQuery({
    queryKey: ['vampire-drain-events', vehicleId, limit],
    queryFn: () => request<VampireDrainEvent[]>(`/vampire-drain?vehicle_id=${vehicleId}&limit=${limit}`),
    enabled: vehicleId !== null,
  });
}

export function useProjectedRange(vehicleId: string | null) {
  return useQuery({
    queryKey: ['projected-range', vehicleId],
    queryFn: () => request<ProjectedRangeData>(`/vehicles/${vehicleId}/battery/projected-range`),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: Infinity,
  });
}

export function useSleepEfficiency(vehicleId: string | null, days = 30) {
  return useQuery({
    queryKey: ['sleep-efficiency', vehicleId, days],
    queryFn: () => request<SleepEfficiencyData>(`/analytics/sleep?vehicle_id=${vehicleId}&days=${days}`),
    enabled: vehicleId !== null,
  });
}
