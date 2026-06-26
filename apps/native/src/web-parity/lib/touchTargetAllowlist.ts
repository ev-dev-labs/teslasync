// Native parity port of web/src/lib/touchTargetAllowlist.ts.
//
// Pure, DOM-free type + data module. There is no browser, React, HTML,
// Recharts, Leaflet or web-UI dependency to strip — the file declares one
// interface and one (empty) const array, so this is a faithful 1:1 port (the
// contract's "non-visual utility/type code -> port the logic/types faithfully"
// path, matching the existing lib parity ports gear.ts / chartA11y.ts which
// preserve their types and values byte-for-byte). The `element` union keeps the
// web audit's literal names ('Button' | 'IconButton' | 'button' | 'a' | '*')
// verbatim because they are the type contract for the cross-platform
// `audit:touch-target` waiver list, not rendered elements; the array stays
// intentionally empty. Only native formatting was applied (the source already
// matches the native prettier config: single quotes, trailing commas).

/**
 * Touch-target audit explicit waivers (WCAG 2.5.5).
 *
 * Each entry exempts a specific clickable element from the
 * `audit:touch-target` minimum-hit-area check. Allowlisting should be a
 * last resort — if the element can be made larger, do that instead.
 *
 * Review every entry quarterly: stale waivers tend to hide regressions.
 *
 * Match semantics:
 *  • `file`     — repo-relative POSIX path that ENDS with this string. Use
 *                 the most specific suffix that still uniquely identifies
 *                 the file (e.g. `features/notifications/components/X.tsx`).
 *  • `element`  — element name (e.g. `'Button'`, `'button'`, `'a'`,
 *                 `'IconButton'`) or `'*'` to waive every element in
 *                 the file. Prefer specific names.
 *  • `reason`   — non-empty justification. The gate refuses entries with
 *                 an empty `reason`.
 */
export interface TouchTargetWaiver {
  file: string;
  element: '*' | 'Button' | 'IconButton' | 'button' | 'a';
  reason: string;
}

export const TOUCH_TARGET_ALLOWLIST: TouchTargetWaiver[] = [
  // intentionally empty at adoption time; entries justify themselves
];
