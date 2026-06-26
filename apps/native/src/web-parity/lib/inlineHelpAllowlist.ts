/**
 * Native parity port of web/src/lib/inlineHelpAllowlist.ts.
 *
 * Pure, non-visual data/utility module. There is no DOM, JSX, Recharts, Leaflet,
 * or browser-only behavior here — the module is a frozen array of i18n key
 * strings, a derived string-literal union type, and a single pure membership
 * helper. Every construct ports byte-for-byte and behaves identically under
 * React Native, so no native-safe shim is required. The i18n keys are preserved
 * verbatim to keep the allowlist semantics (and the web audit script's coverage
 * math) in lockstep with the web source.
 */

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
export const INLINE_HELP_ALLOWLIST: readonly string[] = [
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

/** Convenience helper for tests / audit script — case-sensitive exact match. */
export function isInlineHelpAllowed(i18nKey: string): boolean {
  return INLINE_HELP_ALLOWLIST.includes(i18nKey);
}
