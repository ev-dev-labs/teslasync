// Native parity port of web/src/lib/cookieConsent.ts.
//
// Cookie / GDPR consent storage helper.
//
// Stores the user's consent decision as the literal string "accepted" or
// "declined" under `teslasync:consent:v1`. The `unknown` state is materialised
// by the *absence* of the key rather than a stored sentinel so a fresh app, a
// wiped app, and an app the user has never granted consent in all collapse to
// the same observable state.
//
// The helper is intentionally side-effect-free beyond the storage write.
// Subscribers (CookieConsentBanner, webVitalsReporter, errorReporter) read with
// {@link getConsent} on demand and a consent mutation notifies in-runtime
// subscribers so the live UI updates without a reload.
//
// Storage failures (private mode quota, locked-down iframes, Safari ITP, or
// simply a platform with no Web Storage at all) NEVER throw — every accessor
// falls back to "unknown" and every mutator silently drops the write so a
// broken / absent storage subsystem cannot break TeslaSync. The
// deployment-wide consent contract is still enforced server-side via the
// `/system/version` flag, so a client that cannot persist consent simply
// re-prompts on every load which is itself the correct GDPR behaviour.
//
// ## Native conversion (contract rule 7)
//
// React Native ships no `window`, no `localStorage`, and no same-document
// `CustomEvent`, so the browser-only seams are replaced — following the sibling
// broadcast.ts port — by native-safe equivalents that:
//   - keep the full public API (CONSENT_STORAGE_KEY, CONSENT_CHANGED_EVENT,
//     ConsentState, getConsent / setConsent / clearConsent / subscribeConsent /
//     isReportingAllowed) and the exact "accepted"/"declined"/absent-key
//     storage contract (all platform-agnostic),
//   - AUTO-DETECT a global `localStorage` (the react-native-web browser build /
//     a host polyfill) for real persistence + the native cross-surface
//     `storage` event, preserving web parity there,
//   - replace the same-document `CustomEvent` with an in-runtime subscriber
//     registry — the native analog of the in-tab event — so same-runtime
//     subscribers are notified on every mutation even on pure native,
//   - accept a host-injected Web-Storage-shaped backend via
//     {@link setConsentStorage} (e.g. MMKV / a sync AsyncStorage shim) so a
//     pure-native host can opt into real cross-launch persistence, and
//   - otherwise fall back to a documented no-persistence state whose
//     {@link CONSENT_STORAGE_UNAVAILABLE_REASON} explains the platform limit.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported.

export const CONSENT_STORAGE_KEY = 'teslasync:consent:v1';

/**
 * Fired whenever {@link setConsent} or {@link clearConsent} mutates the stored
 * value. Subscribers (the banner, the privacy settings panel) listen via
 * {@link subscribeConsent} so they can re-render when one surface mutates
 * state.
 *
 * On the web this was a same-document `window` CustomEvent named
 * 'cookie-consent-changed'. The native port preserves the constant for API
 * parity but delivers same-runtime notifications through an in-process
 * subscriber registry (see the native header). Cross-surface updates on the
 * react-native-web build still arrive via the native `storage` event, exactly
 * as on the web.
 */
export const CONSENT_CHANGED_EVENT = 'cookie-consent-changed';

/**
 * Tri-state consent value. `unknown` means the user has not yet decided — the
 * banner is still showing or the user dismissed without choosing. `accepted`
 * and `declined` are explicit user decisions.
 */
export type ConsentState = 'unknown' | 'accepted' | 'declined';

// React Native's tsconfig omits the DOM lib, so the optional global
// `localStorage` + its `storage` event target are typed structurally (mirrors
// the broadcast.ts port). Only the members actually used are modelled.

/**
 * Minimal Web-Storage-shaped backend used by the consent helper. The
 * react-native-web build's `localStorage` satisfies this structurally, and a
 * pure-native host can inject any conforming sync store via
 * {@link setConsentStorage}.
 */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface NativeStorageEvent {
  key?: string | null;
  newValue?: string | null;
}

interface NativeStorageEventTarget {
  addEventListener(
    type: 'storage',
    listener: (event: NativeStorageEvent) => void,
  ): void;
  removeEventListener(
    type: 'storage',
    listener: (event: NativeStorageEvent) => void,
  ): void;
}

/**
 * Explicit no-persistence reason, surfaced (and documented in the parity
 * sidecar) so callers / log readers can tell "the user has not decided yet"
 * apart from "this platform cannot persist a decision". On pure native (no
 * global `localStorage`, no injected storage) {@link getConsent} always returns
 * 'unknown' and {@link setConsent} only notifies in-runtime subscribers — which
 * is the correct GDPR re-prompt-on-every-load behaviour the web helper already
 * falls back to when Web Storage is unavailable.
 */
export const CONSENT_STORAGE_UNAVAILABLE_REASON =
  'React Native provides no localStorage; consent is not persisted across ' +
  'launches (getConsent returns "unknown") until a host injects a ' +
  'Web-Storage-shaped backend via setConsentStorage. The react-native-web ' +
  'browser build auto-detects localStorage and persists with full web parity.';

let injectedStorage: ConsentStorage | null = null;

/**
 * Wire (or clear) a host-provided persistent storage backend. Passing `null`
 * reverts to the auto-detected global `localStorage` when available, otherwise
 * the no-persistence default. Intended for pure-native hosts that want real
 * cross-launch persistence (e.g. an MMKV- or sync-AsyncStorage-backed shim) and
 * for tests that simulate storage.
 */
export function setConsentStorage(storage: ConsentStorage | null): void {
  injectedStorage = storage;
}

function getGlobalStorage(): ConsentStorage | null {
  const candidate = (
    globalThis as typeof globalThis & {localStorage?: unknown}
  ).localStorage;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const storage = candidate as Partial<ConsentStorage>;
  return typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
    ? (candidate as ConsentStorage)
    : null;
}

/**
 * Native-safe replacement for the web `safeLocalStorage()`. Prefers a
 * host-injected backend, then an auto-detected global `localStorage`, and is
 * `null` (no persistence) when neither exists — never throwing.
 */
function safeConsentStorage(): ConsentStorage | null {
  if (injectedStorage) {
    return injectedStorage;
  }
  try {
    return getGlobalStorage();
  } catch {
    return null;
  }
}

/**
 * Returns the user's stored consent decision, or `unknown` if no decision has
 * been recorded (or storage is unavailable).
 */
export function getConsent(): ConsentState {
  const ls = safeConsentStorage();
  if (!ls) return 'unknown';
  try {
    const raw = ls.getItem(CONSENT_STORAGE_KEY);
    if (raw === 'accepted' || raw === 'declined') return raw;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// In-runtime subscriber registry — the native analog of the web in-tab
// `CustomEvent`. Same-document delivery in the browser is same-runtime delivery
// here, so this set is notified on every mutation on ALL platforms (including
// the react-native-web build, where cross-SURFACE delivery is additionally
// handled by the native `storage` event in subscribeConsent below).
const listeners = new Set<(state: ConsentState) => void>();

function dispatchChange(state: ConsentState): void {
  for (const cb of [...listeners]) {
    try {
      cb(state);
    } catch {
      // A subscriber threw — never let one consumer break the notify loop or
      // the mutation that triggered it. The storage write (if any) already
      // succeeded so the next getConsent() returns the new value.
    }
  }
}

/**
 * Persists the user's explicit consent decision and notifies in-runtime
 * subscribers via the registry. On the react-native-web build, cross-surface
 * listeners pick the change up via the native `storage` event fired by the
 * localStorage write.
 */
export function setConsent(state: 'accepted' | 'declined'): void {
  const ls = safeConsentStorage();
  if (!ls) {
    dispatchChange(state);
    return;
  }
  try {
    ls.setItem(CONSENT_STORAGE_KEY, state);
  } catch {
    // Quota / private-mode failures are silent by design.
  }
  dispatchChange(state);
}

/**
 * Clears any stored consent decision so the next `getConsent()` call returns
 * `unknown`. Used by the Privacy settings panel ("Reset") and by tests.
 */
export function clearConsent(): void {
  const ls = safeConsentStorage();
  if (ls) {
    try {
      ls.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // Silent — see safeConsentStorage rationale above.
    }
  }
  dispatchChange('unknown');
}

function getStorageEventTarget(): NativeStorageEventTarget | null {
  const candidate = globalThis as typeof globalThis &
    Partial<NativeStorageEventTarget>;
  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? (candidate as NativeStorageEventTarget)
    : null;
}

/**
 * Subscribe to consent changes (same-runtime via the in-process registry and,
 * on the react-native-web build, cross-surface via the native `storage`
 * event). Returns an unsubscribe function; idempotent if called multiple times.
 *
 * The callback receives the new {@link ConsentState} but should still call
 * {@link getConsent} if it needs the authoritative value because the
 * cross-surface `storage` event only carries a string `newValue`.
 */
export function subscribeConsent(cb: (state: ConsentState) => void): () => void {
  listeners.add(cb);

  const target = getStorageEventTarget();
  const onStorage = (e: NativeStorageEvent) => {
    if (e.key && e.key !== CONSENT_STORAGE_KEY) return;
    cb(getConsent());
  };
  if (target) {
    target.addEventListener('storage', onStorage);
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(cb);
    if (target) {
      target.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * Returns true when optional client-side reporting is allowed under the
 * deployment's consent policy.
 *
 * - When the server reports `requireCookieConsent === false` (the default for
 *   self-hosted single-user installs), reporting is always allowed: there is
 *   no banner and no consent UI.
 * - When the server reports `requireCookieConsent === true`, reporting is
 *   allowed only after the user has clicked Accept. The `unknown` and
 *   `declined` states both block reporting.
 *
 * Subscribers (webVitalsReporter, errorReporter) call this in their send paths
 * so a `decline` between two metric callbacks immediately stops outbound POSTs
 * without needing the page to reload.
 */
export function isReportingAllowed(requireCookieConsent: boolean): boolean {
  if (!requireCookieConsent) return true;
  return getConsent() === 'accepted';
}
