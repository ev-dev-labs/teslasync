import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { SignalHistoryResponse, SignalStats, TelemetryStatus } from '@/types/telemetry';

export const telemetryKeys = {
  signals: (vehicleId: number) => ['signals', vehicleId] as const,
  signalStats: (vehicleId: number) => ['signal-stats', vehicleId] as const,
  signalHistory: (vehicleId: number, signal: string, hours: number) => ['signal-history', vehicleId, signal, hours] as const,
  signalLog: (vehicleId: number, signal: string, hours: number, page: number) => ['signal-log', vehicleId, signal, hours, page] as const,
  signalDiff: (vehicleId: number, signal: string, from: string, to: string) => ['signal-diff', vehicleId, signal, from, to] as const,
  signalGaps: (vehicleId: number) => ['signal-gaps', vehicleId] as const,
  mqttStatus: ['mqtt-status'] as const,
};

export function useSignals(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signals(vehicleId),
    queryFn: async () => {
      const resp = await request<{ signals?: string[] } | string[]>(`/signals/${vehicleId}/available`);
      // API wraps signals in { signals: [...] } but old code expected string[]
      if (Array.isArray(resp)) return resp;
      return (resp as { signals?: string[] }).signals ?? [];
    },
    enabled: vehicleId > 0,
    staleTime: 60_000,
    select: safeArray,
  });
}

export function useSignalStats(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalStats(vehicleId),
    queryFn: () => request<SignalStats>(`/signals/${vehicleId}/stats`),
    enabled: vehicleId > 0,
  });
}

export function useSignalHistory(vehicleId: number, signal: string, hours: number) {
  return useQuery({
    queryKey: telemetryKeys.signalHistory(vehicleId, signal, hours),
    queryFn: () => request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?hours=${hours}`),
    enabled: vehicleId > 0 && !!signal,
    refetchInterval: 30_000,
  });
}

export function useSignalLog(vehicleId: number, signal: string, hours: number, page: number, pageSize: number) {
  return useQuery({
    queryKey: telemetryKeys.signalLog(vehicleId, signal, hours, page),
    queryFn: () =>
      request<SignalHistoryResponse>(
        `/signals/${vehicleId}/${signal}/history?hours=${hours}&page=${page}&page_size=${pageSize}`
      ),
    enabled: vehicleId > 0 && !!signal,
  });
}

export function useSignalDiff(vehicleId: number, signal: string, from: string, to: string) {
  return useQuery({
    queryKey: telemetryKeys.signalDiff(vehicleId, signal, from, to),
    queryFn: () =>
      request<SignalHistoryResponse>(`/signals/${vehicleId}/${signal}/history?from=${from}&to=${to}`),
    enabled: vehicleId > 0 && !!signal && !!from && !!to,
  });
}

export function useSignalGaps(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalGaps(vehicleId),
    queryFn: async () => {
      const res = await request<{ signals?: Record<string, { value: unknown; timestamp: string }> }>(`/signals/${vehicleId}/live`);
      return res.signals ?? {};
    },
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  });
}

export function useMQTTStatus() {
  return useQuery({
    queryKey: telemetryKeys.mqttStatus,
    queryFn: () => request<TelemetryStatus>('/telemetry'),
    refetchInterval: 5_000,
  });
}
