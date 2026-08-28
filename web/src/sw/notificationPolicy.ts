/**
 * @module sw/notificationPolicy
 *
 * Device-scoped notification preferences and the pure decision function the
 * service worker applies to every incoming push (PWA-05).
 *
 * ## Where this sits relative to the server
 *
 * The backend already owns two enforcement layers and they remain
 * authoritative:
 *
 *   - **Category / event-type routing** — `notification_preferences`
 *     (`GET|PUT /api/v1/notifications/{channelID}/preferences`, surfaced by
 *     `useNotificationPreferences` / `useUpdateNotificationPreference`).
 *   - **Quiet hours with severity bypass** — `notification_quiet_hours`
 *     (`/api/v1/notifications/quiet-hours`, surfaced by `useQuietHours`).
 *
 * Those are *install-wide*. A phone, a tablet, and a desktop that all
 * subscribed to Web Push share one server-side configuration, so there is no
 * server route that can express "critical only on my phone" or "only my
 * daily driver on this device". This module is that missing per-device layer,
 * and it is enforced in the service worker because the SW is the only code
 * that runs when the tab is closed.
 *
 * ## Honest limits of device-side filtering
 *
 *  - A suppressed push still consumed a push message. Chrome grants a limited
 *    "silent push budget"; a worker that repeatedly declines to show anything
 *    will eventually have the browser show a generic *"…is running in the
 *    background"* notification on its behalf. To stay well inside that budget
 *    the quiet-hours path degrades to a SILENT notification rather than to no
 *    notification at all, and only explicit category / severity / vehicle
 *    mutes suppress fully.
 *  - Anything already filtered server-side never reaches this code.
 *
 * Pure module — no `self`, no storage, no clock of its own. The caller passes
 * the instant so quiet-hours behaviour is deterministic in tests.
 */

/** Wire severities used across alerts, notification logs and push payloads. */
export const NOTIFICATION_SEVERITIES = ['info', 'warn', 'critical'] as const
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

/**
 * Coarse delivery categories the device layer can mute independently.
 *
 * Mapped from the push payload's `category` when the backend supplies one,
 * otherwise inferred from the notification `tag` prefix, which the dispatcher
 * already namespaces (`alert-…`, `drive-…`, `charge-…`, `export-…`).
 */
export const NOTIFICATION_CATEGORIES = [
  'alert',
  'charging',
  'drive',
  'battery',
  'security',
  'system',
  'export',
  'other',
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

/** Bit positions match Go's `time.Weekday` (Sun = 0) and `models.QuietHours*`. */
export const WEEKDAY_ALL = 0b111_1111

export interface DeviceQuietHours {
  enabled: boolean
  /** Local wall clock `HH:MM`. */
  startLocal: string
  /** Local wall clock `HH:MM`. Wraps past midnight when `<= startLocal`. */
  endLocal: string
  /** Bitmask, Sun = 1 … Sat = 64. */
  weekdays: number
  /** Severities that ring through the window anyway. */
  bypassSeverities: NotificationSeverity[]
}

export interface DeviceNotificationPrefs {
  version: 1
  /** Master switch for OS-level delivery on THIS device. */
  enabled: boolean
  /** Per-category mutes. */
  categories: Record<NotificationCategory, boolean>
  /** Lowest severity that may raise an OS notification on this device. */
  minSeverity: NotificationSeverity
  /** `all` ignores {@link DeviceNotificationPrefs.vehicleIds}. */
  vehicleScope: 'all' | 'selected'
  /** Vehicle ids allowed through when `vehicleScope === 'selected'`. */
  vehicleIds: number[]
  quietHours: DeviceQuietHours
}

export const DEVICE_NOTIFICATION_PREFS_VERSION = 1

export const DEFAULT_DEVICE_NOTIFICATION_PREFS: Readonly<DeviceNotificationPrefs> =
  Object.freeze({
    version: DEVICE_NOTIFICATION_PREFS_VERSION,
    enabled: true,
    categories: Object.freeze({
      alert: true,
      charging: true,
      drive: true,
      battery: true,
      security: true,
      system: true,
      export: true,
      other: true,
    }) as Record<NotificationCategory, boolean>,
    minSeverity: 'info',
    vehicleScope: 'all',
    vehicleIds: Object.freeze([]) as unknown as number[],
    quietHours: Object.freeze({
      enabled: false,
      startLocal: '22:00',
      endLocal: '07:00',
      weekdays: WEEKDAY_ALL,
      bypassSeverities: Object.freeze(['critical']) as unknown as NotificationSeverity[],
    }) as DeviceQuietHours,
  })

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  warn: 1,
  critical: 2,
}

const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/

/** Normalise an arbitrary wire severity onto the three known levels. */
export function normalizeSeverity(value: unknown): NotificationSeverity {
  if (typeof value !== 'string') return 'info'
  const lower = value.trim().toLowerCase()
  if (lower === 'critical' || lower === 'error' || lower === 'fatal') {
    return 'critical'
  }
  if (lower === 'warn' || lower === 'warning') return 'warn'
  return 'info'
}

/** Numeric rank so severities can be compared with `>=`. */
export function severityRank(value: NotificationSeverity): number {
  return SEVERITY_RANK[value]
}

/** Minimal structural view of the push payload this policy needs. */
export interface NotificationPayloadLike {
  severity?: unknown
  category?: unknown
  tag?: unknown
  vehicleId?: unknown
  vehicle_id?: unknown
  url?: unknown
}

const TAG_CATEGORY_PREFIXES: ReadonlyArray<[string, NotificationCategory]> = [
  ['alert', 'alert'],
  ['charge', 'charging'],
  ['charging', 'charging'],
  ['drive', 'drive'],
  ['trip', 'drive'],
  ['battery', 'battery'],
  ['security', 'security'],
  ['sentry', 'security'],
  ['system', 'system'],
  ['export', 'export'],
]

function isCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === 'string'
    && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  )
}

/**
 * Resolve the delivery category of a payload.
 *
 * Prefers an explicit `category` field (forward-compatible with a future
 * backend that sends one), then the `tag` prefix the dispatcher already
 * emits, then `other`.
 */
export function categoryFromPayload(
  payload: NotificationPayloadLike,
): NotificationCategory {
  if (isCategory(payload.category)) return payload.category
  if (typeof payload.tag === 'string') {
    // Avoid a character class here: Tailwind treats class-like regex tokens as arbitrary CSS utilities.
    const head = payload.tag.split(/(?:-|:|_)/, 1)[0]?.toLowerCase() ?? ''
    for (const [prefix, category] of TAG_CATEGORY_PREFIXES) {
      if (head === prefix) return category
    }
  }
  return 'other'
}

/**
 * Resolve the vehicle a payload refers to, or `null` when it is fleet-wide.
 * Reads `vehicleId`, `vehicle_id`, and finally a `vehicle_id` query parameter
 * on the drill-through URL, which is how the current dispatcher carries it.
 */
export function vehicleIdFromPayload(
  payload: NotificationPayloadLike,
): number | null {
  const direct = payload.vehicleId ?? payload.vehicle_id
  if (typeof direct === 'number' && Number.isInteger(direct) && direct > 0) {
    return direct
  }
  if (typeof direct === 'string' && /^[1-9][0-9]*$/.test(direct)) {
    return Number(direct)
  }
  if (typeof payload.url === 'string') {
    const vehiclePath = /^\/vehicles\/([1-9][0-9]*)(?:[/?#]|$)/.exec(payload.url)
    if (vehiclePath) return Number(vehiclePath[1])
    const query = /[?&]vehicle_id=([1-9][0-9]*)(?:&|$)/.exec(payload.url)
    if (query) return Number(query[1])
  }
  return null
}

function sanitizeSeverityList(value: unknown): NotificationSeverity[] {
  if (!Array.isArray(value)) return ['critical']
  const out: NotificationSeverity[] = []
  for (const entry of value) {
    const severity = normalizeSeverity(entry)
    if (!out.includes(severity)) out.push(severity)
  }
  return out
}

function sanitizeVehicleIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const entry of value) {
    const id = typeof entry === 'number' ? entry : Number(entry)
    if (Number.isInteger(id) && id > 0 && !out.includes(id)) out.push(id)
  }
  return out.sort((a, b) => a - b)
}

function sanitizeHHMM(value: unknown, fallback: string): string {
  return typeof value === 'string' && HHMM.test(value) ? value : fallback
}

/**
 * Coerce untrusted JSON (localStorage, a `postMessage` from a page, a Cache
 * Storage entry written by an older build) into a valid preferences object.
 * Never throws; unknown/corrupt fields fall back to the shipped defaults.
 */
export function sanitizeDeviceNotificationPrefs(
  raw: unknown,
): DeviceNotificationPrefs {
  const defaults = DEFAULT_DEVICE_NOTIFICATION_PREFS
  if (typeof raw !== 'object' || raw === null) {
    return cloneDefaults()
  }
  const candidate = raw as Record<string, unknown>
  const rawCategories =
    typeof candidate.categories === 'object' && candidate.categories !== null
      ? (candidate.categories as Record<string, unknown>)
      : {}

  const categories = {} as Record<NotificationCategory, boolean>
  for (const category of NOTIFICATION_CATEGORIES) {
    categories[category] =
      typeof rawCategories[category] === 'boolean'
        ? (rawCategories[category] as boolean)
        : defaults.categories[category]
  }

  const rawQuiet =
    typeof candidate.quietHours === 'object' && candidate.quietHours !== null
      ? (candidate.quietHours as Record<string, unknown>)
      : {}

  const weekdays =
    typeof rawQuiet.weekdays === 'number'
      && Number.isInteger(rawQuiet.weekdays)
      && rawQuiet.weekdays >= 0
      && rawQuiet.weekdays <= WEEKDAY_ALL
      ? rawQuiet.weekdays
      : WEEKDAY_ALL

  return {
    version: DEVICE_NOTIFICATION_PREFS_VERSION,
    enabled:
      typeof candidate.enabled === 'boolean' ? candidate.enabled : defaults.enabled,
    categories,
    minSeverity: (NOTIFICATION_SEVERITIES as readonly string[]).includes(
      candidate.minSeverity as string,
    )
      ? (candidate.minSeverity as NotificationSeverity)
      : defaults.minSeverity,
    vehicleScope: candidate.vehicleScope === 'selected' ? 'selected' : 'all',
    vehicleIds: sanitizeVehicleIds(candidate.vehicleIds),
    quietHours: {
      enabled:
        typeof rawQuiet.enabled === 'boolean'
          ? rawQuiet.enabled
          : defaults.quietHours.enabled,
      startLocal: sanitizeHHMM(rawQuiet.startLocal, defaults.quietHours.startLocal),
      endLocal: sanitizeHHMM(rawQuiet.endLocal, defaults.quietHours.endLocal),
      weekdays,
      bypassSeverities: sanitizeSeverityList(rawQuiet.bypassSeverities),
    },
  }
}

function cloneDefaults(): DeviceNotificationPrefs {
  const d = DEFAULT_DEVICE_NOTIFICATION_PREFS
  return {
    version: DEVICE_NOTIFICATION_PREFS_VERSION,
    enabled: d.enabled,
    categories: { ...d.categories },
    minSeverity: d.minSeverity,
    vehicleScope: d.vehicleScope,
    vehicleIds: [],
    quietHours: {
      ...d.quietHours,
      bypassSeverities: [...d.quietHours.bypassSeverities],
    },
  }
}

function toMinutes(hhmm: string): number {
  const match = HHMM.exec(hhmm)
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * `true` when `minutes` on `weekday` falls inside the configured window.
 *
 * Mirrors the Go dispatcher exactly (`internal/notification/quiet_hours.go`):
 * when `end <= start` the window wraps past midnight and the weekday mask is
 * matched against the day the window STARTED on.
 */
export function isWithinQuietHours(
  quiet: DeviceQuietHours,
  weekday: number,
  minutes: number,
): boolean {
  if (!quiet.enabled) return false
  const start = toMinutes(quiet.startLocal)
  const end = toMinutes(quiet.endLocal)
  const dayBit = 1 << weekday
  const previousDayBit = 1 << ((weekday + 6) % 7)

  if (end > start) {
    if ((quiet.weekdays & dayBit) === 0) return false
    return minutes >= start && minutes < end
  }
  // Wrapping window: the tail before midnight belongs to today's bit, the
  // head after midnight belongs to yesterday's bit.
  if (minutes >= start) return (quiet.weekdays & dayBit) !== 0
  if (minutes < end) return (quiet.weekdays & previousDayBit) !== 0
  return false
}

/** Why the SW showed, silenced, or suppressed a push. */
export type NotificationDecisionReason =
  | 'delivered'
  | 'device-disabled'
  | 'category-muted'
  | 'below-min-severity'
  | 'vehicle-out-of-scope'
  | 'quiet-hours-silenced'
  | 'quiet-hours-bypassed'

export interface NotificationDecision {
  /** `false` means `showNotification` is skipped entirely. */
  show: boolean
  /** `true` renders without sound/vibration (quiet hours). */
  silent: boolean
  /** Critical alerts stick on screen until tapped. */
  requireInteraction: boolean
  reason: NotificationDecisionReason
  category: NotificationCategory
  severity: NotificationSeverity
  vehicleId: number | null
}

export interface EvaluateNotificationOptions {
  /** Local weekday, `0` = Sunday. Defaults to the local weekday of `nowMs`. */
  weekday?: number
  /** Local minutes past midnight. Defaults to the local time of `nowMs`. */
  minutesOfDay?: number
}

/**
 * Apply the device policy to one push payload.
 *
 * Evaluation order is significant and is asserted by the tests:
 *
 *   1. master switch,
 *   2. category mute,
 *   3. minimum severity,
 *   4. vehicle scope,
 *   5. quiet hours (silences rather than suppresses; bypass severities ring).
 *
 * A payload with no resolvable vehicle is treated as fleet-wide and is never
 * filtered by vehicle scope — suppressing "Fleet telemetry offline" because
 * it lacks a vehicle id would hide exactly the alerts that matter most.
 */
export function evaluateNotification(
  payload: NotificationPayloadLike,
  prefs: DeviceNotificationPrefs,
  nowMs: number,
  options: EvaluateNotificationOptions = {},
): NotificationDecision {
  const severity = normalizeSeverity(payload.severity)
  const category = categoryFromPayload(payload)
  const vehicleId = vehicleIdFromPayload(payload)
  const base = { category, severity, vehicleId }

  if (!prefs.enabled) {
    return { ...base, show: false, silent: false, requireInteraction: false, reason: 'device-disabled' }
  }
  if (prefs.categories[category] === false) {
    return { ...base, show: false, silent: false, requireInteraction: false, reason: 'category-muted' }
  }
  if (severityRank(severity) < severityRank(prefs.minSeverity)) {
    return { ...base, show: false, silent: false, requireInteraction: false, reason: 'below-min-severity' }
  }
  if (
    prefs.vehicleScope === 'selected'
    && vehicleId != null
    && !prefs.vehicleIds.includes(vehicleId)
  ) {
    return { ...base, show: false, silent: false, requireInteraction: false, reason: 'vehicle-out-of-scope' }
  }

  const requireInteraction = severity === 'critical'
  const now = new Date(nowMs)
  const weekday = options.weekday ?? now.getDay()
  const minutesOfDay =
    options.minutesOfDay ?? now.getHours() * 60 + now.getMinutes()

  if (isWithinQuietHours(prefs.quietHours, weekday, minutesOfDay)) {
    if (prefs.quietHours.bypassSeverities.includes(severity)) {
      return { ...base, show: true, silent: false, requireInteraction, reason: 'quiet-hours-bypassed' }
    }
    return { ...base, show: true, silent: true, requireInteraction: false, reason: 'quiet-hours-silenced' }
  }

  return { ...base, show: true, silent: false, requireInteraction, reason: 'delivered' }
}
