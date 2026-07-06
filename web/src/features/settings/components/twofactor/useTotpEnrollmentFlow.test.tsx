/**
 * useTotpEnrollmentFlow contract.
 *
 * This hook owns the whole client-side state machine for the two-factor
 * settings surface: the enroll → verify → backup-codes dialog progression,
 * the disable confirmation, and the copy/download of one-time backup codes.
 * The tests drive the hook directly with `renderHook` and run the REAL
 * `useTOTP*` mutation hooks end-to-end — only the shared `request` transport
 * is mocked, so every state transition, error branch, and null-safety guard
 * is exercised exactly as it would be in production.
 *
 * Coverage map (one facet per case):
 *   • initial closed state + localized disable label + the status query fires;
 *   • `changeVerifyCode` sanitisation (strips non-digits, clamps to 6);
 *   • `handleEnroll` success (opens dialog, stores enrollment) and its
 *     swallowed-error branch (dialog stays closed);
 *   • `handleVerify` short-code guard (never hits the endpoint), success
 *     (reveals enrollment codes + advances), the `?? []` null-safety branch
 *     when there is no enrollment, and each mapped error code
 *     (TOTP_INVALID / TOTP_RATE_LIMITED / TOTP_ENROLLMENT_EXPIRED) plus the
 *     generic-Error fallback;
 *   • `handleRegenerate` success, the `?? []` guard for a malformed response,
 *     and its swallowed-error branch;
 *   • the disable-confirm toggles and `handleConfirmDisable` success + the
 *     `finally` close-on-failure branch;
 *   • `closeDialog` resets the whole enroll/verify sub-state;
 *   • `downloadCodes` writes a text/plain blob with the codes and cleans up
 *     the object URL, and is a no-op when nothing is revealed.
 *
 * `@/api/client` is mocked so the hooks run without a network. react-i18next
 * is stubbed to echo the English fallback so message assertions are
 * deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
    setCachedSudoToken: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, ApiError } from '@/api/client'
import {
  TOTP_INVALID_CODE,
  TOTP_RATE_LIMITED_CODE,
  TOTP_ENROLLMENT_EXPIRED_CODE,
} from '@/api/hooks/useTOTP'
import type { TOTPEnrollment } from '@/api/types'
import { ToastProvider } from '@/components/feedback/Toast'
import { useTotpEnrollmentFlow } from './useTotpEnrollmentFlow'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const ENROLLMENT: TOTPEnrollment = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauth_uri: 'otpauth://totp/TeslaSync:alice?secret=JBSWY3DPEHPK3PXP&issuer=TeslaSync',
  qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
  backup_codes: ['AAAA-AAAA', 'BBBB-BBBB', 'CCCC-CCCC'],
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
}

/** Default not-enrolled session status returned by GET /auth/totp. */
const NOT_ENROLLED = { mode: 'session', activated: false, backup_codes_remaining: 0 } as const

type Handler = (opts?: unknown) => unknown

/**
 * Install a request implementation. Every override still resolves the
 * status query (`/auth/totp`) so the mounting `useTOTPStatus` and any
 * post-mutation refetch never hit the "unexpected request" guard.
 */
function mockApi(handlers: Record<string, Handler> = {}) {
  mockedRequest.mockImplementation(async (path: string, opts?: unknown) => {
    const handler = handlers[path]
    if (handler) return handler(opts)
    if (path === '/auth/totp') return NOT_ENROLLED
    throw new Error(`unexpected request to ${path}`)
  })
}

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
}

/** Render the flow and wait until the initial status query has settled. */
async function setupFlow() {
  const view = renderHook(() => useTotpEnrollmentFlow(), { wrapper: createWrapper() })
  await waitFor(() => expect(view.result.current.status.isLoading).toBe(false))
  return view
}

beforeEach(() => {
  mockedRequest.mockReset()
  mockApi()
})

describe('useTotpEnrollmentFlow — initial state', () => {
  it('exposes a closed dialog, empty sub-state, and a localized disable label', async () => {
    const { result } = await setupFlow()

    expect(result.current.dialogStep).toBe('closed')
    expect(result.current.enrollment).toBeNull()
    expect(result.current.revealedCodes).toBeNull()
    expect(result.current.verifyCode).toBe('')
    expect(result.current.verifyError).toBeNull()
    expect(result.current.showDisableConfirm).toBe(false)
    expect(result.current.disableTypedLabel).toBe('Type DISABLE to confirm')
    expect(result.current.enrolling).toBe(false)
    expect(result.current.verifying).toBe(false)
    expect(result.current.regenerating).toBe(false)
    expect(result.current.revoking).toBe(false)
  })

  it('drives the status query off GET /auth/totp', async () => {
    const { result } = await setupFlow()

    expect(mockedRequest).toHaveBeenCalledWith(
      '/auth/totp',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.status.data).toEqual(NOT_ENROLLED)
  })
})

describe('useTotpEnrollmentFlow — changeVerifyCode', () => {
  it('strips non-digit characters and clamps the code to six digits', async () => {
    const { result } = await setupFlow()

    act(() => result.current.changeVerifyCode('12ab34cd56ef78'))
    expect(result.current.verifyCode).toBe('123456')

    act(() => result.current.changeVerifyCode('9-9'))
    expect(result.current.verifyCode).toBe('99')
  })
})

describe('useTotpEnrollmentFlow — handleEnroll', () => {
  it('opens the enroll dialog and stores the enrollment on success', async () => {
    mockApi({ '/auth/totp/enroll': () => ENROLLMENT })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleEnroll()
    })

    expect(result.current.dialogStep).toBe('enroll')
    expect(result.current.enrollment).toEqual(ENROLLMENT)
    expect(result.current.verifyCode).toBe('')
    expect(result.current.verifyError).toBeNull()
    expect(mockedRequest).toHaveBeenCalledWith(
      '/auth/totp/enroll',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('swallows an enroll failure and leaves the dialog closed', async () => {
    mockApi({
      '/auth/totp/enroll': () => {
        throw new ApiError('boom', 500)
      },
    })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleEnroll()
    })

    expect(result.current.dialogStep).toBe('closed')
    expect(result.current.enrollment).toBeNull()
  })
})

describe('useTotpEnrollmentFlow — handleVerify', () => {
  it('rejects a short code inline and never calls the verify endpoint', async () => {
    const { result } = await setupFlow()

    act(() => result.current.changeVerifyCode('123'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.verifyError).toBe('Enter all 6 digits.')
    expect(mockedRequest).not.toHaveBeenCalledWith('/auth/totp/verify', expect.anything())
  })

  it('reveals the enrollment backup codes and advances to the backupCodes step on success', async () => {
    mockApi({
      '/auth/totp/enroll': () => ENROLLMENT,
      '/auth/totp/verify': () => ({ activated: true }),
    })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleEnroll()
    })
    act(() => result.current.changeVerifyCode('123456'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.dialogStep).toBe('backupCodes')
    expect(result.current.revealedCodes).toEqual(ENROLLMENT.backup_codes)
    expect(result.current.verifyError).toBeNull()
    expect(mockedRequest).toHaveBeenCalledWith(
      '/auth/totp/verify',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: '123456' }) }),
    )
  })

  it('falls back to an empty backup-code list when there is no enrollment (?? [] guard)', async () => {
    mockApi({ '/auth/totp/verify': () => ({ activated: true }) })
    const { result } = await setupFlow()

    act(() => result.current.changeVerifyCode('654321'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.dialogStep).toBe('backupCodes')
    expect(result.current.revealedCodes).toEqual([])
  })

  it('maps TOTP_INVALID to the "try the next one" hint and keeps the enroll dialog open', async () => {
    mockApi({
      '/auth/totp/enroll': () => ENROLLMENT,
      '/auth/totp/verify': () => {
        throw new ApiError('mismatch', 401, TOTP_INVALID_CODE)
      },
    })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleEnroll()
    })
    act(() => result.current.changeVerifyCode('999999'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.verifyError).toMatch(/did not match/i)
    expect(result.current.dialogStep).toBe('enroll')
  })

  it('maps TOTP_RATE_LIMITED to the 15-minute wait message', async () => {
    mockApi({
      '/auth/totp/verify': () => {
        throw new ApiError('slow down', 429, TOTP_RATE_LIMITED_CODE)
      },
    })
    const { result } = await setupFlow()

    act(() => result.current.changeVerifyCode('111111'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.verifyError).toMatch(/15 minutes/i)
  })

  it('maps TOTP_ENROLLMENT_EXPIRED to the "start over" message', async () => {
    mockApi({
      '/auth/totp/verify': () => {
        throw new ApiError('too late', 410, TOTP_ENROLLMENT_EXPIRED_CODE)
      },
    })
    const { result } = await setupFlow()

    act(() => result.current.changeVerifyCode('222222'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.verifyError).toMatch(/expired/i)
  })

  it('surfaces a raw Error message for an unmapped failure', async () => {
    mockApi({
      '/auth/totp/verify': () => {
        throw new Error('network unreachable')
      },
    })
    const { result } = await setupFlow()

    act(() => result.current.changeVerifyCode('333333'))
    await act(async () => {
      await result.current.handleVerify()
    })

    expect(result.current.verifyError).toBe('network unreachable')
    expect(result.current.dialogStep).toBe('closed')
  })
})

describe('useTotpEnrollmentFlow — handleRegenerate', () => {
  it('reveals the fresh codes and switches to the backupCodes view on success', async () => {
    mockApi({
      '/auth/totp/backup-codes/regenerate': () => ({ backup_codes: ['NEW1-NEW1', 'NEW2-NEW2'] }),
    })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleRegenerate()
    })

    expect(result.current.revealedCodes).toEqual(['NEW1-NEW1', 'NEW2-NEW2'])
    expect(result.current.dialogStep).toBe('backupCodes')
    expect(result.current.enrollment).toBeNull()
    expect(mockedRequest).toHaveBeenCalledWith(
      '/auth/totp/backup-codes/regenerate',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('is null-safe when the regenerate response omits backup_codes (?? [] guard)', async () => {
    mockApi({ '/auth/totp/backup-codes/regenerate': () => ({}) })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleRegenerate()
    })

    // The malformed response must not leak `undefined` into the state — the
    // backup-codes modal only opens when `codes != null`, so a real array
    // keeps the reveal step reachable.
    expect(result.current.revealedCodes).toEqual([])
    expect(result.current.dialogStep).toBe('backupCodes')
  })

  it('swallows a regenerate failure and stays closed', async () => {
    mockApi({
      '/auth/totp/backup-codes/regenerate': () => {
        throw new ApiError('nope', 500)
      },
    })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleRegenerate()
    })

    expect(result.current.dialogStep).toBe('closed')
    expect(result.current.revealedCodes).toBeNull()
  })
})

describe('useTotpEnrollmentFlow — disable confirmation', () => {
  it('toggles the confirmation flag via openDisableConfirm / closeDisableConfirm', async () => {
    const { result } = await setupFlow()

    act(() => result.current.openDisableConfirm())
    expect(result.current.showDisableConfirm).toBe(true)

    act(() => result.current.closeDisableConfirm())
    expect(result.current.showDisableConfirm).toBe(false)
  })

  it('revokes the credential and closes the confirmation on success', async () => {
    mockApi({ '/auth/totp': (opts) => (isDelete(opts) ? undefined : NOT_ENROLLED) })
    const { result } = await setupFlow()

    act(() => result.current.openDisableConfirm())
    await act(async () => {
      await result.current.handleConfirmDisable()
    })

    expect(result.current.showDisableConfirm).toBe(false)
    expect(mockedRequest).toHaveBeenCalledWith(
      '/auth/totp',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('still closes the confirmation when the revoke fails (finally branch)', async () => {
    mockApi({
      '/auth/totp': (opts) => {
        if (isDelete(opts)) throw new ApiError('sudo required', 401)
        return NOT_ENROLLED
      },
    })
    const { result } = await setupFlow()

    act(() => result.current.openDisableConfirm())
    await act(async () => {
      await result.current.handleConfirmDisable()
    })

    expect(result.current.showDisableConfirm).toBe(false)
  })
})

describe('useTotpEnrollmentFlow — closeDialog', () => {
  it('resets the enroll/verify sub-state back to closed/empty', async () => {
    mockApi({ '/auth/totp/enroll': () => ENROLLMENT })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleEnroll()
    })
    act(() => result.current.changeVerifyCode('123456'))
    expect(result.current.dialogStep).toBe('enroll')

    act(() => result.current.closeDialog())

    expect(result.current.dialogStep).toBe('closed')
    expect(result.current.enrollment).toBeNull()
    expect(result.current.revealedCodes).toBeNull()
    expect(result.current.verifyCode).toBe('')
    expect(result.current.verifyError).toBeNull()
  })
})

describe('useTotpEnrollmentFlow — downloadCodes', () => {
  const blobStash = new Map<string, Blob>()
  let downloads: { filename: string; url: string }[] = []
  let originalClick: typeof HTMLAnchorElement.prototype.click
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL

  beforeEach(() => {
    blobStash.clear()
    downloads = []
    originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      downloads.push({
        filename: (this as HTMLAnchorElement).download,
        url: (this as HTMLAnchorElement).href,
      })
    }
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:test/${blobStash.size + 1}`
      blobStash.set(url, blob)
      return url
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalClick
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('writes a text/plain blob containing the codes and revokes the object URL', async () => {
    mockApi({
      '/auth/totp/backup-codes/regenerate': () => ({ backup_codes: ['AAAA-AAAA', 'BBBB-BBBB'] }),
    })
    const { result } = await setupFlow()

    await act(async () => {
      await result.current.handleRegenerate()
    })
    act(() => result.current.downloadCodes())

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(downloads).toHaveLength(1)
    expect(downloads[0].filename).toBe('teslasync-totp-backup-codes.txt')

    const blob = blobStash.get(downloads[0].url)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('text/plain')
    const text = await blob!.text()
    expect(text).toContain('AAAA-AAAA')
    expect(text).toContain('BBBB-BBBB')
    expect(text).toContain('TeslaSync TOTP backup codes')

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(downloads[0].url)
  })

  it('is a no-op when there are no revealed codes', async () => {
    const { result } = await setupFlow()

    act(() => result.current.downloadCodes())

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(downloads).toHaveLength(0)
  })
})

/** Narrow a request()'s second argument to detect a DELETE call. */
function isDelete(opts: unknown): boolean {
  return (
    typeof opts === 'object' &&
    opts !== null &&
    (opts as { method?: string }).method === 'DELETE'
  )
}
