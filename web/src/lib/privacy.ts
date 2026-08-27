/**
 * Browser-side privacy boundary for diagnostics and local exports.
 *
 * This is deliberately conservative: error reports and support attachments
 * are not data exports, so a false positive is safer than sending vehicle,
 * identity, or credential data to server-side logs.
 */

const REDACTED = '[REDACTED]'
const SENSITIVE_FIELD = /(?:^|_)(access_token|access_key|account_key|api_key|auth|authorization|cookie|email|id_token|keys|latitude|longitude|location|p256dh|password|private_key|refresh_token|secret|signing_key|subject|token|user_key|vin|key)(?:$|_)/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi
const JWT = /\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\b/gi
const BEARER = /\bBearer\s+[A-Z0-9._~+/=-]{8,}/gi
const QUERY_SECRET = /([?&#](?:access_token|access_key|account_key|api_key|auth|authorization|key|keys|p256dh|password|private_key|refresh_token|secret|signing_key|token|user_key)=[^&#\s]*)/gi
const KEY_VALUE_SECRET = /((?:^|[,{[\s])["']?(?:access[_-]?token|access[_-]?key|account[_-]?key|api[_-]?key|auth|authorization|cookie|id[_-]?token|key|keys|p256dh|password|private[_-]?key|refresh[_-]?token|secret|signing[_-]?key|token|user[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi
const COORDINATE_PAIR = /\b-?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)\s*,\s*-?(?:(?:1[0-7]\d|[1-9]?\d)(?:\.\d+)?|180(?:\.0+)?)\b/g

/** Returns true when a field name conventionally carries private data. */
export function isSensitiveFieldName(field: string): boolean {
  const normalized = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_')
  return SENSITIVE_FIELD.test(normalized)
}

/**
 * Redacts credentials, VINs, emails, and precise coordinate pairs from text
 * before it enters telemetry, support bundles, or the clipboard.
 */
export function redactSensitiveText(value: string): string {
  if (!value) return value

  return value
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, REDACTED)
    .replace(KEY_VALUE_SECRET, `$1${REDACTED}`)
    .replace(QUERY_SECRET, (match) => {
      const separator = match.slice(0, 1)
      const equals = match.indexOf('=')
      return `${separator}${match.slice(1, equals)}=${REDACTED}`
    })
    .replace(EMAIL, '[EMAIL_REDACTED]')
    .replace(VIN, '[VIN_REDACTED]')
    .replace(COORDINATE_PAIR, '[LOCATION_REDACTED]')
}

/**
 * Produces a deep copy suitable for a local export or support attachment.
 * Sensitive field names are replaced entirely, while free-form text is
 * scanned for embedded credentials and identifiers.
 */
export function redactSensitiveData(value: unknown, fieldName = ''): unknown {
  if (isSensitiveFieldName(fieldName)) return REDACTED
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactSensitiveData(item, key),
      ]),
    )
  }
  return value
}

/** Redacts a value based on its export column key without changing safe data. */
export function redactExportValue(fieldName: string, value: unknown): unknown {
  return redactSensitiveData(value, fieldName)
}
