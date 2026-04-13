import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { SignalHistoryResponse, SignalStats, TelemetryStatus } from '@/types/telemetry';

export const telemetryKeys = {
  signals: ['signals'] as const,
  signalStats: (vehicleId: number) => ['signal-stats', vehicleId] as const,
  signalHistory: (signal: string, hours: number) => ['signal-history', signal, hours] as const,
  signalLog: (signal: string, hours: number, page: number) => ['signal-log', signal, hours, page] as const,
  signalDiff: (signal: string, from: string, to: string) => ['signal-diff', signal, from, to] as const,
  signalGaps: ['signal-gaps'] as const,
  mqttStatus: ['mqtt-status'] as const,
};

export function useSignals() {
  return useQuery({
    queryKey: telemetryKeys.signals,
    queryFn: () => request<string[]>('/signals/available'),
    staleTime: 60_000,
  });
}

export function useSignalStats(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signalStats(vehicleId),
    queryFn: () => request<SignalStats>(`/signals/stats?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
  });
}

export function useSignalHistory(signal: string, hours: number) {
  return useQuery({
    queryKey: telemetryKeys.signalHistory(signal, hours),
    queryFn: () => request<SignalHistoryResponse>(`/signals/history?signal=${signal}&hours=${hours}`),
    enabled: !!signal,
    refetchInterval: 30_000,
  });
}

export function useSignalLog(signal: string, hours: number, page: number, pageSize: number) {
  return useQuery({
    queryKey: telemetryKeys.signalLog(signal, hours, page),
    queryFn: () =>
      request<SignalHistoryResponse>(
        `/signals/history?signal=${signal}&hours=${hours}&page=${page}&page_size=${pageSize}`
      ),
    enabled: !!signal,
  });
}

export function useSignalDiff(signal: string, from: string, to: string) {
  return useQuery({
    queryKey: telemetryKeys.signalDiff(signal, from, to),
    queryFn: () =>
      request<SignalHistoryResponse>(`/signals/history?signal=${signal}&from=${from}&to=${to}`),
    enabled: !!signal && !!from && !!to,
  });
}

export function useSignalGaps() {
  return useQuery({
    queryKey: telemetryKeys.signalGaps,
    queryFn: () => request<Record<string, { value: unknown; timestamp: string }>>('/signals/live'),
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
