import { resolveLocale } from './locale'

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const DIRECTION_MARKS = /[\u061c\u200e\u200f]/g

/**
 * Parse decimal input without guessing separators or silently repairing malformed
 * groups. Strict mode accepts ASCII decimal/scientific notation only.
 */
export function parseLocaleNumber(
  text: string,
  locale: string,
  options: { strict?: boolean } = {},
): number {
  const raw = text.trim()
  if (!raw) return NaN
  if (options.strict) return DECIMAL_NUMBER.test(raw) ? Number(raw) : NaN

  let formatter: Intl.NumberFormat
  try {
    formatter = new Intl.NumberFormat(resolveLocale(locale))
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    formatter = new Intl.NumberFormat('en-US')
  }

  const digits = Array.from({ length: 10 }, (_, digit) =>
    formatter.format(digit).replace(DIRECTION_MARKS, ''),
  )
  const normalizeDigits = (value: string) => digits.reduce(
    (result, digit, index) => result.split(digit).join(String(index)),
    value,
  )
  const parts = formatter.formatToParts(1_234_567_890_123.5)
  const group = parts.find(part => part.type === 'group')?.value ?? ''
  const decimal = parts.find(part => part.type === 'decimal')?.value ?? '.'
  const minus = formatter.formatToParts(-1).find(part => part.type === 'minusSign')?.value ?? '-'
  let normalized = normalizeDigits(raw.replace(DIRECTION_MARKS, ''))
    .split(minus).join('-')
    .replace(/\u2212/g, '-')

  // French and other space-grouping locales must accept ordinary pasted spaces,
  // but they still need to satisfy the locale's group widths.
  if (group && /^[ \u00a0\u202f]+$/.test(group)) {
    normalized = normalized.replace(/[ \u00a0\u202f]/g, group)
  }
  const [mantissa, exponent, ...extraExponents] = normalized.split(/[eE]/)
  if (extraExponents.length || (exponent !== undefined && !/^[+-]?\d+$/.test(exponent))) {
    return NaN
  }
  const [integer, fraction, ...extraDecimals] = mantissa.split(decimal)
  if (extraDecimals.length || (fraction !== undefined && !/^\d*$/.test(fraction))) {
    return NaN
  }

  let ungroupedInteger = integer
  if (group && integer.includes(group)) {
    const sign = /^[+-]/.test(integer) ? integer[0] : ''
    const groups = integer.slice(sign.length).split(group)
    const widths = parts.filter(part => part.type === 'integer')
      .map(part => normalizeDigits(part.value).length)
    const primary = widths[widths.length - 1]
    const secondary = widths[widths.length - 2] ?? primary
    if (
      !groups.every(part => /^\d+$/.test(part)) ||
      groups[0].length > secondary ||
      groups[groups.length - 1].length !== primary ||
      groups.slice(1, -1).some(part => part.length !== secondary)
    ) {
      return NaN
    }
    ungroupedInteger = sign + groups.join('')
  }

  const canonical = ungroupedInteger +
    (fraction !== undefined ? `.${fraction}` : '') +
    (exponent !== undefined ? `e${exponent}` : '')
  return DECIMAL_NUMBER.test(canonical) ? Number(canonical) : NaN
}
