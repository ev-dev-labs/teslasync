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
 *                 the file. Prefer specific names. See
 *                 `TOUCH_TARGET_ELEMENTS` for the canonical set.
 *  • `reason`   — non-empty justification. The gate refuses entries with
 *                 an empty `reason` (enforced at runtime by
 *                 `validateTouchTargetWaiver`).
 */

/**
 * The canonical set of element identifiers a waiver may target. Kept as a
 * runtime tuple so the compile-time union (`TouchTargetElement`) and the
 * runtime validation in `validateTouchTargetWaiver` cannot drift apart.
 *
 * `'*'` is the wildcard — it waives every clickable element in the file.
 */
export const TOUCH_TARGET_ELEMENTS = ['*', 'Button', 'IconButton', 'button', 'a'] as const;

export type TouchTargetElement = (typeof TOUCH_TARGET_ELEMENTS)[number];

export interface TouchTargetWaiver {
  file: string;
  element: TouchTargetElement;
  reason: string;
}

export const TOUCH_TARGET_ALLOWLIST: TouchTargetWaiver[] = [
  // intentionally empty at adoption time; entries justify themselves
];

/**
 * Canonical waiver matcher — the single source of truth for "is this
 * (file, element) pair exempt from the touch-target audit?".
 *
 * Mirrors the semantics documented in the file header and implemented by
 * the `audit:touch-target` node script (which cannot import this module
 * because it runs as a dependency-free `.mjs`). Keep the two in lock-step.
 *
 *  • `filePath` is normalised to POSIX separators so Windows-style
 *    repo-relative paths still match POSIX waiver suffixes.
 *  • A waiver matches when the (normalised) path equals the waiver file,
 *    ends with `'/' + waiverFile`, or ends with the bare `waiverFile`
 *    suffix — the last form intentionally supports terse suffixes, so
 *    always pick a suffix specific enough to identify one file.
 *  • An empty waiver `file` never matches: without this guard
 *    `''.endsWith('')` would silently waive the entire codebase.
 */
export function isTouchTargetWaived(
  filePath: string,
  elementName: string,
  allowlist: readonly TouchTargetWaiver[] = TOUCH_TARGET_ALLOWLIST,
): boolean {
  const norm = (filePath ?? '').replace(/\\/g, '/');
  return allowlist.some((waiver) => {
    const waiverFile = (waiver.file ?? '').replace(/\\/g, '/');
    if (waiverFile === '') return false;
    const fileMatch =
      norm === waiverFile ||
      norm.endsWith(`/${waiverFile}`) ||
      norm.endsWith(waiverFile);
    const elementMatch = waiver.element === '*' || waiver.element === elementName;
    return fileMatch && elementMatch;
  });
}

/**
 * Validate a single waiver against the invariants the audit gate relies
 * on. Returns a (possibly empty) list of human-readable problems — an
 * empty array means the waiver is well-formed.
 *
 * Encoded here so the header's documented rules (non-empty `file`, a
 * known `element`, and a non-empty `reason`) are executable and testable
 * rather than prose-only.
 */
export function validateTouchTargetWaiver(waiver: TouchTargetWaiver): string[] {
  const problems: string[] = [];
  if (!waiver?.file || waiver.file.trim() === '') {
    problems.push('file must be a non-empty repo-relative path suffix');
  }
  if (!TOUCH_TARGET_ELEMENTS.includes(waiver?.element)) {
    problems.push(`element must be one of ${TOUCH_TARGET_ELEMENTS.join(' | ')}`);
  }
  if (!waiver?.reason || waiver.reason.trim() === '') {
    problems.push('reason must be a non-empty justification');
  }
  return problems;
}

/**
 * Return every malformed entry in an allowlist together with its index and
 * the specific problems found. Intended as a CI/unit guard so a waiver
 * added with an empty `reason` (or a typo'd `element`) fails fast instead
 * of silently disabling the audit for that element.
 */
export function findInvalidWaivers(
  allowlist: readonly TouchTargetWaiver[] = TOUCH_TARGET_ALLOWLIST,
): Array<{ index: number; waiver: TouchTargetWaiver; problems: string[] }> {
  const invalid: Array<{ index: number; waiver: TouchTargetWaiver; problems: string[] }> = [];
  allowlist.forEach((waiver, index) => {
    const problems = validateTouchTargetWaiver(waiver);
    if (problems.length > 0) invalid.push({ index, waiver, problems });
  });
  return invalid;
}
