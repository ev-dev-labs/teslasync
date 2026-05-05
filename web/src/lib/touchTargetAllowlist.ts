/**
 * Phase-46 / Prompt 69 — Touch-target audit explicit waivers (WCAG 2.5.5).
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
