/**
 * Phase-46 / Prompt 63 — Browser compatibility detection.
 *
 * TeslaSync depends on a small set of modern web platform features:
 *   • BroadcastChannel — cross-tab sync (`@/lib/broadcast`).
 *   • ResizeObserver — Recharts ResponsiveContainer + Leaflet sizing.
 *   • Intl.RelativeTimeFormat — humanized "5 minutes ago" timestamps.
 *   • CSS `:has()` selector — emergent layout adjustments.
 *   • structuredClone — TanStack Query cache hydration.
 *
 * `crypto.randomUUID` was previously listed but is intentionally NOT
 * a hard requirement: it is restricted to secure contexts (HTTPS or
 * literal `localhost`) and is therefore undefined when self-hosted
 * TeslaSync is accessed via a LAN IP (e.g. http://192.168.1.42:3002)
 * or a custom hostname over plain HTTP. Both call sites in the app
 * now route through `@/lib/safeUUID#safeRandomUUID`, which falls
 * back to `crypto.getRandomValues` (available in non-secure contexts)
 * and ultimately `Math.random` so the banner does not fire on
 * supported browsers behind a non-HTTPS deployment.
 *
 * On unsupported browsers (old Safari, Firefox ESR < 102, IE / Edge
 * Legacy on enterprise networks) the SPA either renders a white page
 * or partially renders with no diagnostic. This helper detects which
 * required features are missing so a UI banner can tell the user what
 * to do instead of silently breaking.
 *
 * Design constraints:
 *   • Detection is read-only; we do NOT polyfill anything (out of
 *     scope per the prompt — `core-js` is a separate decision).
 *   • Detection is synchronous and side-effect-free so it can run at
 *     module load. The single localStorage probe is wrapped in a
 *     try/catch because Safari ITP / private mode throws on access.
 *   • Dismissal is sticky-per-browser via a versioned localStorage
 *     key so a user who has acknowledged the warning does not see it
 *     again unless they switch browsers, clear storage, or we ship a
 *     new requirement (bump the `:v` suffix).
 */

const STORAGE_KEY = 'teslasync:compat-warning-dismissed:v1'

/**
 * Returns the list of REQUIRED features missing in the current browser.
 * Empty array means the browser is supported.
 *
 * Each detection is wrapped defensively because some host environments
 * (older Safari, JSDOM versions, locked-down iframes) can throw rather
 * than return `undefined` when a global is queried. A throw must NOT
 * crash the boot sequence — it is itself evidence of incompatibility,
 * so we record the feature as missing and move on.
 */
export function detectMissingFeatures(): string[] {
  const missing: string[] = []

  if (typeof globalThis.BroadcastChannel === 'undefined') {
    missing.push('BroadcastChannel')
  }

  if (typeof globalThis.ResizeObserver === 'undefined') {
    missing.push('ResizeObserver')
  }

  try {
    if (
      typeof Intl === 'undefined' ||
      typeof (Intl as { RelativeTimeFormat?: unknown }).RelativeTimeFormat === 'undefined'
    ) {
      missing.push('Intl.RelativeTimeFormat')
    }
  } catch {
    missing.push('Intl.RelativeTimeFormat')
  }

  try {
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
      missing.push('CSS @supports')
    } else if (!CSS.supports('selector(:has(*))')) {
      missing.push('CSS :has()')
    }
  } catch {
    missing.push('CSS @supports')
  }

  if (typeof (globalThis as { structuredClone?: unknown }).structuredClone === 'undefined') {
    missing.push('structuredClone')
  }

  return missing
}

/**
 * Reads the dismissed flag from localStorage. Wrapped in try/catch
 * because Safari ITP and Chrome incognito both throw on `localStorage`
 * access in some configurations — a throw means "we don't know if it
 * was dismissed", and the safe default is to show the banner.
 */
export function isCompatWarningDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Persists the dismissal flag. Errors (quota, private mode, missing
 * localStorage) are swallowed because the user has already been told
 * — re-throwing here would surface a quota error in a banner about a
 * browser that may itself be the source of the quota error.
 */
export function dismissCompatWarning(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, '1')
  } catch {
    /* private mode / quota — ignore, banner reappears on reload */
  }
}

/**
 * Test seam — clears the persisted dismissal so successive specs in
 * the same vitest run get a clean slate. Production code never calls
 * this; the symbol is exported only to keep the storage key private.
 */
export function __resetCompatWarningForTests(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export const COMPAT_WARNING_STORAGE_KEY = STORAGE_KEY
