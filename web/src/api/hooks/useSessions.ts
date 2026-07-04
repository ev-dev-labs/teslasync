/**
 * @module api/hooks/useSessions
 *
 * Active sessions and device-management hooks.
 *
 * Mirrors the layered fetch pattern used by useTOTP.ts: a single
 * useQuery for the list + two useMutation hooks that invalidate the
 * list key on success. The query tolerates the 501 AUTH_MODE_OPEN
 * response by surfacing it as a discriminated-union value
 * (`{ mode: 'open' }`) so the section can render a "feature requires
 * forward-auth" placeholder without throwing.
 *
 * Both DELETE routes are RequireSudo-gated upstream — the SPA's
 * request() interceptor will pop the reauth dialog before the
 * mutations actually fire. Once they succeed the cached sudo token
 * is intentionally NOT cleared so the user can chain a second action
 * (e.g. revoke another device) without re-authenticating.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError, request } from '../client'
import { useMutationToast } from './_toastHelpers'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import type { ActiveSession, ActiveSessionsResponse, RevokeAllOthersResponse } from '@/api/types'

export type { ActiveSession, ActiveSessionsResponse, RevokeAllOthersResponse }

export const sessionKeys = {
  list: ['sessions', 'list'] as const,
}

/**
 * Sentinel code mirrored from session_handler.AuthModeOpenCode. Treated
 * as a "feature unavailable" signal, NOT an error. The list hook
 * normalises to `{ mode: 'open' }` so consumers branch on the union
 * tag instead of inspecting error strings.
 */
const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN'

/**
 * Backend list payload before the SPA reshapes it. The handler always
 * sends `{ mode, sessions }`; we map the 501 path to `{ mode: 'open' }`
 * client-side because TanStack's queryFn must reject on a real network
 * error to drive `isError`, and we want the open-mode case to read as
 * a successful no-op instead.
 */
interface SessionListPayload {
  mode: 'session'
  sessions: ActiveSession[]
}

/**
 * Active sessions list query. Returns:
 *   • `{ mode: 'open' }` when the backend reports AUTH_MODE_OPEN.
 *   • `{ mode: 'session', sessions: [...] }` otherwise (possibly empty).
 *
 * Treats the 501 AUTH_MODE_OPEN response as a successful query so
 * useQuery's `isError` stays clean and the consumer can render
 * directly off `data`.
 */
export function useSessions(options?: { enabled?: boolean }) {
  return useQuery<ActiveSessionsResponse, ApiError>({
    queryKey: sessionKeys.list,
    queryFn: async ({ signal }) => {
      try {
        const payload = await request<SessionListPayload>('/auth/sessions', { signal })
        return { mode: 'session', sessions: payload?.sessions ?? [] }
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return { mode: 'open' }
        }
        throw err
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}

/**
 * Revoke a single session by id. RequireSudo-gated upstream. On
 * success the list query is invalidated so the row disappears; we
 * deliberately do NOT optimistically remove the row because the
 * step-up dialog may insert a several-second pause between mutate()
 * and the actual DELETE — disappearing the row before the request
 * goes out would leave the UI in a confusing intermediate state if
 * the user cancels reauth.
 *
 * Idempotent semantics: the backend returns 204 even when the row
 * is already revoked or missing, so a parallel revoke from another
 * tab does NOT leak an error toast here.
 */
export function useRevokeSession() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<void, ApiError, string>({
    mutationFn: (id: string) =>
      request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: sessionKeys.list })
      toast.success('settings.sessions.toasts.revoked', 'Session signed out.')
    },
    onError: (err) =>
      toast.error(err, 'settings.sessions.errors.revoke', 'Failed to sign out session'),
  })
}

/**
 * Revoke every other session for the current subject. RequireSudo-
 * gated upstream. Returns the count of revoked rows so the toast can
 * confirm how many devices were signed out.
 */
export function useRevokeAllOtherSessions() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<RevokeAllOthersResponse, ApiError, void>({
    mutationFn: () =>
      request<RevokeAllOthersResponse>('/auth/sessions/all-others', { method: 'DELETE' }),
    onSuccess: (result) => {
      invalidateAndBroadcast(qc, { queryKey: sessionKeys.list })
      const revoked = result?.revoked ?? 0
      toast.success(
        'settings.sessions.toasts.revokedAllOthers',
        `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}.`,
      )
    },
    onError: (err) =>
      toast.error(
        err,
        'settings.sessions.errors.revokeAllOthers',
        'Failed to sign out other sessions',
      ),
  })
}
