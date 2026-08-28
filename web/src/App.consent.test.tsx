import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { initReactI18next } from 'react-i18next'
import i18n from 'i18next'

/**
 * Standalone-route consent coverage.
 *
 * `/s/:token` (public share link) and `/watch` render OUTSIDE `<Layout>`, so
 * the consent-policy publish that used to live in `<CookieConsentBanner>`
 * never ran there. These specs mount the REAL `<App>` on those routes and
 * assert that the App-root gate resolves the policy anyway — and that a stale
 * permissive cache cannot authorise a send in the window before it does.
 *
 * `<Routes>` is neutralised so mounting `<App>` never pulls a lazy page chunk
 * into jsdom; the gate sits above `<Routes>`, which is exactly the property
 * under test.
 */

const { navigateSpy, versionQueryResult } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  versionQueryResult: { current: { data: undefined as unknown } },
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy, Routes: () => null }
})

vi.mock('@/api/hooks/useSettings', () => ({
  useVersionInfo: () => versionQueryResult.current,
}))

vi.mock('@/lib/errorReporter', () => ({
  setErrorReporterConsentRequirement: vi.fn(),
  reportFrontendError: vi.fn(),
  installGlobalErrorReporting: vi.fn(),
}))

vi.mock('./components/layout/Layout', () => ({ default: () => null }))
vi.mock('./components/layout/ScrollRestoration', () => ({ ScrollRestoration: () => null }))
vi.mock('@/features/onboarding/components/OnboardingGate', () => ({ OnboardingGate: () => null }))
vi.mock('@/features/onboarding/components/TaskOnboardingHost', () => ({
  TaskOnboardingHost: () => null,
}))
vi.mock('@/components/ui/DensityApplier', () => ({ DensityApplier: () => null }))
vi.mock('@/components/ui/ContextMenu', () => ({ ContextMenuRoot: () => null }))
// Route-level chrome is stubbed: the announcer and the focus manager both run
// timers/focus side effects that are covered by their own specs. Everything
// else in the barrel (VisuallyHidden, AnnouncerRegion) stays real.
vi.mock('@/components/a11y', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/a11y')>()),
  RouteAnnouncer: () => null,
  RouteFocusManager: () => null,
}))

import App from './App'
import {
  CONSENT_POLICY_STORAGE_KEY,
  __reinitVitalsConsentPolicyFromStorageForTests,
  getVitalsConsentDecision,
  getVitalsConsentPolicy,
  resetVitalsConsentRequirementForTests,
} from '@/lib/webVitalsConsent'
import { clearConsent, setConsent } from '@/lib/cookieConsent'

const STANDALONE_ROUTES = ['/s/share-token-abc', '/watch'] as const

function cachePolicy(policy: 'required' | 'not-required'): void {
  localStorage.setItem(
    CONSENT_POLICY_STORAGE_KEY,
    JSON.stringify({ policy, at: Date.now() }),
  )
}

function setVersion(data: unknown): void {
  versionQueryResult.current = { data }
}

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

async function setupI18n() {
  if (i18n.isInitialized) return
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
}

describe('App :: consent policy on standalone routes', () => {
  beforeEach(async () => {
    await setupI18n()
    navigateSpy.mockReset()
    sessionStorage.clear()
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
    setVersion(undefined)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  it.each(STANDALONE_ROUTES)(
    'resolves the live policy on %s even though <Layout> never mounts',
    (path) => {
      setVersion({ require_cookie_consent: false })
      renderAppAt(path)

      expect(getVitalsConsentPolicy()).toBe('not-required')
      expect(getVitalsConsentDecision()).toBe('send')
    },
  )

  it.each(STANDALONE_ROUTES)('holds on %s while the policy is unknown', (path) => {
    setVersion(undefined)
    renderAppAt(path)

    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(getVitalsConsentDecision()).toBe('hold')
  })

  it.each(STANDALONE_ROUTES)(
    'holds on %s when /system/version fails outright',
    (path) => {
      // Query error with no cached response: `data` is undefined, so the gate
      // publishes `unknown` and nothing is transmitted.
      setVersion(undefined)
      renderAppAt(path)

      expect(getVitalsConsentDecision()).toBe('hold')
    },
  )

  it('cached not-required flipped to newly required: never authorises a send on /s/:token', () => {
    // Last visit this install did not require consent, so a permissive hint is
    // on disk. The operator has since flipped `require_cookie_consent` on.
    cachePolicy('not-required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()
    // Pre-resolution the permissive cache must be inert.
    expect(getVitalsConsentDecision()).toBe('hold')

    setVersion({ require_cookie_consent: true })
    renderAppAt('/s/share-token-abc')

    expect(getVitalsConsentPolicy()).toBe('required')
    expect(getVitalsConsentDecision()).toBe('drop')

    // And only an explicit Accept opens the gate.
    setConsent('accepted')
    expect(getVitalsConsentDecision()).toBe('send')
  })

  it('cached required stays restrictive on /watch until the live policy lands', () => {
    cachePolicy('required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBe('required')
    expect(getVitalsConsentDecision()).toBe('drop')

    setVersion({ require_cookie_consent: false })
    renderAppAt('/watch')

    // The live policy overrides the stale restrictive cache.
    expect(getVitalsConsentPolicy()).toBe('not-required')
    expect(getVitalsConsentDecision()).toBe('send')
  })

  it('still resolves the policy on a Layout route', () => {
    setVersion({ require_cookie_consent: true })
    act(() => {
      renderAppAt('/vehicles')
    })
    expect(getVitalsConsentPolicy()).toBe('required')
  })
})
