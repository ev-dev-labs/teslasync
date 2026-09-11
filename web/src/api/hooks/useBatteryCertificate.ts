import { useQuery, useMutation } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Server-signed battery certificate — a buyer-verifiable resale attestation.
 * These hooks read the two backend routes registered in
 * internal/api/router.go:
 *
 *   GET  /analytics/battery-health/certificate?vehicle_id= (authenticated)
 *   POST /public/battery-certificate/verify (public — signature IS the auth)
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags.
 */

/** The signed certificate payload (compact buyer-facing health snapshot). */
export interface BatteryCertificate {
  issuer: string;
  version: number;
  vehicle_id: number;
  /** RFC 3339 issue instant. */
  issued_at: string;
  /** RFC 3339 expiry instant (30 days after issue). */
  expires_at: string;
  current_soh: number;
  estimated_capacity_kwh: number;
  original_capacity_kwh: number;
  degradation_rate_pct_per_year: number;
  battery_age_months: number;
  total_cycles: number;
  charge_habits_score: number;
  stress_level: string;
  fast_charge_pct: number;
  temp_exposure_score: number | null;
  temp_exposure_reason: string | null;
}

/** Issue result: the certificate plus its lowercase hex HMAC signature. */
export interface BatteryCertificateIssueResponse {
  certificate: BatteryCertificate;
  signature: string;
}

/** Verify result: echoes the certificate only when the signature is valid. */
export interface BatteryCertificateVerifyResponse {
  valid: boolean;
  certificate?: BatteryCertificate;
}

/** Issue (fetch) the current server-signed battery certificate. */
export function useBatteryCertificate(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-certificate', vehicleId],
    queryFn: ({ signal }) =>
      request<BatteryCertificateIssueResponse>(
        `/analytics/battery-health/certificate?vehicle_id=${encodeURIComponent(vehicleId ?? '')}`,
        { signal },
      ),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

/** Verify a seller-supplied certificate + signature (public endpoint). */
export function useVerifyBatteryCertificate() {
  return useMutation({
    mutationFn: (params: { certificate: BatteryCertificate; signature: string }) =>
      request<BatteryCertificateVerifyResponse>('/public/battery-certificate/verify', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });
}
