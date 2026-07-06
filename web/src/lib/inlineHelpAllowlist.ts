/**
 * Inline-help allowlist.
 *
 * i18n keys for form-field labels that are explicitly "no-help-needed" —
 * either the field name is universally understood (e.g. "Name", "Email")
 * or surrounding hint text already explains it. Pages on the inline-help
 * audit's enforced list can list a label key here to silence the
 * `MISSING_HELP[…]` warning without adding a `<HelpIcon>` next to it.
 *
 * Keep this list short — most fields benefit from inline help, and the
 * allowlist exists to absorb truly self-evident cases (not as a way to
 * skip the work of writing a help string).
 *
 * The audit script `web/scripts/audit-inline-help.mjs` consumes this
 * list when computing per-page coverage.
 */
// NOTE: keep this `as const` with NO explicit `: readonly string[]` annotation.
// An explicit array-type annotation would widen `typeof INLINE_HELP_ALLOWLIST`
// back to `readonly string[]`, silently collapsing `InlineHelpAllowedKey` to
// plain `string` and throwing away the literal-union type-safety this module
// exists to provide.
export const INLINE_HELP_ALLOWLIST = [
  // Self-evident form fields — universally understood, no help needed.
  'automations.builder.name',
  'automations.builder.description',
  'notifications.alertStudio.editor.nameLabel',
  'notifications.alertStudio.editor.namePlaceholder',
  'notifications.channels.nameLabel',
  // Trivial enabled/disabled toggles — the toggle UI itself is the explanation.
  'automations.builder.enabled',
  'notifications.alertStudio.editor.enabledLabel',
  'notifications.channels.enabled',
  'notifications.channels.disabled',
] as const;

export type InlineHelpAllowedKey = (typeof INLINE_HELP_ALLOWLIST)[number];

// Widened to `ReadonlySet<string>` so `isInlineHelpAllowed` can accept an
// arbitrary `string` (an `as const` tuple's `.includes` would reject anything
// outside the literal union). Also turns the membership check into an O(1)
// lookup instead of a linear scan.
const ALLOWED_KEYS: ReadonlySet<string> = new Set(INLINE_HELP_ALLOWLIST);

/** Convenience helper for tests / audit script — case-sensitive exact match. */
export function isInlineHelpAllowed(i18nKey: string): boolean {
  return ALLOWED_KEYS.has(i18nKey);
}
