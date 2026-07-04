/**
 * useTOTP hook tests.
 *
 * Covers every export of `useTOTP.ts`:
 *   - totpKeys / TOTP_*_CODE sentinels — stable, magic-string-free contract
 *     shared with useTotpEnrollmentFlow.
 *   - useTOTPStatus     — GET /auth/totp; threads the AbortSignal; normalises
 *     the 501 AUTH_MODE_OPEN body to `{ mode: 'open' }` (a SUCCESS, not an
 *     error) while surfacing every other transport failure as isError; honours
 *     `enabled: false`.
 *   - useTOTPEnroll     — POST /auth/totp/enroll; invalidates the status key;
 *     routes failures through the error toast.
 *   - useTOTPVerify     — POST /auth/totp/verify with a `{ code }` body;
 *     invalidates + success toast; error toast on failure.
 *   - useTOTPStepUp     — POST /auth/totp/sudo; builds the body from whichever
 *     of code/backup_code is present; parks the minted token in the sudo cache
 *     AND clamps a malformed expiry so a bad response can't mint a
 *     never-expiring grant.
 *   - useTOTPRevoke     — DELETE /auth/totp; invalidates + success toast.
 *   - useTOTPRegenerateBackupCodes — POST /auth/totp/backup-codes/regenerate;
 *     invalidates + success toast; error toast on failure.
 *
 * `request` + `setCachedSudoToken` are mocked so the hooks exercise their real
 * internals (key resolution, invalidation, toast wiring, cache poisoning guard)
 * without touching the network or the module-level sudo cache. The REAL
 * ApiError / isApiError are kept (via `...actual`) so the AUTH_MODE_OPEN branch
 * runs its genuine `instanceof` check. `_toastHelpers` and `queryBroadcast` are
 * mocked with shared spies so the toast + invalidation contracts are asserted
 * directly without a ToastProvider or a leaking cross-tab coalesce timer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const {
  requestMock,
  setCachedSudoTokenMock,
  toastSuccess,
  toastError,
  invalidateAndBroadcastMock,
} = vi.hoisted(() => ({
  requestMock: vi.fn(),
  setCachedSudoTokenMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateAndBroadcastMock: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return {
    ...actual,
    request: requestMock,
    setCachedSudoToken: setCachedSudoTokenMock,
  }
})

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}))

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: invalidateAndBroadcastMock,
}))

import { ApiError } from '../client'
import {
  totpKeys,
  TOTP_RATE_LIMITED_CODE,
  TOTP_INVALID_CODE,
  TOTP_ENROLLMENT_EXPIRED_CODE,
  useTOTPStatus,
  useTOTPEnroll,
  useTOTPVerify,
  useTOTPStepUp,
  useTOTPRevoke,
  useTOTPRegenerateBackupCodes,
} from './useTOTP'
import type {
  TOTPStatus,
  TOTPEnrollment,
  TOTPSudoToken,
  TOTPBackupCodesResponse,
} from './useTOTP'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { Wrapper, qc }
}

const STATUS_KEY = { queryKey: ['totp', 'status'] }

const activeStatus: TOTPStatus = {
  mode: 'session',
  activated: true,
  last_used_at: '2025-06-01T00:00:00Z',
  backup_codes_remaining: 8,
}

const enrollment: TOTPEnrollment = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauth_uri: 'otpauth://totp/TeslaSync:alice?secret=JBSWY3DPEHPK3PXP&issuer=TeslaSync',
  qr_data_uri: 'data:image/png;base64,QQ==',
  backup_codes: ['1111-1111', '2222-2222'],
  expires_at: '2025-06-01T00:15:00Z',
}

const sudoToken: TOTPSudoToken = {
  mode: 'session',
  sudo_token: 'sudo-abc',
  expires_at: '2025-06-01T00:05:00Z',
}

const backupCodes: TOTPBackupCodesResponse = {
  backup_codes: ['3333-3333', '4444-4444'],
}

beforeEach(() => {
  requestMock.mockReset()
  setCachedSudoTokenMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  invalidateAndBroadcastMock.mockReset()
})

describe('totpKeys + sentinel codes', () => {
  it('exposes a stable status query key tuple', () => {
    expect(totpKeys.status).toEqual(['totp', 'status'])
  })

  it('mirrors the backend sentinel codes verbatim so callers avoid magic strings', () => {
    expect(TOTP_RATE_LIMITED_CODE).toBe('TOTP_RATE_LIMITED')
    expect(TOTP_INVALID_CODE).toBe('TOTP_INVALID')
    expect(TOTP_ENROLLMENT_EXPIRED_CODE).toBe('TOTP_ENROLLMENT_EXPIRED')
  })
})

describe('useTOTPStatus', () => {
  it('GETs /auth/totp with an abort signal and returns the active-credential payload', async () => {
    requestMock.mockResolvedValueOnce(activeStatus)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/auth/totp',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.data).toEqual(activeStatus)
  })

  it('normalises the 501 AUTH_MODE_OPEN response to { mode: open } as a success', async () => {
    requestMock.mockRejectedValueOnce(new ApiError('feature requires login', 501, 'AUTH_MODE_OPEN'))
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ mode: 'open' })
    // The tolerated sentinel must NOT leak out as a query error.
    expect(result.current.isError).toBe(false)
  })

  it('surfaces every other transport failure as isError (rethrown, not swallowed)', async () => {
    requestMock.mockRejectedValueOnce(new ApiError('service unavailable', 503))
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.status).toBe(503)
    expect(result.current.data).toBeUndefined()
  })

  it('does not fire a request when enabled is false', async () => {
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStatus({ enabled: false }), { wrapper: Wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(requestMock).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useTOTPEnroll', () => {
  it('POSTs /auth/totp/enroll, returns the enrollment, and invalidates the status key', async () => {
    requestMock.mockResolvedValueOnce(enrollment)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPEnroll(), { wrapper: Wrapper })
    let returned: TOTPEnrollment | undefined
    await act(async () => {
      returned = await result.current.mutateAsync()
    })

    expect(returned).toEqual(enrollment)
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/totp/enroll')
    expect(opts.method).toBe('POST')
    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), STATUS_KEY)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('routes a failure through the error toast and rejects', async () => {
    const err = new ApiError('enroll blew up', 500)
    requestMock.mockRejectedValueOnce(err)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPEnroll(), { wrapper: Wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('enroll blew up')
    })

    expect(toastError).toHaveBeenCalledWith(
      err,
      'settings.totp.errors.enroll',
      'Failed to start TOTP enrollment',
    )
    expect(invalidateAndBroadcastMock).not.toHaveBeenCalled()
  })
})

describe('useTOTPVerify', () => {
  it('POSTs the 6-digit code, invalidates the status key, and fires a success toast', async () => {
    requestMock.mockResolvedValueOnce({ activated: true })
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPVerify(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync({ code: '123456' })
    })

    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/totp/verify')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ code: '123456' })
    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), STATUS_KEY)
    expect(toastSuccess).toHaveBeenCalledWith(
      'settings.totp.toasts.verified',
      'TOTP enabled. Save your backup codes!',
    )
  })

  it('routes a verification failure through the error toast', async () => {
    const err = new ApiError('bad code', 400, TOTP_INVALID_CODE)
    requestMock.mockRejectedValueOnce(err)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPVerify(), { wrapper: Wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ code: '000000' })).rejects.toThrow('bad code')
    })

    expect(toastError).toHaveBeenCalledWith(
      err,
      'settings.totp.errors.verify',
      'Verification failed',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('useTOTPStepUp', () => {
  it('POSTs /auth/totp/sudo with a code-only body and caches the minted token', async () => {
    requestMock.mockResolvedValueOnce(sudoToken)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStepUp(), { wrapper: Wrapper })
    let returned: TOTPSudoToken | undefined
    await act(async () => {
      returned = await result.current.mutateAsync({ code: '654321' })
    })

    expect(returned).toEqual(sudoToken)
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/totp/sudo')
    expect(opts.method).toBe('POST')
    // Only the provided field is sent — no stray empty backup_code.
    expect(JSON.parse(opts.body as string)).toEqual({ code: '654321' })
    expect(setCachedSudoTokenMock).toHaveBeenCalledWith({
      token: 'sudo-abc',
      expiresAtMs: new Date(sudoToken.expires_at).getTime(),
    })
  })

  it('sends a backup_code-only body when recovering with a backup code', async () => {
    requestMock.mockResolvedValueOnce(sudoToken)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStepUp(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync({ backup_code: 'abcd-efgh' })
    })

    const [, opts] = requestMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(opts.body as string)).toEqual({ backup_code: 'abcd-efgh' })
  })

  it('clamps a malformed expires_at to 0 so a bad response cannot mint a never-expiring grant', async () => {
    // Regression guard: `new Date('nope').getTime()` is NaN, and NaN <= now()
    // is false, so getCachedSudoToken() would treat the grant as valid
    // forever. The hook must clamp a non-finite expiry to 0 (already expired).
    requestMock.mockResolvedValueOnce({
      mode: 'session',
      sudo_token: 'sudo-bad',
      expires_at: 'not-a-real-timestamp',
    } as TOTPSudoToken)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPStepUp(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync({ code: '111111' })
    })

    expect(setCachedSudoTokenMock).toHaveBeenCalledWith({
      token: 'sudo-bad',
      expiresAtMs: 0,
    })
  })
})

describe('useTOTPRevoke', () => {
  it('DELETEs /auth/totp, invalidates the status key, and toasts success', async () => {
    requestMock.mockResolvedValueOnce(undefined)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPRevoke(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })

    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/totp')
    expect(opts.method).toBe('DELETE')
    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), STATUS_KEY)
    expect(toastSuccess).toHaveBeenCalledWith('settings.totp.toasts.disabled', 'TOTP disabled.')
  })

  it('routes a revoke failure through the error toast', async () => {
    const err = new ApiError('sudo required', 401)
    requestMock.mockRejectedValueOnce(err)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPRevoke(), { wrapper: Wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('sudo required')
    })

    expect(toastError).toHaveBeenCalledWith(
      err,
      'settings.totp.errors.disable',
      'Failed to disable TOTP',
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('useTOTPRegenerateBackupCodes', () => {
  it('POSTs the regenerate route, returns the fresh codes, invalidates + toasts success', async () => {
    requestMock.mockResolvedValueOnce(backupCodes)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPRegenerateBackupCodes(), { wrapper: Wrapper })
    let returned: TOTPBackupCodesResponse | undefined
    await act(async () => {
      returned = await result.current.mutateAsync()
    })

    expect(returned).toEqual(backupCodes)
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/totp/backup-codes/regenerate')
    expect(opts.method).toBe('POST')
    expect(invalidateAndBroadcastMock).toHaveBeenCalledWith(expect.anything(), STATUS_KEY)
    expect(toastSuccess).toHaveBeenCalledWith(
      'settings.totp.toasts.backupRegenerated',
      'Backup codes regenerated.',
    )
  })

  it('routes a regenerate failure through the error toast', async () => {
    const err = new ApiError('nope', 500)
    requestMock.mockRejectedValueOnce(err)
    const { Wrapper } = makeWrapper()

    const { result } = renderHook(() => useTOTPRegenerateBackupCodes(), { wrapper: Wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('nope')
    })

    expect(toastError).toHaveBeenCalledWith(
      err,
      'settings.totp.errors.regenerate',
      'Failed to regenerate backup codes',
    )
  })
})
