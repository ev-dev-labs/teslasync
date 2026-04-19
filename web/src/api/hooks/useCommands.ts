import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

export interface CommandLogEntry {
  id: number;
  vehicle_id: number;
  command: string;
  params: string;
  status: string;
  error: string;
  created_at: string;
}

export const commandKeys = {
  history: (vehicleId: string | undefined) => ['command-history', vehicleId] as const,
  latest: (vehicleId: string | number | undefined) => ['command-latest', vehicleId] as const,
};

/** Fetch recent command log for a vehicle. */
export function useCommandHistory(vehicleId: string | undefined) {
  return useQuery({
    queryKey: commandKeys.history(vehicleId),
    queryFn: () =>
      request<CommandLogEntry[]>(`/vehicles/${vehicleId}/commands/history?limit=200`),
    enabled: !!vehicleId,
    staleTime: 10_000,
    select: (data) => data ?? [],
  });
}

/** Fetch latest command per command-name for a vehicle. */
export function useCommandLatest(vehicleId: string | undefined) {
  return useQuery({
    queryKey: commandKeys.latest(vehicleId),
    queryFn: () =>
      request<CommandLogEntry[]>(`/vehicles/${vehicleId}/commands/latest`),
    enabled: !!vehicleId,
    staleTime: 15_000,
    select: (data) => data ?? [],
  });
}
