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
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import type { ActiveSession, ActiveSessionsResponse, RevokeAllOthersResponse } from '@/api/types'

export type { ActiveSession, ActiveSessionsResponse, RevokeAllOthersResponse }

export type RevokeAllOthersResult = Omit<RevokeAllOthersResponse, 'revoked'> & {
  revoked: number | null
}

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
 * Validate wire data before accepting an explicit empty list. Malformed
 * list responses reject so TanStack retains previously validated data.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isActiveSession(value: unknown): value is ActiveSession {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.user_agent === 'string'
    && typeof value.ip === 'string'
    && typeof value.created_at === 'string'
    && typeof value.last_seen_at === 'string'
    && (value.revoked_at === undefined || typeof value.revoked_at === 'string')
    && typeof value.current === 'boolean'
}

function readSessionList(payload: unknown): ActiveSessionsResponse {
  if (isRecord(payload)) {
    if (payload.mode === 'open') return { mode: 'open' }
    if (payload.mode === 'session'
      && Array.isArray(payload.sessions)
      && payload.sessions.every(isActiveSession)) {
      return { mode: 'session', sessions: payload.sessions }
    }
  }
  throw new ApiError('Invalid active sessions response', 502, 'INVALID_RESPONSE')
}

function readRevokeAllOthers(payload: unknown): RevokeAllOthersResult {
  if (isRecord(payload) && payload.mode === 'session') {
    const revoked = typeof payload.revoked === 'number'
      && Number.isSafeInteger(payload.revoked)
      && payload.revoked >= 0
      ? payload.revoked
      : null
    return { mode: 'session', revoked }
  }
  throw new ApiError('Invalid session revocation response', 502, 'INVALID_RESPONSE')
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
        return readSessionList(await request<unknown>('/auth/sessions', { signal }))
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
      toast.success('settingsSessions.toasts.revoked', 'Session signed out.')
    },
    onError: (err) =>
      toast.error(err, 'settingsSessions.errors.revoke', 'Failed to sign out session'),
  })
}

/**
 * Revoke every other session for the current subject. RequireSudo-
 * gated upstream. A session-mode response confirms the operation; only a
 * safe nonnegative integer confirms its count. Unknown counts remain null.
 */
export function useRevokeAllOtherSessions() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  const { fmtInt } = useNumberFormatting()
  return useMutation<RevokeAllOthersResult, ApiError, void>({
    mutationFn: () =>
      request<unknown>('/auth/sessions/all-others', { method: 'DELETE' })
        .then(readRevokeAllOthers),
    onSuccess: (result) => {
      invalidateAndBroadcast(qc, { queryKey: sessionKeys.list })
      const revoked = result.revoked
      if (revoked === null) {
        toast.success(
          'settingsSessions.toasts.revokedAllOthersCountUnknown',
          'Other sessions signed out. The number of signed-out devices is unavailable.',
        )
        return
      }
      toast.success(
        'settingsSessions.toasts.revokedAllOthers',
        `Signed out ${revoked} other device${revoked === 1 ? '' : 's'}.`,
        {
          count: revoked,
          displayCount: fmtInt(revoked),
          defaultValue_one: 'Signed out {{displayCount}} other device.',
          defaultValue_other: 'Signed out {{displayCount}} other devices.',
        },
      )
    },
    onError: (err) =>
      toast.error(
        err,
        'settingsSessions.errors.revokeAllOthers',
        'Failed to sign out other sessions',
      ),
  })
}
