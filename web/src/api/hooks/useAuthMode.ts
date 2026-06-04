/**
 * @module api/hooks/useAuthMode
 *
 * Auth-mode contract.
 *
 * Single source of truth for "what authentication mode is this
 * deployment running in, and who is the current request's principal".
 * Every auth-coupled feature (TOTP enrollment, session list,
 * impersonation, RBAC matrix, step-up reauth, …) gates its UI on the
 * capability flags returned here, so that:
 *
 *   1. In open mode (no FORWARD_AUTH_HEADER configured), every
 *      affected section renders the inline <RequiresAuth>
 *      placeholder instead of issuing a doomed request that 501s.
 *   2. In forward-auth mode, sections mount as normal — the
 *      capability bools default to `true`, but each feature still
 *      enforces its own per-request preconditions server-side.
 *
 * The endpoint is cheap (no DB / no Redis) and rarely changes — it
 * is fixed at deployment time. We therefore use a long staleTime
 * and DO NOT poll on an interval; refetch happens implicitly on
 * window focus / mount of consumers that have been suspended for
 * `staleTime`. This is intentional — auth-mode bouncing under the
 * SPA's feet would tear down half the chrome.
 */
import { useQuery } from '@tanstack/react-query'
import { ApiError, request } from '../client'
import type { AuthModeResponse } from '@/api/types'

export type { AuthModeResponse }

/**
 * Stable query-key registry for the auth-mode endpoint. Exported so
 * other hooks (notably the post-impersonation cache flush in
 * useImpersonation) can invalidate it without re-deriving the key.
 */
export const authModeKeys = {
  all: ['auth', 'mode'] as const,
}

/**
 * Default staleTime for the contract endpoint — 5 minutes. Long
 * enough that consumer mount/unmount churn doesn't translate into a
 * thundering herd of refetches; short enough that an operator
 * reconfiguring the deployment from open mode → forward_auth sees
 * the SPA pick it up within a single coffee break (and instantly
 * if they hit the browser's hard reload).
 */
export const AUTH_MODE_STALE_MS = 5 * 60_000

/**
 * Status query. Always succeeds (the contract endpoint is designed
 * to never 4xx/5xx — see internal/api/system_auth_mode_handler.go).
 * Surfaces ApiError on transport-level failures so consumers can
 * render a generic offline state.
 */
export function useAuthMode() {
  return useQuery<AuthModeResponse, ApiError>({
    queryKey: authModeKeys.all,
    queryFn: ({ signal }) => request<AuthModeResponse>('/system/auth-mode', { signal }),
    staleTime: AUTH_MODE_STALE_MS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  })
}

/**
 * Convenience boolean. Returns `true` ONLY when the contract has
 * resolved to `mode === 'forward_auth'`. While the query is loading
 * (or has errored) the value is `false` so consumers default to the
 * safe "no auth" rendering — features wrapped in <RequiresAuth>
 * therefore briefly show their placeholder rather than briefly
 * showing their content and then yanking it away.
 */
export function useIsForwardAuth(): boolean {
  const { data } = useAuthMode()
  return data?.mode === 'forward_auth'
}

/**
 * Returns the current request's resolved subject string, or `null`
 * when:
 *
 *   - we are in open mode,
 *   - the upstream proxy stripped the header on this specific
 *     request,
 *   - or the auth-mode contract has not resolved yet.
 *
 * Consumers that need the loading state separately should use
 * `useAuthMode()` directly and inspect `isLoading`.
 */
export function useAuthSubject(): string | null {
  const { data } = useAuthMode()
  if (!data) return null
  if (data.mode !== 'forward_auth') return null
  return data.subject ?? null
}
