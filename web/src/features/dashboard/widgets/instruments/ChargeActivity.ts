import { useEffect, useReducer } from 'react';
import type { DataStateSource } from '@/api/dataState';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';

interface ChargeStateEvidence {
  live?: boolean;
  freshness?: string;
  observedAt?: number | null;
  verifiedFields?: readonly string[];
  state?: { is_charging?: boolean | null } | null;
}

interface ChargeTelemetryEvidence {
  charging_state?: string | null;
  ts?: string | null;
  bms_fullcharge_complete?: boolean | null;
}

function freshObservation(observedAt: number | null | undefined, now: number): boolean {
  return observedAt != null && Number.isFinite(observedAt)
    && observedAt <= now && now - observedAt < TELEMETRY_STALE_AFTER_MS;
}

function healthySource(source: DataStateSource<unknown>): boolean {
  return !source.isError && source.error == null
    && !source.isLoading && !source.isPending && source.fetchStatus !== 'paused';
}

/** Successful polling alone is not evidence that the underlying charging signal is current. */
export function verifiedChargeActivity(
  source: DataStateSource<ChargeStateEvidence>,
  now = Date.now(),
): boolean {
  const evidence = source.data;
  return healthySource(source) && evidence?.live === true
    && evidence.freshness === 'fresh'
    && evidence.state?.is_charging === true
    && evidence.verifiedFields?.includes('is_charging') === true
    && freshObservation(evidence.observedAt, now);
}

export function verifiedTelemetryChargeActivity(
  source: DataStateSource<ChargeTelemetryEvidence | null>,
  now = Date.now(),
): boolean {
  const data = source.data;
  const observedAt = typeof data?.ts === 'string' ? Date.parse(data.ts) : null;
  return healthySource(source) && data?.charging_state === 'Charging' && data.bms_fullcharge_complete !== true
    && freshObservation(observedAt, now);
}

function useObservationExpiry(observedAt: number | null | undefined, active: boolean): void {
  const [, expire] = useReducer((version: number) => version + 1, 0);
  useEffect(() => {
    if (!active || observedAt == null) return;
    const remaining = observedAt + TELEMETRY_STALE_AFTER_MS - Date.now();
    // A single trust-expiry notification stops motion even if polling falls silent.
    const timer = setTimeout(expire, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [observedAt, active]);
}

export function useVerifiedChargeActivity(source: DataStateSource<ChargeStateEvidence>): boolean {
  const active = verifiedChargeActivity(source);
  useObservationExpiry(source.data?.observedAt, active);
  return active;
}

export function useTelemetryChargeActivity(
  source: DataStateSource<ChargeTelemetryEvidence | null>,
  enabled = true,
): boolean {
  const active = enabled && verifiedTelemetryChargeActivity(source);
  const observedAt = typeof source.data?.ts === 'string' ? Date.parse(source.data.ts) : null;
  useObservationExpiry(observedAt, active);
  return active;
}
