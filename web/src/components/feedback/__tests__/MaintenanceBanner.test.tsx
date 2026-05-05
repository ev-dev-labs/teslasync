import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

/**
 * Phase-46 / Prompt 04 — MaintenanceBanner contract.
 *
 * Mocks {@link useSystemHealth} so the test focuses on the banner's
 * visibility lifecycle, dismissal persistence, and re-surfacing
 * behaviour when the upstream snapshot changes. react-i18next is
 * stubbed to echo default values so assertions can match the
 * fallback English copy directly.
 */

type MockHealth = {
  mode?: 'ok' | 'degraded' | 'maintenance'
  maintenance_message?: string
  maintenance_until?: string
  maintenance_updated_at?: string
} | null

let mockHealth: MockHealth = null

vi.mock('@/api/hooks/useAdmin', () => ({
  useSystemHealth: () => ({ data: mockHealth }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      // useTranslation in this codebase is called as t(key, defaultValue) OR t(key, defaultValue, opts).
      // The mock returns the default verbatim with {{var}} interpolation so the
      // test can assert on rendered copy without pulling i18n into the spec.
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

import { MaintenanceBanner } from '../MaintenanceBanner'

const SESSION_DISMISS_KEY = 'teslasync:maintenance-dismissed-for'

describe('MaintenanceBanner', () => {
  beforeEach(() => {
    mockHealth = null
    window.sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))
  })

  afterEach(() => {
    window.sessionStorage.clear()
    vi.useRealTimers()
  })

  it('renders nothing when health data is missing', () => {
    mockHealth = null
    const { container } = render(<MaintenanceBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when mode is ok', () => {
    mockHealth = { mode: 'ok' }
    const { container } = render(<MaintenanceBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the maintenance variant with message and aria=alert', () => {
    mockHealth = {
      mode: 'maintenance',
      maintenance_message: 'DB upgrade in progress',
      maintenance_updated_at: '2025-01-01T11:00:00Z',
    }
    render(<MaintenanceBanner />)
    const banner = screen.getByTestId('maintenance-banner')
    expect(banner).toHaveAttribute('data-mode', 'maintenance')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument()
    expect(screen.getByText('DB upgrade in progress')).toBeInTheDocument()
  })

  it('renders the degraded variant with role=status and default copy when message is empty', () => {
    mockHealth = {
      mode: 'degraded',
      maintenance_updated_at: '2025-01-01T11:00:00Z',
    }
    render(<MaintenanceBanner />)
    const banner = screen.getByTestId('maintenance-banner')
    expect(banner).toHaveAttribute('data-mode', 'degraded')
    expect(banner).toHaveAttribute('role', 'status')
    expect(screen.getByText('Service is degraded')).toBeInTheDocument()
    expect(
      screen.getByText('Some features may be slow or unavailable while we work on it.'),
    ).toBeInTheDocument()
  })

  it('renders a countdown when maintenance_until is in the future', () => {
    mockHealth = {
      mode: 'maintenance',
      maintenance_message: 'short window',
      maintenance_until: '2025-01-01T12:30:00Z',
      maintenance_updated_at: '2025-01-01T11:00:00Z',
    }
    render(<MaintenanceBanner />)
    expect(screen.getByTestId('maintenance-banner-countdown').textContent).toMatch(/Ends in 30m/)
  })

  it('hides the banner when the user dismisses and persists the snapshot key', () => {
    mockHealth = {
      mode: 'maintenance',
      maintenance_message: 'first window',
      maintenance_updated_at: '2025-01-01T11:00:00Z',
    }
    render(<MaintenanceBanner />)
    fireEvent.click(screen.getByTestId('maintenance-banner-dismiss'))
    expect(screen.queryByTestId('maintenance-banner')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(SESSION_DISMISS_KEY)).toBe('u:2025-01-01T11:00:00Z')
  })

  it('does not render when sessionStorage already records a dismissal for the current snapshot', () => {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, 'u:2025-01-01T11:00:00Z')
    mockHealth = {
      mode: 'maintenance',
      maintenance_message: 'first window',
      maintenance_updated_at: '2025-01-01T11:00:00Z',
    }
    const { container } = render(<MaintenanceBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('re-surfaces the banner when the operator pushes a new snapshot (different updated_at)', () => {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, 'u:2025-01-01T11:00:00Z')
    mockHealth = {
      mode: 'maintenance',
      maintenance_message: 'second window',
      maintenance_updated_at: '2025-01-01T13:00:00Z',
    }
    render(<MaintenanceBanner />)
    expect(screen.getByTestId('maintenance-banner')).toBeInTheDocument()
  })

  it('falls back to a content fingerprint when updated_at is absent', () => {
    mockHealth = {
      mode: 'degraded',
      maintenance_message: 'no updated_at',
    }
    render(<MaintenanceBanner />)
    fireEvent.click(screen.getByTestId('maintenance-banner-dismiss'))
    const stored = window.sessionStorage.getItem(SESSION_DISMISS_KEY) ?? ''
    expect(stored.startsWith('s:degraded|no updated_at|')).toBe(true)
  })

  it('updates the countdown as time advances', () => {
    mockHealth = {
      mode: 'maintenance',
      maintenance_message: 'tick',
      maintenance_until: '2025-01-01T12:01:00Z',
      maintenance_updated_at: '2025-01-01T11:00:00Z',
    }
    render(<MaintenanceBanner />)
    expect(screen.getByTestId('maintenance-banner-countdown').textContent).toMatch(/1m 00s/)
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByTestId('maintenance-banner-countdown').textContent).toMatch(/45s/)
  })
})
