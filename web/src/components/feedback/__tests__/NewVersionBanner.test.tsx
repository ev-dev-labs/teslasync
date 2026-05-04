import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Phase-45 / Prompt 11 — NewVersionBanner contract.
 *
 * Mocks {@link useVersionWatcher} and `react-i18next` so the test focuses
 * purely on the banner's visibility lifecycle and click behaviour.
 */

let mockState: {
  bootVersion: string | null
  latestVersion: string | null
  newVersionAvailable: boolean
} = { bootVersion: null, latestVersion: null, newVersionAvailable: false }

vi.mock('@/hooks/useVersionWatcher', () => ({
  useVersionWatcher: () => mockState,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}))

import { NewVersionBanner } from '../NewVersionBanner'

const SESSION_DISMISS_KEY = 'teslasync:new-version-dismissed-for'

describe('NewVersionBanner', () => {
  beforeEach(() => {
    mockState = { bootVersion: null, latestVersion: null, newVersionAvailable: false }
    window.sessionStorage.clear()
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('renders nothing when no new version is available', () => {
    mockState = { bootVersion: 'v1.0.0', latestVersion: 'v1.0.0', newVersionAvailable: false }
    const { container } = render(<NewVersionBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the banner with both action buttons when a new version is available', () => {
    mockState = { bootVersion: 'v1.0.0', latestVersion: 'v1.1.0', newVersionAvailable: true }
    render(<NewVersionBanner />)
    const banner = screen.getByTestId('new-version-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /later/i })).toBeInTheDocument()
  })

  it('triggers a hard reload when the user clicks Reload', () => {
    mockState = { bootVersion: 'v1.0.0', latestVersion: 'v1.1.0', newVersionAvailable: true }
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    })

    render(<NewVersionBanner />)
    fireEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('hides the banner when the user clicks Later and persists the dismissal in sessionStorage', () => {
    mockState = { bootVersion: 'v1.0.0', latestVersion: 'v1.1.0', newVersionAvailable: true }
    render(<NewVersionBanner />)

    fireEvent.click(screen.getByRole('button', { name: /later/i }))

    expect(screen.queryByTestId('new-version-banner')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(SESSION_DISMISS_KEY)).toBe('v1.1.0')
  })

  it('does not render when sessionStorage already records a dismissal for the current latestVersion', () => {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, 'v1.1.0')
    mockState = { bootVersion: 'v1.0.0', latestVersion: 'v1.1.0', newVersionAvailable: true }
    const { container } = render(<NewVersionBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('re-surfaces the banner when a NEWER version arrives after a previous dismissal', () => {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, 'v1.1.0')
    mockState = { bootVersion: 'v1.0.0', latestVersion: 'v1.2.0', newVersionAvailable: true }
    render(<NewVersionBanner />)
    expect(screen.getByTestId('new-version-banner')).toBeInTheDocument()
  })
})
