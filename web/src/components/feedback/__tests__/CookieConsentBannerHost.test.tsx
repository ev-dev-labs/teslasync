import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearConsent, CONSENT_STORAGE_KEY, setConsent } from '@/lib/cookieConsent'

const { version, loadBanner } = vi.hoisted(() => ({
  version: { requireConsent: false },
  loadBanner: vi.fn(),
}))

vi.mock('@/api/hooks/useSettings', () => ({
  useVersionInfo: () => ({ data: { require_cookie_consent: version.requireConsent } }),
}))

vi.mock('../CookieConsentBanner', () => {
  loadBanner()
  return { default: () => <div data-testid="deferred-consent-banner" /> }
})

import { CookieConsentBannerHost } from '../CookieConsentBannerHost'

describe('CookieConsentBannerHost', () => {
  beforeEach(() => {
    localStorage.clear()
    version.requireConsent = false
    loadBanner.mockClear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('loads only when needed and responds to consent changes in this tab and other tabs', async () => {
    const { rerender } = render(<CookieConsentBannerHost />)
    expect(loadBanner).not.toHaveBeenCalled()
    expect(screen.queryByTestId('deferred-consent-banner')).not.toBeInTheDocument()

    version.requireConsent = true
    rerender(<CookieConsentBannerHost />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(await screen.findByTestId('deferred-consent-banner')).toBeInTheDocument()
    expect(loadBanner).toHaveBeenCalledOnce()

    act(() => { setConsent('accepted') })
    expect(screen.queryByTestId('deferred-consent-banner')).not.toBeInTheDocument()
    act(() => { clearConsent() })
    expect(await screen.findByTestId('deferred-consent-banner')).toBeInTheDocument()

    localStorage.setItem(CONSENT_STORAGE_KEY, 'declined')
    fireEvent(window, new StorageEvent('storage', { key: CONSENT_STORAGE_KEY, newValue: 'declined' }))
    expect(screen.queryByTestId('deferred-consent-banner')).not.toBeInTheDocument()
    localStorage.removeItem(CONSENT_STORAGE_KEY)
    fireEvent(window, new StorageEvent('storage', { key: CONSENT_STORAGE_KEY, newValue: null }))
    expect(await screen.findByTestId('deferred-consent-banner')).toBeInTheDocument()

    version.requireConsent = false
    rerender(<CookieConsentBannerHost />)
    expect(screen.queryByTestId('deferred-consent-banner')).not.toBeInTheDocument()
  })
})
