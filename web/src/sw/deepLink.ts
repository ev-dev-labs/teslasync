/**
 * @module sw/deepLink
 *
 * Sanitiser for the `url` field of a Web Push payload (PWA-06).
 *
 * The push payload is server-supplied (`internal/webpush.Payload.URL`) and is
 * handed straight to `WindowClient.navigate()` / `clients.openWindow()` in the
 * `notificationclick` handler. That is an open-redirect sink: a malformed,
 * mis-templated, or hostile payload could navigate an authenticated PWA window
 * to an attacker origin, to `javascript:`, or to an app route that leaks the
 * wrong vehicle's data.
 *
 * The policy is deliberately paranoid and allowlist-only:
 *
 *   - resolve against our own origin and require the result to stay there;
 *   - require `https:`/`http:` (no `javascript:`, `data:`, `blob:`, `file:`);
 *   - match the pathname against a table of EXACT deep-link shapes — a
 *     vehicle, a drive, a charge session, an alert, the notification inbox,
 *     or the data-repair case workspace;
 *   - keep only a fixed set of context query parameters, each re-validated;
 *   - drop the fragment entirely.
 *
 * Anything that fails falls back to {@link NOTIFICATION_FALLBACK_URL}, which
 * is always safe: the user still lands in the app and can find the event.
 *
 * Pure module — no `self`, no DOM. Imported by `sw.ts` and unit-tested
 * directly.
 */

/** Where an unusable / rejected deep link lands instead. */
export const NOTIFICATION_FALLBACK_URL = '/notifications/inbox'

/**
 * Allowlisted deep-link shapes. `:id` matches one positive integer segment.
 *
 * Keep aligned with `web/src/lib/routeRegistry.ts` — a path that is not a real
 * route would dump the user on the 404 page, which is a worse outcome than
 * the inbox fallback.
 */
export const ALLOWED_DEEP_LINK_PATTERNS: readonly string[] = [
  '/',
  '/action-center',
  '/vehicles',
  '/vehicles/:id',
  '/vehicles/:id/access',
  '/drives',
  '/drives/:id',
  '/drives/:id/replay',
  '/charging',
  '/charging/:id',
  '/battery',
  '/data-repair',
  '/notifications/inbox',
  '/notifications/archived',
  '/notifications/alerts',
  '/notifications/channels',
  '/notifications/browser',
  '/notifications/quiet-hours',
  '/notifications/rules',
  '/notifications/audit',
  '/notifications/webhooks',
]

/**
 * Query parameters preserved on a deep link, with their validators.
 *
 * Everything else is dropped. In particular `redirect`, `next`, `return_to`,
 * `url` and friends are NOT here — carrying them would re-open the redirect
 * hole this module exists to close.
 */
const ALLOWED_QUERY_PARAMS: Record<string, (value: string) => boolean> = {
  /** Numeric vehicle id used by drill-through pages. */
  vehicle_id: isPositiveInt,
  /** Numeric alert id (`/notifications/alerts`). */
  alert: isPositiveInt,
  /** Numeric notification-log / event id (`/notifications/inbox`). */
  event: isPositiveInt,
  /** Numeric data-repair case id (`/data-repair`). */
  case: isPositiveInt,
  /** Numeric drive/charge id when the page keeps it in the query. */
  session: isPositiveInt,
  /** ISO-8601 instant used to centre time-series charts on the event. */
  t: isIsoInstant,
  /** Tesla Fleet Telemetry signal name, e.g. `BatteryLevel`. */
  signal: isSignalName,
}

const POSITIVE_INT = /^[1-9][0-9]{0,17}$/
const SIGNAL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/
// Control characters (including NUL, CR/LF and the C1 range) are rejected
// outright: they are never legitimate in a route and are the classic vector
// for header/URL splitting once the value is handed to `navigate()`.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

function isPositiveInt(value: string): boolean {
  return POSITIVE_INT.test(value)
}

function isSignalName(value: string): boolean {
  return SIGNAL_NAME.test(value)
}

function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value))
}

function matchesPattern(pathname: string, pattern: string): boolean {
  const actual = pathname.split('/')
  const expected = pattern.split('/')
  if (actual.length !== expected.length) return false
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] === ':id') {
      if (!POSITIVE_INT.test(actual[i])) return false
      continue
    }
    if (expected[i] !== actual[i]) return false
  }
  return true
}

/** Why a candidate deep link was rejected. Surfaced in SW logs and tests. */
export type DeepLinkRejection =
  | 'not-a-string'
  | 'empty'
  | 'control-characters'
  | 'unparseable'
  | 'foreign-origin'
  | 'unsupported-scheme'
  | 'route-not-allowlisted'

export interface DeepLinkResult {
  /** Always safe to navigate to. Falls back to the notification inbox. */
  url: string
  /** `true` when the incoming value survived validation unchanged in intent. */
  accepted: boolean
  rejection: DeepLinkRejection | null
  /** Query parameters that were stripped, for diagnostics. */
  droppedParams: string[]
}

/**
 * Validate and normalise a push-payload URL into a safe, same-origin,
 * allowlisted application path.
 *
 * @param raw    the untrusted `data.url` value from the push payload
 * @param origin the service worker's own origin (`self.location.origin`)
 */
export function sanitizeNotificationUrl(
  raw: unknown,
  origin: string,
): DeepLinkResult {
  const reject = (rejection: DeepLinkRejection): DeepLinkResult => ({
    url: NOTIFICATION_FALLBACK_URL,
    accepted: false,
    rejection,
    droppedParams: [],
  })

  if (typeof raw !== 'string') return reject('not-a-string')
  const trimmed = raw.trim()
  if (trimmed === '') return reject('empty')
  if (CONTROL_CHARS.test(trimmed)) return reject('control-characters')
  // Backslashes are normalised to `/` by several browsers' URL parsers, which
  // turns `/\evil.com` into a protocol-relative URL. Reject outright.
  if (trimmed.includes('\\')) return reject('foreign-origin')
  // Protocol-relative (`//evil.com/x`) resolves to a foreign origin against a
  // relative base. Caught by the origin check below too, but rejecting early
  // keeps the intent explicit.
  if (trimmed.startsWith('//')) return reject('foreign-origin')

  let parsed: URL
  try {
    parsed = new URL(trimmed, origin)
  } catch {
    return reject('unparseable')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return reject('unsupported-scheme')
  }
  if (parsed.origin !== origin) return reject('foreign-origin')

  // Collapse a trailing slash so `/vehicles/7/` and `/vehicles/7` agree,
  // but keep the site root as `/`.
  const pathname =
    parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname

  const allowed = ALLOWED_DEEP_LINK_PATTERNS.some((pattern) =>
    matchesPattern(pathname, pattern),
  )
  if (!allowed) return reject('route-not-allowlisted')

  const kept = new URLSearchParams()
  const droppedParams: string[] = []
  for (const [key, value] of parsed.searchParams) {
    const validate = Object.prototype.hasOwnProperty.call(
      ALLOWED_QUERY_PARAMS,
      key,
    )
      ? ALLOWED_QUERY_PARAMS[key]
      : undefined
    if (validate != null && validate(value) && !kept.has(key)) {
      kept.set(key, value)
    } else {
      droppedParams.push(key)
    }
  }

  const query = kept.toString()
  return {
    url: query === '' ? pathname : `${pathname}?${query}`,
    accepted: true,
    rejection: null,
    droppedParams,
  }
}
