/**
 * Deployment consent-policy gate.
 *
 * THE single publisher of the live `require_cookie_consent` policy into the
 * optional client-side reporters (`webVitalsConsent`, `errorReporter`).
 *
 * ── Why it lives at the App root ────────────────────────────────────────────
 * The publish used to happen inside `<CookieConsentBanner>`, which only mounts
 * under `<Layout>`. The standalone routes — `/s/:token` (public share link),
 * `/watch`, `/onboarding`, `/glance`, `/quick-stats`, `/year-review/:year` —
 * render OUTSIDE `<Layout>`, so on those routes the policy never resolved.
 * That left the vitals reporter permanently in its fail-closed HOLD state and,
 * before the cache was made restrictive-only, made a stale `not-required` hint
 * the de-facto policy on exactly the surfaces we hand to anonymous visitors.
 *
 * Mounting here — above `<Routes>` in `App` — covers every route with one
 * component. `useVersionInfo()` is keyed `['version']`, so sharing it with the
 * banner and the status bar costs no extra request: TanStack Query dedupes by
 * key. This component owns the only *publish*; no other caller may push the
 * policy.
 *
 * ── Loading and error both mean UNKNOWN ─────────────────────────────────────
 * `undefined` data (first load in flight, or a failed `/system/version` with
 * no cached response) publishes `'unknown'` EXPLICITLY to both reporters,
 * which HOLDS their queues: nothing is transmitted, nothing is destroyed, and
 * neither reporter drains an offline buffer. Once the policy resolves they
 * flush — so a `not-required` install still delivers the early LCP/FCP/TTFB
 * samples and the boot-time errors it would otherwise lose.
 *
 * Both reporters read ONE store (`web/src/lib/webVitalsConsent.ts`), so the
 * two publishes below cannot make their gates diverge; the second is a no-op
 * on an unchanged value. They are written out explicitly so the wiring is
 * greppable from either reporter.
 *
 * Renders nothing.
 */

import { useEffect } from 'react'

import { useVersionInfo } from '@/api/hooks/useSettings'
import { setVitalsConsentRequirement } from '@/lib/webVitalsConsent'
import { setErrorReporterConsentRequirement } from '@/lib/errorReporter'

export function VitalsConsentPolicyGate(): null {
  const { data } = useVersionInfo()

  // `data` stays `undefined` while the query is in flight AND when it errors
  // without a previously cached response — both are "policy not known".
  const resolved =
    data === undefined ? undefined : Boolean(data.require_cookie_consent)

  useEffect(() => {
    // Publish loading/error (`undefined` → `unknown`) explicitly to BOTH
    // reporters. Publishing `false` here would fail open for exactly the
    // window in which a first-time visitor has consented to nothing.
    setVitalsConsentRequirement(resolved)
    setErrorReporterConsentRequirement(resolved)
  }, [resolved])

  return null
}

export default VitalsConsentPolicyGate
