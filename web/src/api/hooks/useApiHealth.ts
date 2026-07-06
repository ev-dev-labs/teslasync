import { useMemo } from 'react';
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
 *   - `degraded` — 2xx response ≥ 500 ms (server is slow but up)
 *   - `offline`  — non-2xx, network error, or no response within 5 s
 *   - `unknown`  — query has not yet completed at least once
 *
 * A probe that is cancelled by the caller (component unmount, query-key
 * change, StrictMode double-invoke) is deliberately NOT reported as
 * `offline` — that abort is propagated so react-query keeps the last good
 * reading instead of flashing a healthy API as down.
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

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
}

/** 2xx responses at or above this round-trip are surfaced as `degraded`. */
export const DEGRADED_LATENCY_MS = 500;
/** Abort the probe and report `offline` if there is no response within this window. */
export const PROBE_TIMEOUT_MS = 5_000;
/** Foreground poll cadence for the footer health indicator. */
export const POLL_INTERVAL_MS = 15_000;
const STALE_TIME_MS = 10_000;

export async function probe(externalSignal?: AbortSignal): Promise<ProbeResult> {
  const url = `${getApiBase()}/healthz`;
  const controller = new AbortController();
  // Distinguishes "our 5s deadline fired" (a real outage → offline) from
  // "the caller cancelled us" (query unmounted / key changed → propagate).
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PROBE_TIMEOUT_MS);
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
  } catch (err) {
    // A caller-initiated cancellation must NOT masquerade as an outage:
    // re-throw so react-query treats it as a cancellation and keeps the
    // last good reading. A timeout (timedOut) or a genuine network error
    // still falls through to the offline result below.
    if (externalSignal?.aborted && !timedOut) {
      throw err;
    }
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, latencyMs, checkedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export function bucket(result: ProbeResult): ApiHealthStatus {
  if (!result.ok) return 'offline';
  if (result.latencyMs >= DEGRADED_LATENCY_MS) return 'degraded';
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

  // Memoise on `data` so consumers get a referentially stable object
  // between renders (react-query returns a stable `data` ref while the
  // value is unchanged), avoiding needless re-renders of the footer.
  return useMemo<ApiHealthState>(() => {
    if (!data) {
      return { status: 'unknown', latencyMs: null, lastCheckedAt: null };
    }
    return {
      status: bucket(data),
      latencyMs: data.latencyMs,
      lastCheckedAt: data.checkedAt,
    };
  }, [data]);
}
