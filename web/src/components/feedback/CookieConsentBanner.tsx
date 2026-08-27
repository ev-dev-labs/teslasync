/**
 * Cookie / GDPR consent banner.
 *
 * Renders a non-blocking bottom-of-screen banner the first time a user
 * lands on the page when the deployment opts into consent collection
 * (server config `require_cookie_consent === true`) AND the user has
 * not yet recorded a decision (`getConsent() === 'unknown'`).
 *
 * GDPR / CNIL-style behaviour:
 *
 *   - Non-essential cookies / reporting are OFF by default until the
 *     user explicitly clicks "Accept all". Functional storage that is
 *     strictly necessary (auth cookie, settings, draft autosave) is
 *     described as "always on" and cannot be declined here — it is
 *     exempt under the ePrivacy directive.
 *   - Dismissing the banner without choosing does NOT count as
 *     consent: the banner reappears on the next visit. The only way
 *     to make the banner go away is to click Accept or Decline.
 *   - "Manage preferences" expands a small details block listing the
 *     two categories so the consent is informed. We deliberately
 *     keep it inline (not a separate modal) so the user does not
 *     have to leave their context to make a decision.
 *
 * Mounted in <Layout> at the bottom of the viewport ABOVE the status
 * bar so the banner does not occlude any sticky top banners
 * (impersonation, maintenance, rate-limit, …) and does not steal
 * keyboard focus from the main content. Once the user accepts or
 * declines, the banner unmounts immediately — the change propagates
 * via the `cookie-consent-changed` window event the storage helper
 * dispatches.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/runtime'
import { useVersionInfo } from '@/api/hooks/useSettings'
import {
  type ConsentState,
  getConsent,
  setConsent,
  subscribeConsent,
} from '@/lib/cookieConsent'

interface CookieConsentBannerProps {
  /**
   * Test seam — overrides the live `useVersionInfo` lookup. Production
   * callers never set this; specs use it to render the banner without
   * mocking the entire TanStack Query stack.
   */
  testHookRequireConsent?: boolean
  /**
   * Test seam — overrides the live `getConsent()` lookup. Lets specs
   * exercise the "user already accepted" / "user already declined" /
   * "unknown" branches without poking localStorage.
   */
  testHookConsentState?: ConsentState
}

export function CookieConsentBanner({
  testHookRequireConsent,
  testHookConsentState,
}: CookieConsentBannerProps = {}) {
  const { t } = useTranslation()

  // Always call the hook so React's hook-call ordering is stable; the
  // test seam below short-circuits its result. The query has a long
  // staleTime and is shared with other consumers (StatusBar's version
  // chip), so this is effectively free.
  const versionQuery = useVersionInfo()
  const requireConsent =
    testHookRequireConsent ?? Boolean(versionQuery.data?.require_cookie_consent)

  // NOTE: this component no longer publishes the consent policy into the
  // reporters. `<VitalsConsentPolicyGate>` (mounted at the App root, above
  // <Routes>) is the single publisher, so the policy also resolves on the
  // standalone routes that never mount <Layout> — /s/:token, /watch,
  // /onboarding. Re-adding a publish here would duplicate the listener and
  // reintroduce the loading-window fail-open this component used to have.
  // The `useVersionInfo()` call above is shared with the gate via TanStack
  // Query's ['version'] key, so it costs no extra request.

  const [consent, setConsentState] = useState<ConsentState>(() =>
    testHookConsentState ?? getConsent(),
  )
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    // When the test seam pins consent, do not subscribe — the spec
    // owns the value lifecycle and a stray subscription would race.
    if (testHookConsentState !== undefined) {
      setConsentState(testHookConsentState)
      return
    }
    setConsentState(getConsent())
    return subscribeConsent((next) => setConsentState(next))
  }, [testHookConsentState])

  if (!requireConsent) return null
  if (consent !== 'unknown') return null

  const handleAccept = () => {
    setConsent('accepted')
    setConsentState('accepted')
  }
  const handleDecline = () => {
    setConsent('declined')
    setConsentState('declined')
  }

  return (
    <div
      data-testid="cookie-consent-banner"
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-4 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)]/95 backdrop-blur-md shadow-2xl pointer-events-auto">
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <div className="shrink-0 mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <p
              id="cookie-consent-title"
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              {t('consent.banner.title', 'Cookies & analytics')}
            </p>
            <p
              id="cookie-consent-body"
              className="text-xs text-[var(--text-secondary)] mt-1"
            >
              {t(
                'consent.banner.body',
                'TeslaSync uses strictly necessary storage to keep you signed in and to remember your preferences. With your consent, we also collect anonymous performance and error reports to improve the app. You can change your mind any time in Settings → Privacy.',
              )}
            </p>

            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="text-2xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline underline-offset-2"
                data-testid="cookie-consent-toggle-details"
                aria-expanded={showDetails}
                aria-controls="cookie-consent-details"
              >
                {showDetails
                  ? t('consent.banner.hideDetails', 'Hide details')
                  : t('consent.banner.manage', 'Manage preferences')}
              </button>
            </div>

            {showDetails && (
              <ul
                id="cookie-consent-details"
                className="mt-3 space-y-2 text-xs text-[var(--text-secondary)]"
                data-testid="cookie-consent-details"
              >
                <li className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
                  <p className="font-medium text-[var(--text-primary)]">
                    {t('consent.category.essential.title', 'Strictly necessary')}
                    <span className="ml-2 inline-flex items-center rounded-full bg-neon-green/10 px-2 py-0.5 text-2xs font-medium text-neon-green ring-1 ring-neon-green/20">
                      {t('consent.category.alwaysOn', 'Always on')}
                    </span>
                  </p>
                  <p className="mt-1 text-[var(--text-muted)]">
                    {t(
                      'consent.category.essential.body',
                      'Authentication, session, theme, and saved drafts. Required for the app to work and exempt from consent under the ePrivacy directive.',
                    )}
                  </p>
                </li>
                <li className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
                  <p className="font-medium text-[var(--text-primary)]">
                    {t('consent.category.analytics.title', 'Performance & error reporting')}
                  </p>
                  <p className="mt-1 text-[var(--text-muted)]">
                    {t(
                      'consent.category.analytics.body',
                      'Anonymous Core Web Vitals (page-load timings) and uncaught error reports sent to this TeslaSync instance to help operators diagnose issues. No third parties involved.',
                    )}
                  </p>
                </li>
              </ul>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={handleAccept}
                data-testid="cookie-consent-accept"
              >
                {t('consent.banner.accept', 'Accept all')}
              </Button>
              <Button
                variant="ghost"
                onClick={handleDecline}
                data-testid="cookie-consent-decline"
              >
                {t('consent.banner.decline', 'Decline non-essential')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CookieConsentBanner
