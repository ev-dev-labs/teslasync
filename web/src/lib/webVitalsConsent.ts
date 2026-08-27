/**
 * Consent gate for the Web Vitals / RUM reporter.
 *
 * ── Why this is tri-state ───────────────────────────────────────────────────
 * The deployment-wide `require_cookie_consent` flag arrives asynchronously
 * from `GET /system/version`. A boolean cannot represent "we have not asked
 * yet", so a boolean default of `false` silently means "consent is not
 * required" and the reporter ships data during the window before the flag
 * resolves — exactly the window in which a first-time visitor has not
 * consented to anything.
 *
 * This module therefore models the deployment policy as a tri-state, mirroring
 * the tri-state `ConsentState` that `cookieConsent.ts` already uses for the
 * *user's* decision:
 *
 *   unknown       policy not resolved yet   → HOLD  (queue, never send)
 *   required      consent banner is live    → SEND only after `accepted`
 *   not-required  no banner in this install → SEND
 *
 * ── Fail closed, but do not fail permanently ────────────────────────────────
 * `hold` is deliberately distinct from `drop`:
 *
 *   drop  the user has answered "no" (or has not answered while the policy
 *         requires an answer). The queue is emptied so a later Accept cannot
 *         back-flush samples collected before the lawful basis existed —
 *         GDPR "lawful basis at time of collection".
 *   hold  we do not yet know the policy. Nothing leaves the browser, but the
 *         queue is retained so that once the policy resolves to
 *         `not-required` (the default for self-hosted installs) the early —
 *         and most valuable — LCP/FCP/TTFB samples are still delivered.
 *         Subscribers are notified on resolution so no polling is needed.
 *
 * ── Synchronous initialisation, restrictive only ────────────────────────────
 * `cookieConsent.ts` reads the user's decision synchronously from
 * localStorage. This module caches the last *resolved* deployment policy under
 * {@link CONSENT_POLICY_STORAGE_KEY} with a timestamp — but the cache is
 * honoured in ONE direction only:
 *
 *   cached `required`      may keep the gate CLOSED before resolution.
 *   cached `not-required`  is IGNORED for the decision. A permissive cache must
 *                          never authorise a send, because an operator may have
 *                          flipped `require_cookie_consent` on since the last
 *                          visit and the very first page load after that flip
 *                          is exactly when a user has consented to nothing.
 *
 * Both values are still persisted so the cache tracks the last known truth
 * (a flip back to `not-required` clears the restrictive hint). The hint expires
 * after {@link POLICY_HINT_TTL_MS}. `unknown` is never persisted.
 *
 * Consequence: nothing is ever transmitted before the LIVE policy resolves.
 * The queue is held (not dropped) so a `not-required` resolution still
 * delivers the early — and most valuable — LCP/FCP/TTFB samples.
 *
 * ── Where the live policy comes from ────────────────────────────────────────
 * `web/src/components/feedback/VitalsConsentPolicyGate.tsx` is the single
 * publisher. It is mounted at the App root, ABOVE `<Routes>`, so it also
 * covers the standalone routes that never mount `<Layout>` (`/s/:token`,
 * `/watch`, `/onboarding`, …). Nothing else may call
 * {@link setVitalsConsentPolicy} in production.
 */

import { getConsent } from './cookieConsent'

/** Deployment-wide consent policy. */
export type VitalsConsentPolicy = 'unknown' | 'required' | 'not-required'

/**
 * What the reporter should do with a queued batch right now.
 *
 * - `send` — allowed to POST.
 * - `hold` — policy unresolved; retain the queue, POST nothing.
 * - `drop` — not allowed; discard the queue.
 */
export type VitalsConsentDecision = 'send' | 'hold' | 'drop'

export const CONSENT_POLICY_STORAGE_KEY = 'teslasync:consent-policy:v1'

/** Cached policy hints older than this are ignored and re-resolved. */
export const POLICY_HINT_TTL_MS = 24 * 60 * 60 * 1000

interface PolicyHint {
  policy: 'required' | 'not-required'
  at: number
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function readPolicyHint(): VitalsConsentPolicy {
  const ls = safeLocalStorage()
  if (!ls) return 'unknown'
  try {
    const raw = ls.getItem(CONSENT_POLICY_STORAGE_KEY)
    if (!raw) return 'unknown'
    const parsed = JSON.parse(raw) as Partial<PolicyHint>
    if (parsed?.policy !== 'required' && parsed?.policy !== 'not-required') return 'unknown'
    if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return 'unknown'
    if (Date.now() - parsed.at > POLICY_HINT_TTL_MS) return 'unknown'
    return parsed.policy
  } catch {
    // Corrupt value, private mode, locked-down iframe — fail closed.
    return 'unknown'
  }
}

/**
 * The cache is honoured in the restrictive direction only: a stored
 * `not-required` collapses to `null` so it can never authorise a send before
 * the live policy resolves.
 */
function readRestrictiveHint(): 'required' | null {
  return readPolicyHint() === 'required' ? 'required' : null
}

function persistPolicyHint(next: 'required' | 'not-required'): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.setItem(CONSENT_POLICY_STORAGE_KEY, JSON.stringify({ policy: next, at: Date.now() }))
  } catch {
    // Quota / private-mode failures are silent by design; the in-memory
    // policy is still correct for this page load.
  }
}

// The LIVE, currently-resolved deployment policy. Starts `unknown` on every
// page load — no cached value may promote it. Only the App-root gate sets it.
let resolvedPolicy: VitalsConsentPolicy = 'unknown'

// Synchronous, restrictive-only initialisation — see the module docblock.
let restrictiveHint: 'required' | null = readRestrictiveHint()

type PolicyListener = (next: VitalsConsentPolicy) => void
const listeners = new Set<PolicyListener>()

/**
 * Subscribe to policy resolution. The reporter uses this to flush a held
 * queue the moment the policy becomes known, instead of polling.
 * Returns an unsubscribe function.
 */
export function subscribeVitalsConsentPolicy(cb: PolicyListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function publish(next: VitalsConsentPolicy): void {
  for (const cb of Array.from(listeners)) {
    try {
      cb(next)
    } catch {
      // A broken subscriber must not break consent propagation.
    }
  }
}

/**
 * Record the LIVE deployment-wide policy. Call with `'unknown'` while
 * `/system/version` is still loading or has errored — that keeps the reporter
 * in the fail-closed HOLD state instead of assuming consent is not required.
 *
 * Only `VitalsConsentPolicyGate` may call this in production.
 */
export function setVitalsConsentPolicy(next: VitalsConsentPolicy): void {
  const previous = resolvedPolicy
  resolvedPolicy = next
  if (next !== 'unknown') {
    persistPolicyHint(next)
    // Keep the in-memory restrictive hint consistent with what we just
    // learned, so a flip to `not-required` cannot leave a stale `required`
    // gating the rest of this page load.
    restrictiveHint = next === 'required' ? 'required' : null
  }
  if (next !== previous) publish(next)
}

/**
 * Boolean-shaped compatibility wrapper. `undefined` maps to `'unknown'` so a
 * caller that has not yet resolved `require_cookie_consent` cannot
 * accidentally assert "not required".
 */
export function setVitalsConsentRequirement(required: boolean | undefined): void {
  if (required === undefined) {
    setVitalsConsentPolicy('unknown')
    return
  }
  setVitalsConsentPolicy(required ? 'required' : 'not-required')
}

/** The live policy. `'unknown'` until the App-root gate resolves it. */
export function getVitalsConsentPolicy(): VitalsConsentPolicy {
  return resolvedPolicy
}

/**
 * The cached hint, restricted to its only honoured value. Exposed for
 * diagnostics and tests; it never authorises a send on its own.
 */
export function getRestrictiveConsentHint(): 'required' | null {
  return restrictiveHint
}

/**
 * Resolve the current send/hold/drop decision.
 *
 * An explicit `declined` is honoured in EVERY state, resolved or not: the user
 * said no, and no deployment policy overrides that.
 *
 * Otherwise, before the live policy resolves the gate NEVER authorises a send.
 * It holds (preserving the queue) unless a cached `required` hint says this
 * install gates reporting — restrictive, and safe to apply from cache.
 */
export function getVitalsConsentDecision(): VitalsConsentDecision {
  const consent = getConsent()

  // Policy-independent: an explicit "no" always wins.
  if (consent === 'declined') return 'drop'

  switch (resolvedPolicy) {
    case 'not-required':
      return 'send'
    case 'required':
      // `unknown` drops rather than holds: the banner is live, the user simply
      // has not answered, and a later Accept must not retroactively legitimise
      // earlier collection.
      return consent === 'accepted' ? 'send' : 'drop'
    case 'unknown':
    default:
      // A cached `required` may keep restricting. It cannot authorise, so an
      // already-accepted user still only HOLDS until the live policy lands.
      if (restrictiveHint === 'required' && consent !== 'accepted') return 'drop'
      return 'hold'
  }
}

/** True only when a POST is permitted right now. */
export function isVitalsReportingAllowed(): boolean {
  return getVitalsConsentDecision() === 'send'
}

/**
 * Test-only reset. Defaults to a *resolved* `not-required` deployment so
 * existing reporter specs keep exercising the send path; pass `'unknown'`
 * explicitly to assert the fail-closed default.
 */
export function resetVitalsConsentRequirementForTests(
  next: VitalsConsentPolicy = 'not-required',
): void {
  const ls = safeLocalStorage()
  if (ls) {
    try {
      ls.removeItem(CONSENT_POLICY_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  resolvedPolicy = next
  restrictiveHint = null
  listeners.clear()
}

/**
 * Test-only: re-run the synchronous localStorage initialisation, exactly as a
 * fresh page load would. Returns the restrictive hint that survived.
 */
export function __reinitVitalsConsentPolicyFromStorageForTests(): 'required' | null {
  resolvedPolicy = 'unknown'
  restrictiveHint = readRestrictiveHint()
  return restrictiveHint
}
