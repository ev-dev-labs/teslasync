/**
 * Masked-value privacy primitive helpers.
 *
 * Pure functions that compute the masked display string for sensitive
 * values. Kept separate from the React component so the masking logic
 * is unit-testable without rendering and reusable from non-React paths
 * (for example, structured logging that needs a redacted form).
 *
 * Variants and their default visible-suffix lengths:
 *
 *   - `token`   — opaque API/auth tokens (shows last 4 chars)
 *   - `vin`     — Tesla 17-char VIN (shows the VIN prefix `5YJ` plus
 *                 the last 4 of the serial when the VIN is the
 *                 expected length, otherwise generic-mask)
 *   - `coords`  — `lat,lng` pair rendered as `••.•••, ••.•••`; if a
 *                 single number is passed it is also masked
 *   - `email`   — local-part is masked while the domain stays visible
 *                 (`j•••@example.com`)
 *   - `generic` — bullet repeating to length, `showLast` chars visible
 *
 * The bullet character is U+2022 (•). All variants accept a `showLast`
 * override for callers that need to expose more or fewer characters.
 *
 * Why these exact rules:
 *
 *   - Last-4 is the long-standing industry pattern (credit cards,
 *     Stripe API keys, GitHub PATs) — enough disambiguation for the
 *     owner without leaking enough to the shoulder-surfer to be
 *     useful on its own.
 *   - VIN prefix is a manufacturer code, not user-identifying. Showing
 *     `5YJ` keeps the mask readable as "a Tesla VIN" without exposing
 *     the serial.
 *   - Coordinates round to whole-degree-only context which is hundreds
 *     of kilometres of uncertainty — useful as "yes, this row exists"
 *     without leaking a parking spot.
 */

/** UnmaskedValue is just the raw input — kept as a name so callers can
 *  document intent at the call site. */
export type UnmaskedValue = string

/**
 * MaskVariant selects the masking strategy. Adding a variant requires
 * updating both `maskFor()` and the `<MaskedValue>` component's
 * default-show-last table.
 */
export type MaskVariant = 'token' | 'vin' | 'coords' | 'email' | 'generic'

const BULLET = '\u2022'
const SEPARATOR = ', '

/**
 * Default number of trailing characters visible per variant.
 * Callers may override with the `showLast` argument.
 *
 * The defaults intentionally err on the side of less-visible: any
 * caller that wants a longer suffix has to ask for it explicitly.
 */
export const DEFAULT_SHOW_LAST: Record<MaskVariant, number> = {
  token: 4,
  vin: 4,
  coords: 0,
  email: 1,
  generic: 0,
}

function bullets(count: number): string {
  if (count <= 0) return ''
  return BULLET.repeat(count)
}

function maskGeneric(value: string, showLast: number): string {
  if (value.length === 0) return ''
  const visible = Math.max(0, Math.min(showLast, value.length))
  const hidden = value.length - visible
  return bullets(hidden) + value.slice(value.length - visible)
}

function maskToken(value: string, showLast: number): string {
  if (value.length === 0) return ''
  const visible = Math.max(0, Math.min(showLast, value.length))
  // Tokens always render a fixed-length bullet run so the masked form
  // does not leak the original length (a 16-char token and a 64-char
  // token must look the same when masked).
  return bullets(12) + value.slice(value.length - visible)
}

function maskVin(value: string, showLast: number): string {
  if (value.length === 0) return ''
  // Tesla VINs are 17 characters; a typical first three are the WMI
  // ("5YJ"). When the input matches the expected shape we expose the
  // WMI plus the last 4; otherwise we fall back to a fully-bulleted
  // mask — short inputs almost certainly aren't real VINs and showing
  // the WMI of a 3-char string would expose the entire input.
  if (value.length === 17) {
    const visibleSuffix = Math.max(0, Math.min(showLast, value.length - 3))
    const hidden = value.length - 3 - visibleSuffix
    return value.slice(0, 3) + bullets(hidden) + value.slice(value.length - visibleSuffix)
  }
  return bullets(value.length)
}

function maskEmail(value: string, showLast: number): string {
  const at = value.indexOf('@')
  if (at <= 0) return maskGeneric(value, Math.max(showLast, 0))
  const local = value.slice(0, at)
  const domain = value.slice(at)
  const visible = Math.max(0, Math.min(showLast, local.length))
  const masked = local.slice(0, visible) + bullets(Math.max(local.length - visible, 1))
  return masked + domain
}

/**
 * coords accepts:
 *   - "<lat>,<lng>"  → `••.•••, ••.•••`
 *   - "<num>"        → `••.•••`
 *   - anything else  → generic mask
 */
function maskCoords(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  const parts = trimmed.split(',').map((p) => p.trim()).filter((p) => p.length > 0)
  if (parts.length === 0) return ''
  const numeric = parts.every((p) => Number.isFinite(Number(p)))
  if (!numeric) return maskGeneric(trimmed, 0)
  return parts.map(() => `${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`).join(SEPARATOR)
}

/**
 * maskFor returns the user-visible masked representation of `value`.
 *
 * The function is pure and total: it never throws, even on empty
 * strings or unexpected variants — callers can wrap render paths in
 * it without adding null checks. An unknown variant is treated as
 * `generic`.
 */
export function maskFor(
  value: UnmaskedValue,
  variant: MaskVariant,
  showLast?: number,
): string {
  if (value == null) return ''
  const last = showLast ?? DEFAULT_SHOW_LAST[variant] ?? 0
  switch (variant) {
    case 'token':
      return maskToken(value, last)
    case 'vin':
      return maskVin(value, last)
    case 'coords':
      return maskCoords(value)
    case 'email':
      return maskEmail(value, last)
    case 'generic':
    default:
      return maskGeneric(value, last)
  }
}
