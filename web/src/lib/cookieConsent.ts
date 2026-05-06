/**
 * Phase-46 / Prompt 70 — Cookie / GDPR consent storage helper.
 *
 * Stores the user's consent decision in localStorage as the literal
 * string "accepted" or "declined" under `teslasync:consent:v1`. The
 * `unknown` state is materialised by the *absence* of the key rather
 * than a stored sentinel so a fresh browser, a wiped browser, and a
 * browser the user has never visited TeslaSync from all collapse to
 * the same observable state.
 *
 * The helper is intentionally side-effect-free beyond the localStorage
 * write. Subscribers (CookieConsentBanner, webVitalsReporter,
 * errorReporter) read with {@link getConsent} on demand and the banner
 * dispatches a lightweight `cookie-consent-changed` window event so
 * the live UI updates without a reload.
 *
 * Storage failures (private mode quota, locked-down iframes, Safari
 * ITP) NEVER throw — every accessor falls back to "unknown" and every
 * mutator silently drops the write so a broken storage subsystem
 * cannot break TeslaSync. The deployment-wide consent contract is
 * still enforced server-side via the `/system/version` flag, so a
 * client that cannot persist consent simply re-prompts on every load
 * which is itself the correct GDPR behaviour.
 */

export const CONSENT_STORAGE_KEY = 'teslasync:consent:v1'

/**
 * Fired on `window` whenever {@link setConsent} or {@link clearConsent}
 * mutates the stored value. Subscribers (the banner, the privacy
 * settings panel) listen for this so they can re-render when one tab
 * mutates state — cross-tab updates are also delivered via the native
 * `storage` event but the in-tab event is needed for the *same*-tab
 * case where `storage` does not fire.
 */
export const CONSENT_CHANGED_EVENT = 'cookie-consent-changed'

/**
 * Tri-state consent value. `unknown` means the user has not yet
 * decided — the banner is still showing or the user dismissed without
 * choosing. `accepted` and `declined` are explicit user decisions.
 */
export type ConsentState = 'unknown' | 'accepted' | 'declined'

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Returns the user's stored consent decision, or `unknown` if no
 * decision has been recorded (or storage is unavailable).
 */
export function getConsent(): ConsentState {
  const ls = safeLocalStorage()
  if (!ls) return 'unknown'
  try {
    const raw = ls.getItem(CONSENT_STORAGE_KEY)
    if (raw === 'accepted' || raw === 'declined') return raw
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function dispatchChange(state: ConsentState): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(
      new CustomEvent<ConsentState>(CONSENT_CHANGED_EVENT, { detail: state }),
    )
  } catch {
    // CustomEvent may be unavailable in degraded test environments;
    // the storage write already succeeded so the next read will
    // return the new value.
  }
}

/**
 * Persists the user's explicit consent decision and notifies in-tab
 * subscribers via {@link CONSENT_CHANGED_EVENT}. Cross-tab listeners
 * pick the change up via the native `storage` event.
 */
export function setConsent(state: 'accepted' | 'declined'): void {
  const ls = safeLocalStorage()
  if (!ls) {
    dispatchChange(state)
    return
  }
  try {
    ls.setItem(CONSENT_STORAGE_KEY, state)
  } catch {
    // Quota / private-mode failures are silent by design.
  }
  dispatchChange(state)
}

/**
 * Clears any stored consent decision so the next `getConsent()` call
 * returns `unknown`. Used by the Privacy settings panel ("Reset")
 * and by tests.
 */
export function clearConsent(): void {
  const ls = safeLocalStorage()
  if (ls) {
    try {
      ls.removeItem(CONSENT_STORAGE_KEY)
    } catch {
      // Silent — see safeLocalStorage rationale above.
    }
  }
  dispatchChange('unknown')
}

/**
 * Subscribe to consent changes (in-tab via {@link CONSENT_CHANGED_EVENT}
 * and cross-tab via the native `storage` event). Returns an unsubscribe
 * function; idempotent if called multiple times.
 *
 * The callback receives the new {@link ConsentState} but should still
 * call {@link getConsent} if it needs the authoritative value because
 * the cross-tab `storage` event only carries a string `newValue`.
 */
export function subscribeConsent(cb: (state: ConsentState) => void): () => void {
  if (typeof window === 'undefined') return () => undefined

  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<ConsentState>).detail
    cb(detail ?? getConsent())
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key !== CONSENT_STORAGE_KEY) return
    cb(getConsent())
  }

  window.addEventListener(CONSENT_CHANGED_EVENT, onCustom as EventListener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onCustom as EventListener)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Returns true when optional client-side reporting is allowed under the
 * deployment's consent policy.
 *
 * - When the server reports `requireCookieConsent === false` (the
 *   default for self-hosted single-user installs), reporting is
 *   always allowed: there is no banner and no consent UI.
 * - When the server reports `requireCookieConsent === true`, reporting
 *   is allowed only after the user has clicked Accept. The `unknown`
 *   and `declined` states both block reporting.
 *
 * Subscribers (webVitalsReporter, errorReporter) call this in their
 * send paths so a `decline` between two metric callbacks immediately
 * stops outbound POSTs without needing the page to reload.
 */
export function isReportingAllowed(requireCookieConsent: boolean): boolean {
  if (!requireCookieConsent) return true
  return getConsent() === 'accepted'
}
