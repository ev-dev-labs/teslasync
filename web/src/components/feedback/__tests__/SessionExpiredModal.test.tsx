import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

/**
 * Phase-46 / Prompt 05 — SessionExpiredModal contract.
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

  it('clicking "Sign in again" preserves return URL and reloads to current path', () => {
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
      expect(window.sessionStorage.getItem('teslasync-return-url')).toBe(
        'http://localhost/dashboard?tab=overview',
      )
      expect(assignSpy).toHaveBeenCalledWith('/dashboard?tab=overview')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: origLocation,
      })
    }
  })
})
