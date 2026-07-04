/**
 * @module api/hooks/useImpersonation
 *
 * Admin impersonation hooks.
 *
 * Mirrors the layered fetch pattern used by useSessions.ts: useQuery
 * for the state + a separate useQuery for candidates + two
 * useMutation hooks for start / end. Both queries tolerate the 501
 * AUTH_MODE_OPEN response by surfacing it as a discriminated-union
 * value (`{ mode: 'open' }`) so the banner / button can render the
 * "feature requires forward-auth" placeholder without throwing.
 *
 * The start mutation is RequireSudo-gated upstream — the SPA's
 * request() interceptor will pop the reauth dialog before the
 * mutation actually fires. The end mutation is intentionally NOT
 * sudo-gated so an admin can always exit impersonation without
 * re-auth friction.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError, request } from '../client'
import { useMutationToast } from './_toastHelpers'
import type {
  ImpersonationCandidate,
  ImpersonationCandidatesResponse,
  ImpersonationStartRequest,
  ImpersonationStatus,
} from '@/api/types'

export type {
  ImpersonationCandidate,
  ImpersonationCandidatesResponse,
  ImpersonationStartRequest,
  ImpersonationStatus,
}

export const impersonationKeys = {
  status: ['impersonation', 'status'] as const,
  candidates: ['impersonation', 'candidates'] as const,
}

/**
 * Sentinel mirrored from impersonate_handler.AuthModeOpenCode.
 * Treated as a "feature unavailable" signal, NOT an error. Both
 * query hooks normalise the 501 path to `{ mode: 'open' }` so
 * consumers branch on the union tag instead of inspecting error
 * strings.
 */
const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN'

/**
 * Backend state payload before the SPA reshapes it. The handler always
 * sends `{ mode, ... }`; the 501 path is mapped to `{ mode: 'open' }`
 * client-side because TanStack's queryFn must reject on a real
 * network error to drive `isError`, and we want the open-mode case to
 * read as a successful no-op.
 */
interface ImpersonationStatePayload {
  mode: 'inactive' | 'active'
  original_admin?: string
  target?: string
  expires_at?: string
}

/**
 * Impersonation state query. Returns:
 *   • `{ mode: 'open' }` when the backend reports AUTH_MODE_OPEN.
 *   • `{ mode: 'inactive' }` when no impersonation cookie is active.
 *   • `{ mode: 'active', original_admin, target, expires_at }` otherwise.
 *
 * Polls every 30 seconds so the banner reflects cookie expiry without
 * a full page reload. refetchIntervalInBackground:false keeps polling
 * paused while the tab is hidden.
 */
export function useImpersonationStatus(options?: { enabled?: boolean }) {
  return useQuery<ImpersonationStatus, ApiError>({
    queryKey: impersonationKeys.status,
    queryFn: async ({ signal }) => {
      try {
        const payload = await request<ImpersonationStatePayload>('/admin/impersonate', { signal })
        // Defensive: a 204/empty body (payload == null) is treated as
        // "not impersonating" rather than dereferencing a nullish value,
        // which would surface as a spurious query error in the banner.
        if (payload?.mode === 'active') {
          return {
            mode: 'active',
            original_admin: payload.original_admin ?? '',
            target: payload.target ?? '',
            expires_at: payload.expires_at ?? '',
          }
        }
        return { mode: 'inactive' }
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return { mode: 'open' }
        }
        throw err
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
    enabled: options?.enabled ?? true,
  })
}

/**
 * Returns true when the active impersonation status is the 'open'
 * mode placeholder. Pure helper exported for the banner / button to
 * skip rendering without re-doing the discriminated check inline.
 */
export function isImpersonationOpenMode(status: ImpersonationStatus | undefined): boolean {
  return status?.mode === 'open'
}

/**
 * Returns true when the active impersonation status is currently
 * impersonating (banner should be visible).
 */
export function isImpersonationActive(status: ImpersonationStatus | undefined): boolean {
  return status?.mode === 'active'
}

/**
 * Candidates query. Returns the list of distinct subjects the calling
 * admin could impersonate, EXCLUDING themselves. The SPA hides the
 * "Impersonate" button when this list is empty (single-subject
 * install) so the user never sees a button that can't possibly
 * produce a valid target.
 *
 * `enabled` defaults to false — consumers opt in (typically when the
 * Subjects page mounts) to avoid a noisy /candidates query on every
 * page render.
 */
export function useImpersonationCandidates(options?: { enabled?: boolean }) {
  return useQuery<ImpersonationCandidatesResponse, ApiError>({
    queryKey: impersonationKeys.candidates,
    queryFn: async ({ signal }) => {
      try {
        const payload = await request<{
          mode: 'session'
          candidates: ImpersonationCandidate[]
        }>('/admin/impersonate/candidates', { signal })
        return {
          mode: 'session',
          // Null-safe: a 204/empty body yields an empty candidate list
          // instead of throwing on a nullish `payload`.
          candidates: payload?.candidates ?? [],
        }
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return { mode: 'open' }
        }
        throw err
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? false,
  })
}

/**
 * Start an impersonation session. The mutation is sudo-gated
 * upstream; the SPA's request() interceptor will surface the reauth
 * dialog before the POST actually fires.
 *
 * On success, invalidates the status key so the banner immediately
 * picks up the new active state, AND invalidates ALL queries so the
 * SPA re-fetches every endpoint as the impersonation target.
 */
export function useStartImpersonation() {
  const qc = useQueryClient()
  const { success, error } = useMutationToast()
  return useMutation<ImpersonationStatus, ApiError, ImpersonationStartRequest>({
    mutationFn: (body) =>
      request<ImpersonationStatus>('/admin/impersonate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      // Prime the status cache so the banner appears without an
      // intermediate inactive flash.
      qc.setQueryData(impersonationKeys.status, data)
      // Invalidate every other query — the user is now seeing data
      // for a different subject, so anything cached belongs to the
      // wrong principal.
      void qc.invalidateQueries()
      success('impersonation.toast.started', 'Impersonation started')
    },
    onError: (err) => error(err, 'impersonation.toast.startFailed', 'Failed to start impersonation'),
  })
}

/**
 * End the current impersonation session. Idempotent: the backend
 * returns 204 even when no claim is active, so a parallel-tab end
 * click does not surface an error toast.
 *
 * On success, invalidates the status key + every other query so the
 * SPA re-fetches as the original admin.
 */
export function useEndImpersonation() {
  const qc = useQueryClient()
  const { success, error } = useMutationToast()
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await request<void>('/admin/impersonate/end', { method: 'POST' })
    },
    onSuccess: () => {
      // Reset to inactive immediately so the banner disappears
      // without waiting for the next poll.
      qc.setQueryData<ImpersonationStatus>(impersonationKeys.status, { mode: 'inactive' })
      void qc.invalidateQueries()
      success('impersonation.toast.ended', 'Impersonation ended')
    },
    onError: (err) => error(err, 'impersonation.toast.endFailed', 'Failed to end impersonation'),
  })
}
