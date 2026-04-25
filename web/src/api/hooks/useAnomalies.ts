import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/* ── Types ────────────────────────────────────────────────── */

export interface AnomalyData {
  anomalies: AnomalyEntry[];
  health_summary: Record<string, string>;
  signals_monitored: number;
  anomalies_last_7d: number;
  anomalies_last_24h: number;
}

export interface AnomalyEntry {
  signal: string;
  type: 'z_score' | 'range' | 'trend';
  severity: 'critical' | 'warning' | 'info';
  value: number;
  baseline: number;
  z_score: number;
  detected_at: string;
  message: string;
}

/* ── Hook ─────────────────────────────────────────────────── */

export function useAnomalies(vehicleId: string | null, days = 7) {
  return useQuery({
    queryKey: ['anomalies', vehicleId, days],
    queryFn: () => request<AnomalyData>(`/analytics/anomalies?vehicle_id=${vehicleId}&days=${days}`),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  });
}
