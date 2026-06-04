import { useQuery } from '@tanstack/react-query';
import { getApiBase } from '@/api/client';

/**
 * Polls the backend `/healthz` endpoint every 15 seconds and reports the
 * round-trip latency plus an `ok | degraded | offline | unknown` summary
 * suitable for the footer status bar's API segment.
 *
 * `/healthz` lives at the *root* of the API server (NOT under `/api/v1`)
 * so we issue a direct `fetch()` instead of going through the resilient
 * `request()` client — that client auto-prefixes `/api/v1` and would
 * otherwise hit a 404.
 *
 * Tiers (chosen so the indicator turns yellow before something is truly
 * broken):
 *   - `ok`       — 2xx response in < 500 ms
 *   - `degraded` — 2xx response in 500–1999 ms (server is slow but up)
 *   - `offline`  — non-2xx, network error, or no response within 5 s
 *   - `unknown`  — query has not yet completed at least once
 */

export type ApiHealthStatus = 'ok' | 'degraded' | 'offline' | 'unknown';

export interface ApiHealthState {
  /** Coarse-grained health bucket (see file comment). */
  status: ApiHealthStatus;
  /** Most recent measured round-trip in milliseconds, or `null` if never measured. */
  latencyMs: number | null;
  /** ISO timestamp of the last completed probe (success or failure), or `null`. */
  lastCheckedAt: string | null;
}

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
}

const PROBE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 15_000;
const STALE_TIME_MS = 10_000;

async function probe(externalSignal?: AbortSignal): Promise<ProbeResult> {
  const url = `${getApiBase()}/healthz`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  // Forward an upstream cancel (e.g. component unmount) into our internal controller.
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // Prevent the browser from serving a cached response that would
      // hide an actual outage.
      cache: 'no-store',
      credentials: 'include',
    });
    const latencyMs = Math.round(performance.now() - start);
    return { ok: res.ok, latencyMs, checkedAt: new Date().toISOString() };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, latencyMs, checkedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function bucket(result: ProbeResult): ApiHealthStatus {
  if (!result.ok) return 'offline';
  if (result.latencyMs >= 500) return 'degraded';
  return 'ok';
}

export function useApiHealth(): ApiHealthState {
  const { data } = useQuery({
    queryKey: ['api-health'],
    queryFn: ({ signal }) => probe(signal),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  if (!data) {
    return { status: 'unknown', latencyMs: null, lastCheckedAt: null };
  }
  return {
    status: bucket(data),
    latencyMs: data.latencyMs,
    lastCheckedAt: data.checkedAt,
  };
}
