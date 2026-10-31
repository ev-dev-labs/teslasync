import { useEffect, useState } from 'react';
import { MAX_TELEMETRY_CLOCK_SKEW_MS, TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';

/** Expire presentation activity at the observation boundary, not the next poll. */
export function useObservationCurrent(observedAt: number | string | null | undefined, enabled = true): boolean {
  const [, setVersion] = useState(0);
  const timestamp = typeof observedAt === 'string' ? Date.parse(observedAt) : observedAt;
  const now = Date.now();
  const current = enabled && timestamp != null && Number.isFinite(timestamp) &&
    timestamp > 0 && timestamp <= now + MAX_TELEMETRY_CLOCK_SKEW_MS &&
    now - timestamp <= TELEMETRY_STALE_AFTER_MS;

  useEffect(() => {
    if (!current || timestamp == null) return;
    const timer = window.setTimeout(
      () => setVersion(version => version + 1),
      Math.max(1, timestamp + TELEMETRY_STALE_AFTER_MS - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [timestamp, current]);

  return current;
}
