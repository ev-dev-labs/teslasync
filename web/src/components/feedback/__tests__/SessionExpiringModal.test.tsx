import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

/**
 * Phase-46 / Prompt 05 — SessionExpiringModal contract.
 *
 * Mocks {@link useSessionMonitor} so the test focuses on the modal's
 * visibility lifecycle (open mode vs session mode, expiring vs not
 * expiring, hard-expired branch yields to SessionExpiredModal),
 * countdown rendering, draft listing, and CTA wiring.
 */

type MockMonitor = {
  mode: 'open' | 'session' | 'unknown'
  expiresInSeconds: number | null
  isExpiringSoon: boolean
  hasExpired: boolean
  refresh: ReturnType<typeof vi.fn>
}

let mockMonitor: MockMonitor

vi.mock('@/hooks/useSessionMonitor', () => ({
  useSessionMonitor: () => mockMonitor,
  SESSION_EXPIRING_THRESHOLD_S: 60,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof defaultOrOpts === 'string') {
        let out = defaultOrOpts
        const interp = opts ?? {}
        for (const [k, v] of Object.entries(interp)) {
          out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        }
        return out
      }
      return _key
    },
  }),
}))

import { SessionExpiringModal } from '../SessionExpiringModal'

function freshMonitor(overrides: Partial<MockMonitor> = {}): MockMonitor {
  return {
    mode: 'session',
    expiresInSeconds: null,
    isExpiringSoon: false,
    hasExpired: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('SessionExpiringModal', () => {
  beforeEach(() => {
    mockMonitor = freshMonitor()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('renders nothing in open mode', () => {
    mockMonitor = freshMonitor({ mode: 'open' })
    render(<SessionExpiringModal />)
    expect(screen.queryByTestId('session-expiring-modal')).toBeNull()
  })

  it('renders nothing when not expiring soon', () => {
    mockMonitor = freshMonitor({ expiresInSeconds: 600, isExpiringSoon: false })
    render(<SessionExpiringModal />)
    expect(screen.queryByTestId('session-expiring-modal')).toBeNull()
  })

  it('does NOT render when already expired (yields to SessionExpiredModal)', () => {
    mockMonitor = freshMonitor({
      expiresInSeconds: -5,
      isExpiringSoon: false,
      hasExpired: true,
    })
    render(<SessionExpiringModal />)
    expect(screen.queryByTestId('session-expiring-modal')).toBeNull()
  })

  it('renders the countdown when expiring soon', () => {
    mockMonitor = freshMonitor({ expiresInSeconds: 45, isExpiringSoon: true })
    render(<SessionExpiringModal />)
    const modal = screen.getByTestId('session-expiring-modal')
    expect(modal).toBeTruthy()
    const countdown = screen.getByTestId('session-expiring-countdown')
    expect(countdown.textContent).toMatch(/0:45/)
  })

  it('lists unsaved drafts from localStorage', () => {
    window.localStorage.setItem(
      'teslasync:draft:v1:alertstudio:rule:42',
      JSON.stringify({ version: 1, savedAt: Date.now() - 60_000, value: { foo: 1 } }),
    )
    window.localStorage.setItem(
      'teslasync:draft:v1:automation:new',
      JSON.stringify({ version: 1, savedAt: Date.now() - 30_000, value: { bar: 2 } }),
    )
    // Non-draft key — must be ignored.
    window.localStorage.setItem('teslasync:other:thing', 'noise')
    mockMonitor = freshMonitor({ expiresInSeconds: 30, isExpiringSoon: true })

    render(<SessionExpiringModal />)
    const list = screen.getByTestId('session-expiring-drafts')
    expect(list.textContent).toContain('alertstudio:rule:42')
    expect(list.textContent).toContain('automation:new')
    expect(list.textContent).not.toContain('teslasync:other')
  })

  it('clicking "Stay signed in" calls refresh()', async () => {
    mockMonitor = freshMonitor({ expiresInSeconds: 20, isExpiringSoon: true })
    render(<SessionExpiringModal />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('session-expiring-stay'))
    })
    expect(mockMonitor.refresh).toHaveBeenCalledTimes(1)
  })

  it('clicking "Sign out now" persists return URL before navigating', () => {
    mockMonitor = freshMonitor({ expiresInSeconds: 20, isExpiringSoon: true })

    // Stub assign so the test doesn't actually navigate. Use a spy on
    // window.location via Object.defineProperty since `location` is
    // non-configurable in jsdom unless we replace the whole object.
    const assignSpy = vi.fn()
    const origLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...origLocation, href: 'http://localhost/foo?bar=1', assign: assignSpy },
    })

    try {
      render(<SessionExpiringModal />)
      fireEvent.click(screen.getByTestId('session-expiring-signout'))
      expect(window.sessionStorage.getItem('teslasync-return-url')).toBe(
        'http://localhost/foo?bar=1',
      )
      expect(assignSpy).toHaveBeenCalledWith('/')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: origLocation,
      })
    }
  })
})
