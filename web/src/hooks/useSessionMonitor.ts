/**
 * @module hooks/useSessionMonitor
 *
 * Phase-46 / Prompt 05 — ForwardAuth session monitor.
 *
 * Polls `/auth/session` on a slow cadence (5 minutes, plus on window
 * focus) so the SPA can surface the {@link SessionExpiringModal}
 * countdown ~60s before the upstream cookie expires and the
 * {@link SessionExpiredModal} hard-block once it has expired.
 *
 * The endpoint is mounted OUTSIDE the /api/v1 ForwardAuth subrouter
 * and ALWAYS returns 200 OK — see internal/api/auth_session_handler.go.
 * Polling it cannot itself trip the hard-401 detection path; if it did
 * the hook would dispatch its own teslasync:session-expired event and
 * end up in an infinite redirect loop.
 *
 * The hook returns derived state computed against the LIVE clock (a
 * 1Hz tick) so banners feel responsive without being driven by a
 * separate poll. `isExpiringSoon` flips true at expires_in < 60s;
 * `hasExpired` at expires_in <= 0 OR `authenticated === false`.
 *
 * **Open mode**: when the API reports `mode === 'open'` (deployment
 * has no FORWARD_AUTH_HEADER) the hook reports `mode: 'open'` and
 * `isExpiringSoon: false` / `hasExpired: false` regardless of any
 * other state. Both modal components must check `mode` and render
 * nothing in this branch.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import type { SessionInfo } from '@/api/types'

const SESSION_POLL_MS = 5 * 60 * 1000
const SESSION_STALE_MS = 4 * 60 * 1000
/** Polling cadence while expiry is < NEAR_EXPIRY_THRESHOLD_S away. */
const SESSION_POLL_NEAR_EXPIRY_MS = 30 * 1000
/**
 * When the server-reported `expires_in` is under this many seconds the
 * hook tightens polling so the SessionExpiringModal countdown stays in
 * sync with the upstream cookie's actual lifetime. The default 5-min
 * poll would otherwise leave a stale `expires_in` snapshot driving the
 * UI for up to 4m59s after the proxy renewed (or invalidated) the
 * cookie.
 */
const NEAR_EXPIRY_THRESHOLD_S = 5 * 60
/** Window (in seconds) before expiry that the SessionExpiringModal opens. */
export const SESSION_EXPIRING_THRESHOLD_S = 60

export const sessionMonitorKey = ['auth', 'session'] as const

export interface SessionMonitorState {
  /** Raw response from /auth/session; null while pending or after a hard error. */
  data: SessionInfo | null
  /**
   * Resolved deployment mode. 'open' means there is no auth provider —
   * caller MUST treat this as "session timeout doesn't apply".
   */
  mode: 'open' | 'session' | 'unknown'
  /** Seconds until expiry against the live clock; null when unavailable. */
  expiresInSeconds: number | null
  /** True when expiresInSeconds < SESSION_EXPIRING_THRESHOLD_S and > 0. */
  isExpiringSoon: boolean
  /** True when expires_at has passed OR the API reports authenticated=false. */
  hasExpired: boolean
  /** True when the upstream proxy reports the session is renewable. */
  renewable: boolean
  /** True while the initial poll is in flight. */
  isLoading: boolean
  /** Triggers an immediate refetch — bound to the modal's "Stay signed in" CTA. */
  refresh: () => Promise<void>
}

/**
 * Computes the derived state from a SessionInfo snapshot and `nowMs`.
 * Exported so tests can exercise it directly without spinning up a
 * QueryClient.
 */
export function deriveSessionState(
  data: SessionInfo | null,
  nowMs: number,
): Pick<SessionMonitorState, 'mode' | 'expiresInSeconds' | 'isExpiringSoon' | 'hasExpired' | 'renewable'> {
  if (!data) {
    return {
      mode: 'unknown',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: false,
      renewable: false,
    }
  }

  if (data.mode === 'open') {
    return {
      mode: 'open',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: false,
      renewable: false,
    }
  }

  if (!data.authenticated) {
    return {
      mode: 'session',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: true,
      renewable: false,
    }
  }

  // Compute remaining seconds against the LIVE clock from the server's
  // RFC3339 expires_at — clock-skew-safe relative to a static
  // expires_in snapshot from N minutes ago.
  let expiresInSeconds: number | null = null
  if (typeof data.expires_at === 'string' && data.expires_at) {
    const t = Date.parse(data.expires_at)
    if (Number.isFinite(t)) {
      expiresInSeconds = Math.floor((t - nowMs) / 1000)
    }
  }

  // Fallback to the server-computed snapshot when expires_at is missing
  // or unparseable. Note: this is static — it doesn't tick down on its
  // own — but the parent hook re-renders every second so the consuming
  // modal's countdown still animates in either branch.
  if (expiresInSeconds === null && typeof data.expires_in === 'number') {
    expiresInSeconds = data.expires_in
  }

  if (expiresInSeconds === null) {
    return {
      mode: 'session',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: false,
      renewable: data.renewable,
    }
  }

  return {
    mode: 'session',
    expiresInSeconds,
    isExpiringSoon: expiresInSeconds > 0 && expiresInSeconds < SESSION_EXPIRING_THRESHOLD_S,
    hasExpired: expiresInSeconds <= 0,
    renewable: data.renewable,
  }
}

/**
 * Polls /auth/session and surfaces the derived state used by the
 * Session{Expiring,Expired}Modal components in <Layout>.
 */
export function useSessionMonitor(): SessionMonitorState {
  const query = useQuery<SessionInfo>({
    queryKey: sessionMonitorKey,
    queryFn: ({ signal }) => request<SessionInfo>('/auth/session', { signal }),
    // Tighten the poll when expiry is near so the modal countdown
    // tracks the upstream cookie within ~30s instead of up to 5min.
    // TanStack Query v5 accepts a functional form here; the query
    // shape is the same as the queryFn's return.
    refetchInterval: (q) => {
      const data = q.state.data
      if (!data || data.mode !== 'session' || !data.authenticated) {
        return SESSION_POLL_MS
      }
      const remaining =
        typeof data.expires_in === 'number' ? data.expires_in : Number.POSITIVE_INFINITY
      return remaining < NEAR_EXPIRY_THRESHOLD_S ? SESSION_POLL_NEAR_EXPIRY_MS : SESSION_POLL_MS
    },
    refetchOnWindowFocus: true,
    staleTime: SESSION_STALE_MS,
    // The endpoint never 401s, so a failed retry indicates a deeper
    // network problem; one quick retry is enough.
    retry: 1,
  })

  // Tick the local clock once per second so countdown banners animate
  // smoothly between server polls. The interval only runs while a
  // session-mode response is mounted — open mode + the "no data yet"
  // branch don't need it.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (query.data?.mode !== 'session') return
    if (!query.data.authenticated) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [query.data?.mode, query.data?.authenticated])

  const derived = deriveSessionState(query.data ?? null, now)

  const refresh = async () => {
    await query.refetch()
  }

  return {
    data: query.data ?? null,
    mode: derived.mode,
    expiresInSeconds: derived.expiresInSeconds,
    isExpiringSoon: derived.isExpiringSoon,
    hasExpired: derived.hasExpired,
    renewable: derived.renewable,
    isLoading: query.isPending,
    refresh,
  }
}
