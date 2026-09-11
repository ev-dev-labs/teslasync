import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';

/**
 * OCPP charge points + sessions recorded by cmd/ocpp-server. Reads the two
 * backend routes registered in internal/api/router.go:
 *
 *   GET /ocpp/charge-points
 *   GET /ocpp/sessions?charge_point_id=&limit=
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags.
 */

export interface OcppConnectorStatus {
  connector_id: number;
  status: string;
  error_code: string;
  info: string;
  updated_at: string;
}

export interface OcppChargePoint {
  id: string;
  vendor: string;
  model: string;
  serial_number: string;
  firmware_version: string;
  last_boot_at: string | null;
  last_seen_at: string;
  connectors: OcppConnectorStatus[];
  active_sessions: number;
}

export interface OcppSession {
  transaction_id: number;
  charge_point_id: string;
  connector_id: number;
  started_at: string;
  start_meter_wh: number;
  ended_at: string | null;
  end_meter_wh: number | null;
  stop_reason: string;
  energy_delivered_wh: number | null;
}

export const ocppKeys = {
  all: ['ocpp'] as const,
  chargePoints: ['ocpp', 'charge-points'] as const,
  sessions: (chargePointId: string, limit: number) => ['ocpp', 'sessions', chargePointId, limit] as const,
};

/** Lists every known OCPP charger with live connector statuses. */
export function useOcppChargePoints() {
  return useQuery({
    queryKey: ocppKeys.chargePoints,
    queryFn: ({ signal }) => request<OcppChargePoint[]>('/ocpp/charge-points', { signal }),
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

/** Lists recent OCPP charging transactions, optionally per charger. */
export function useOcppSessions(chargePointId = '', limit = 20) {
  return useQuery({
    queryKey: ocppKeys.sessions(chargePointId, limit),
    queryFn: ({ signal }) =>
      request<OcppSession[]>(
        `/ocpp/sessions?charge_point_id=${encodeURIComponent(chargePointId)}&limit=${limit}`,
        { signal },
      ),
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}
