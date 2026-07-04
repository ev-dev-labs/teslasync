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

/* ── Window bounds ────────────────────────────────────────── */

/**
 * Detection-window bounds enforced by the backend handler
 * (`GET /analytics/anomalies` clamps `days` to `[1, 30]` and falls back to
 * 7 for anything outside that range). Mirrored here so the request URL AND
 * the query key agree with the window the server actually uses — otherwise
 * an out-of-range `days` caches a 7-day answer under, say, a `100` key.
 */
export const ANOMALY_MIN_DAYS = 1;
export const ANOMALY_MAX_DAYS = 30;
export const ANOMALY_DEFAULT_DAYS = 7;

/**
 * Normalises a requested window into the backend-accepted `[1, 30]` range.
 * Non-finite or non-positive input falls back to {@link ANOMALY_DEFAULT_DAYS};
 * fractional values are truncated toward zero before clamping.
 */
export function clampAnomalyDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return ANOMALY_DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(days), ANOMALY_MIN_DAYS), ANOMALY_MAX_DAYS);
}

/* ── Hook ─────────────────────────────────────────────────── */

export function useAnomalies(vehicleId: string | null, days = ANOMALY_DEFAULT_DAYS) {
  const windowDays = clampAnomalyDays(days);
  // Trim so a whitespace-only id is treated as "no vehicle" instead of
  // firing a request the backend rejects with 400 "vehicle_id is required".
  const id = vehicleId?.trim() ?? '';
  const enabled = id !== '';

  return useQuery({
    queryKey: ['anomalies', vehicleId, windowDays],
    queryFn: ({ signal }) =>
      request<AnomalyData>(
        `/analytics/anomalies?vehicle_id=${encodeURIComponent(id)}&days=${windowDays}`,
        { signal },
      ),
    enabled,
    staleTime: STALE_TIMES.SLOW,
  });
}
