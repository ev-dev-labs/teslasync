/**
 * @module api/hooks/useTOTP
 *
 * Per-user TOTP enrollment hooks.
 *
 * Mirrors the layered fetch pattern used by useNotifications.ts:
 * a single useQuery for status + a small set of useMutation hooks
 * that invalidate the status key on success. The query tolerates the
 * 501 AUTH_MODE_OPEN response by surfacing it as a discriminated-union
 * status (`mode: 'open'`) so the section can render a "feature
 * requires login" placeholder without throwing.
 *
 * Step-up token minting goes through useTOTPStepUp() which posts
 * directly to /auth/totp/sudo. The reauth interceptor in client.ts
 * picks the resulting sudo_token up via setCachedSudoToken(), so the
 * caller doesn't have to thread the token by hand to follow-up
 * requests.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError, request, setCachedSudoToken } from '../client'
import { useMutationToast } from './_toastHelpers'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import type {
  TOTPBackupCodesResponse,
  TOTPEnrollment,
  TOTPStatus,
  TOTPSudoToken,
} from '@/api/types'

export type { TOTPBackupCodesResponse, TOTPEnrollment, TOTPStatus, TOTPSudoToken }

export const totpKeys = {
  status: ['totp', 'status'] as const,
}

/**
 * Sentinel code mirrored from totp_handler.AuthModeOpenCode. Treated
 * as a "feature unavailable" signal — NOT an error. The status hook
 * normalises to `{ mode: 'open' }` so consumers branch on the union
 * tag instead of inspecting error strings.
 */
const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN'

/**
 * Sentinel code returned by the verify-sudo endpoint when the
 * per-subject failure counter saturates. Distinct from
 * `TOTP_INVALID` so the SPA can render a "wait 15 minutes" hint
 * instead of a generic "wrong code" toast.
 */
export const TOTP_RATE_LIMITED_CODE = 'TOTP_RATE_LIMITED'

/**
 * Sentinel code returned by both /verify and /sudo on a code
 * mismatch. Re-exported so caller components can compare without
 * magic-stringing.
 */
export const TOTP_INVALID_CODE = 'TOTP_INVALID'

/**
 * Sentinel code returned by /verify when the user took longer than
 * the 15-minute enrollment TTL to confirm the QR. Surfaces as a
 * dedicated "scan a fresh QR" message in the SPA, distinct from a
 * code mismatch.
 */
export const TOTP_ENROLLMENT_EXPIRED_CODE = 'TOTP_ENROLLMENT_EXPIRED'

/**
 * Status query. Returns:
 *   • `{ mode: 'open' }` when the backend reports AUTH_MODE_OPEN.
 *   • `{ mode: 'session', activated: false }` when forward-auth is
 *     configured but the subject hasn't enrolled yet.
 *   • `{ mode: 'session', activated: true, ... }` when an active
 *     credential exists.
 *
 * Treats the 501 AUTH_MODE_OPEN response as a successful query so
 * useQuery's `isError` stays clean and the consumer can render
 * directly off `data`.
 */
export function useTOTPStatus(options?: { enabled?: boolean }) {
  return useQuery<TOTPStatus, ApiError>({
    queryKey: totpKeys.status,
    queryFn: async ({ signal }) => {
      try {
        return await request<TOTPStatus>('/auth/totp', { signal })
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return { mode: 'open' } as TOTPStatus
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
 * Enrollment mutation. POSTs to /auth/totp/enroll and returns the
 * fresh secret + QR data URI + backup codes. The SPA shows the QR
 * + manual code, then calls useTOTPVerify() to confirm.
 *
 * Returning the secret to the caller (rather than caching server-side
 * for a follow-up "use what you just generated" path) means the
 * pending row in the DB IS the source of truth; a tab close mid-flow
 * lets the 15-minute TTL prune it cleanly without stale state on the
 * client.
 */
export function useTOTPEnroll() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<TOTPEnrollment, ApiError, void>({
    mutationFn: () => request<TOTPEnrollment>('/auth/totp/enroll', { method: 'POST' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: totpKeys.status })
    },
    onError: (err) => toast.error(err, 'settings.totp.errors.enroll', 'Failed to start TOTP enrollment'),
  })
}

/**
 * Verify mutation — promotes a pending enrollment to active. On
 * success the status query is invalidated so the section's pill
 * flips from "Not enrolled" to "Active" without a manual refetch.
 */
export function useTOTPVerify() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<{ activated: boolean }, ApiError, { code: string }>({
    mutationFn: ({ code }) =>
      request<{ activated: boolean }>('/auth/totp/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: totpKeys.status })
      toast.success('settings.totp.toasts.verified', 'TOTP enabled. Save your backup codes!')
    },
    onError: (err) => toast.error(err, 'settings.totp.errors.verify', 'Verification failed'),
  })
}

/**
 * Per-user TOTP step-up. POSTs to /auth/totp/sudo. The returned
 * token is automatically registered with setCachedSudoToken() so
 * the next outbound request from any caller automatically carries
 * `X-Sudo-Token` and clears the next SUDO_REQUIRED gate.
 *
 * Used by the <ReauthDialog>'s TOTP tab when the current subject
 * has a per-user TOTP credential (so the dialog uses THIS endpoint
 * instead of the legacy shared-secret /auth/reauth path).
 */
export function useTOTPStepUp() {
  return useMutation<TOTPSudoToken, ApiError, { code?: string; backup_code?: string }>({
    mutationFn: async ({ code, backup_code }) => {
      const body: Record<string, string> = {}
      if (code) body.code = code
      if (backup_code) body.backup_code = backup_code
      const result = await request<TOTPSudoToken>('/auth/totp/sudo', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      // Park the freshly minted token in the in-memory cache so every
      // subsequent request from this tab automatically carries the
      // X-Sudo-Token header — same flow as the password reauth path
      // already does in <ReauthDialog>.
      //
      // A malformed or absent `expires_at` parses to NaN, and NaN compares
      // false against Date.now() — so getCachedSudoToken() would treat the
      // grant as valid forever. Clamp a non-finite expiry to 0 (already
      // expired) so the reauth interceptor re-challenges on the next
      // request instead of silently reusing an unbounded sudo token.
      const expiresAtMs = new Date(result.expires_at).getTime()
      setCachedSudoToken({
        token: result.sudo_token,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : 0,
      })
      return result
    },
  })
}

/**
 * Revoke mutation. The DELETE route is RequireSudo-gated upstream,
 * so the SPA's request() interceptor will open the reauth dialog
 * before this mutation actually fires. Once it succeeds the cached
 * sudo token is intentionally NOT cleared — the user just stepped
 * up a moment ago and may have follow-up actions to take.
 */
export function useTOTPRevoke() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/auth/totp', { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: totpKeys.status })
      toast.success('settings.totp.toasts.disabled', 'TOTP disabled.')
    },
    onError: (err) => toast.error(err, 'settings.totp.errors.disable', 'Failed to disable TOTP'),
  })
}

/**
 * Regenerate backup codes. RequireSudo-gated upstream like Revoke.
 * Returns the fresh codes once; the SPA shows them with copy /
 * download then never again.
 */
export function useTOTPRegenerateBackupCodes() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<TOTPBackupCodesResponse, ApiError, void>({
    mutationFn: () =>
      request<TOTPBackupCodesResponse>('/auth/totp/backup-codes/regenerate', { method: 'POST' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: totpKeys.status })
      toast.success('settings.totp.toasts.backupRegenerated', 'Backup codes regenerated.')
    },
    onError: (err) =>
      toast.error(err, 'settings.totp.errors.regenerate', 'Failed to regenerate backup codes'),
  })
}
