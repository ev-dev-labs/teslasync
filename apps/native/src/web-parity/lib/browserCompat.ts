// Native parity port of web/src/lib/browserCompat.ts.
//
// PURPOSE (web, source L1-37): browserCompat detects whether the *web browser*
// running the TeslaSync SPA is missing modern web-platform features the SPA
// hard-depends on, so a UI banner can tell the user to upgrade instead of the
// SPA silently white-paging. The five web requirements are:
//   • BroadcastChannel        — cross-TAB sync (@/lib/broadcast)        (L5)
//   • ResizeObserver          — Recharts ResponsiveContainer + Leaflet  (L6)
//   • Intl.RelativeTimeFormat — humanized "5 minutes ago" timestamps    (L7)
//   • CSS :has() selector     — emergent layout adjustments             (L8)
//   • structuredClone         — TanStack Query cache hydration          (L9)
// crypto.randomUUID is deliberately NOT required (L11-19) — it is restricted to
// secure contexts and routed through safeUUID; it is never probed. Dismissal is
// sticky-per-browser via a versioned localStorage key (L33-39).
//
// NATIVE ADAPTATION (contract rule 7 — browser-only behavior made native-safe):
//   • There is NO browser to be "too old" in React Native, and the native app
//     uses neither Recharts, Leaflet, a CSS engine, nor cross-tab broadcast — so
//     the three purely browser-platform probes are intentionally NOT part of the
//     native required-feature set and are documented here as an explicit
//     "not-applicable / unavailable" state rather than reported as missing:
//        - BroadcastChannel   (web L54-56) — native has no sibling tabs
//        - ResizeObserver     (web L58-60) — no Recharts/Leaflet sizing natively
//        - CSS @supports / :has()  (web L73-81) — no CSS engine on native
//     Reporting their (expected) absence on a healthy Hermes runtime would fire a
//     false "unsupported" warning, the opposite of the source's intent, so they
//     are excluded.
//   • The two genuinely cross-platform runtime requirements the native app DOES
//     share with the web SPA are still probed, with the identical defensive
//     try/catch structure and identical return strings:
//        - Intl.RelativeTimeFormat (web L62-71) — humanized timestamps
//        - structuredClone         (web L83-85) — TanStack Query cache hydration;
//          @tanstack/react-query IS installed in apps/native, so this is a real
//          native requirement.
//     On a healthy Hermes/Node runtime both are present, so detectMissingFeatures
//     returns [] ("supported") — the correct native outcome.
//   • localStorage (web L98, L112, L125) has no React Native analog and no
//     AsyncStorage / web-storage dependency is installed in apps/native, so the
//     dismissal flag lives in an in-process Map that mirrors the
//     getItem/setItem/removeItem string contract exactly (the established
//     useSidebarStyle / useChartLegendState / ThemeProvider precedent). The flag
//     round-trips within a session; it does NOT survive an app restart (durable,
//     sticky-per-browser persistence is a browser-only guarantee). The defensive
//     try/catch wrappers (web L97-101, L111-115, L124-128) are preserved verbatim
//     so the contract is identical even though the Map cannot throw.
//
// Detection stays synchronous + side-effect-free so it can run at module load,
// exactly like the web original (web L30-32). No DOM, window/localStorage,
// BroadcastChannel/ResizeObserver/CSS globals, Recharts, Leaflet, or web-UI
// imports reach this native output; the module has zero imports.

const STORAGE_KEY = 'teslasync:compat-warning-dismissed:v1';

// Native-safe replacement for the web `localStorage` persistence layer. Mirrors
// the getItem/setItem/removeItem string contract in an in-process Map. The
// dismissal value round-trips within the app session; it does not survive a
// restart (durable persistence is browser-only). Precedent: useSidebarStyle.ts,
// useChartLegendState.ts, ThemeProvider.tsx.
const nativeCompatStore = new Map<string, string>();

/**
 * Returns the list of REQUIRED features missing in the current native runtime.
 * Empty array means the runtime is supported.
 *
 * Only the cross-platform requirements the native app actually depends on are
 * probed: Intl.RelativeTimeFormat (humanized timestamps) and structuredClone
 * (TanStack Query cache hydration). The web SPA's three browser-only probes
 * (BroadcastChannel, ResizeObserver, CSS :has()) are intentionally excluded on
 * native — see the file header.
 *
 * Each detection is wrapped defensively because some host environments can throw
 * rather than return `undefined` when a global is queried. A throw must NOT crash
 * the boot sequence — it is itself evidence of incompatibility, so we record the
 * feature as missing and move on.
 */
export function detectMissingFeatures(): string[] {
  const missing: string[] = [];

  try {
    if (
      typeof Intl === 'undefined' ||
      typeof (Intl as {RelativeTimeFormat?: unknown}).RelativeTimeFormat ===
        'undefined'
    ) {
      missing.push('Intl.RelativeTimeFormat');
    }
  } catch {
    missing.push('Intl.RelativeTimeFormat');
  }

  if (
    typeof (globalThis as {structuredClone?: unknown}).structuredClone ===
    'undefined'
  ) {
    missing.push('structuredClone');
  }

  return missing;
}

/**
 * Reads the dismissed flag from the in-process store. Wrapped in try/catch to
 * preserve the web contract (Safari ITP / incognito throw on localStorage
 * access) — a throw means "we don't know if it was dismissed", and the safe
 * default is to show the banner.
 */
export function isCompatWarningDismissed(): boolean {
  try {
    return nativeCompatStore.get(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Persists the dismissal flag. Errors are swallowed exactly as on the web — the
 * user has already been told, so re-throwing would surface a storage error in a
 * banner about the very environment that is the source of the error.
 */
export function dismissCompatWarning(): void {
  try {
    nativeCompatStore.set(STORAGE_KEY, '1');
  } catch {
    /* parity with the web private-mode / quota guard — banner reappears on reload */
  }
}

/**
 * Test seam — clears the persisted dismissal so successive specs in the same
 * jest run get a clean slate. Production code never calls this; the symbol is
 * exported only to keep the storage key private.
 */
export function __resetCompatWarningForTests(): void {
  try {
    nativeCompatStore.delete(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const COMPAT_WARNING_STORAGE_KEY = STORAGE_KEY;
