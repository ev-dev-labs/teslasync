/**
 * Phase-46 / Prompt 70 — CookieConsentBanner tests.
 *
 * The banner reads the deployment-wide `require_cookie_consent` flag
 * via useVersionInfo() and the per-user state via getConsent(). Both
 * are exposed as test seams on the component itself so specs can
 * exercise every branch without mocking the entire TanStack Query
 * stack or poking localStorage on the host JSDOM.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18n from 'i18next'
import type { ReactElement } from 'react'
import { CookieConsentBanner } from '../CookieConsentBanner'
import { clearConsent, getConsent } from '@/lib/cookieConsent'

// Minimal i18n init — react-i18next with no resources falls back to
// the `defaultValue` argument on every t() call, which is exactly what
// the banner relies on.
if (!i18n.isInitialized) {
  void i18n.init({ lng: 'en', fallbackLng: 'en', resources: {} })
}

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  clearConsent()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('CookieConsentBanner', () => {
  it('renders nothing when the server flag is OFF (self-hosted default)', () => {
    renderWithProviders(<CookieConsentBanner testHookRequireConsent={false} />)
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('renders the banner when consent is required and state is unknown', () => {
    renderWithProviders(
      <CookieConsentBanner
        testHookRequireConsent
        testHookConsentState="unknown"
      />,
    )
    expect(screen.getByTestId('cookie-consent-banner')).toBeInTheDocument()
    expect(screen.getByTestId('cookie-consent-accept')).toBeInTheDocument()
    expect(screen.getByTestId('cookie-consent-decline')).toBeInTheDocument()
  })

  it('does not render when consent is required but the user accepted', () => {
    renderWithProviders(
      <CookieConsentBanner
        testHookRequireConsent
        testHookConsentState="accepted"
      />,
    )
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('does not render when consent is required but the user declined', () => {
    renderWithProviders(
      <CookieConsentBanner
        testHookRequireConsent
        testHookConsentState="declined"
      />,
    )
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('persists "accepted" and unmounts the banner when Accept is clicked', () => {
    renderWithProviders(
      <CookieConsentBanner
        testHookRequireConsent
        testHookConsentState="unknown"
      />,
    )
    fireEvent.click(screen.getByTestId('cookie-consent-accept'))
    expect(getConsent()).toBe('accepted')
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('persists "declined" and unmounts the banner when Decline is clicked', () => {
    renderWithProviders(
      <CookieConsentBanner
        testHookRequireConsent
        testHookConsentState="unknown"
      />,
    )
    fireEvent.click(screen.getByTestId('cookie-consent-decline'))
    expect(getConsent()).toBe('declined')
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull()
  })

  it('expands and collapses the details disclosure', () => {
    renderWithProviders(
      <CookieConsentBanner
        testHookRequireConsent
        testHookConsentState="unknown"
      />,
    )
    const toggle = screen.getByTestId('cookie-consent-toggle-details')

    expect(screen.queryByTestId('cookie-consent-details')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(screen.getByTestId('cookie-consent-details')).toBeInTheDocument()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle)
    expect(screen.queryByTestId('cookie-consent-details')).toBeNull()
  })
})
