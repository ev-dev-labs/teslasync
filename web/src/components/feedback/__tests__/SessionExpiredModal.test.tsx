import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

/**
 * SessionExpiredModal contract tests.
 *
 * Two activation paths:
 *   1. {@link useSessionMonitor} reports `hasExpired === true`.
 *   2. The `teslasync:session-expired` document event fires.
 *
 * Open mode renders nothing in either branch. The modal is non-
 * dismissible — Esc / backdrop calls onClose, which is a no-op.
 */

type MockMonitor = {
  mode: 'open' | 'session' | 'unknown'
  hasExpired: boolean
}

let mockMonitor: MockMonitor

vi.mock('@/hooks/useSessionMonitor', () => ({
  useSessionMonitor: () => mockMonitor,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultOrOpts?: string | Record<string, unknown>) =>
      typeof defaultOrOpts === 'string' ? defaultOrOpts : _key,
  }),
}))

import { SessionExpiredModal } from '../SessionExpiredModal'

describe('SessionExpiredModal', () => {
  beforeEach(() => {
    mockMonitor = { mode: 'session', hasExpired: false }
    window.sessionStorage.clear()
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('renders nothing in open mode regardless of any state', () => {
    mockMonitor = { mode: 'open', hasExpired: true }
    render(<SessionExpiredModal />)
    expect(screen.queryByTestId('session-expired-modal')).toBeNull()
  })

  it('renders nothing while authenticated and no event fired', () => {
    mockMonitor = { mode: 'session', hasExpired: false }
    render(<SessionExpiredModal />)
    expect(screen.queryByTestId('session-expired-modal')).toBeNull()
  })

  it('opens when useSessionMonitor reports hasExpired', () => {
    mockMonitor = { mode: 'session', hasExpired: true }
    render(<SessionExpiredModal />)
    expect(screen.getByTestId('session-expired-modal')).toBeTruthy()
    expect(screen.getByTestId('session-expired-signin')).toBeTruthy()
  })

  it('opens on teslasync:session-expired event (event-bus path)', () => {
    mockMonitor = { mode: 'session', hasExpired: false }
    render(<SessionExpiredModal />)
    expect(screen.queryByTestId('session-expired-modal')).toBeNull()
    act(() => {
      document.dispatchEvent(new CustomEvent('teslasync:session-expired'))
    })
    expect(screen.getByTestId('session-expired-modal')).toBeTruthy()
  })

  it('clicking "Sign in again" hands off to the IdP outpost with rd= deep-link', () => {
    mockMonitor = { mode: 'session', hasExpired: true }

    const assignSpy = vi.fn()
    const origLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...origLocation,
        href: 'http://localhost/dashboard?tab=overview',
        pathname: '/dashboard',
        search: '?tab=overview',
        hash: '',
        assign: assignSpy,
      },
    })

    try {
      render(<SessionExpiredModal />)
      fireEvent.click(screen.getByTestId('session-expired-signin'))
      // navigateToReauth() writes sessionStorage as a belt-and-
      // suspenders fallback for proxies that drop the `rd=` param.
      expect(window.sessionStorage.getItem('teslasync-return-url')).toBe(
        'http://localhost/dashboard?tab=overview',
      )
      // Default Authentik outpost path with the current href URL-
      // encoded as the rd= return-destination parameter. Authentik
      // upstream validates rd= host matches the configured external
      // host, so we always pass the full href, not just the pathname.
      expect(assignSpy).toHaveBeenCalledTimes(1)
      const target = assignSpy.mock.calls[0][0] as string
      expect(target).toMatch(/^\/outpost\.goauthentik\.io\/start\?rd=/)
      expect(target).toContain(encodeURIComponent('http://localhost/dashboard?tab=overview'))
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: origLocation,
      })
    }
  })
})
