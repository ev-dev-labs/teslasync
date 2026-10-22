/**
 * Route-side date conversions and axis labels.
 *
 * Zone/wall-clock conversions (`zonedWallTimeToUtc`, `toZonedDatetimeStr`,
 * `toIsoString`, `formatGmtOffset`, the `datetime-local` helpers),
 * the shared zone list (`supportedTimeZones`), duration labels
 * (`formatDuration*`) and chart-axis labels (`formatChartInstant`,
 * `formatHourName`, `tzAbbreviation`).
 *
 * This module is intentionally NOT imported by the app shell: it is only
 * reachable from lazy routes, so it stays out of the cold-start (startup
 * closure) bundle budget. Shell code must keep using `@/lib/dateFormat`
 * (via `useDateFormat()`); route code imports conversions and labels
 * from here. Part of the shared date layer, so direct `Intl` use here
 * is exempt from the time-zone display guard.
 */

import { fmtNumber, isFiniteNumber } from './numberFormat'
import { useSettings } from '@/hooks/useSettings'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import type { TzMode } from './timezone'
import {
  FALLBACK,
  type FormatOptions,
  formatDayKey,
  getFormatter,
  intlLocale,
  safeTimeZone,
  toLocalDatetimeStr,
} from './dateFormat'

/** Nonnegative measured duration uses selected precision; missing/invalid values remain unknown. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return FALLBACK
  if (ms < 1000) return `${fmtNumber(ms)}ms`
  return `${fmtNumber(ms / 1000)}s`
}

/** Measured duration with decimal minute rollover and selected precision. */
export function formatDurationMsCompact(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return FALLBACK
  if (ms < 1000) return `${fmtNumber(ms)}ms`
  if (ms < 60_000) return `${fmtNumber(ms / 1000)}s`
  return `${fmtNumber(ms / 60_000)}m`
}

/** Job duration with minute/second output for longer jobs: "1m 05s". Zero means "no run yet". */
export function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) return FALLBACK
  if (ms < 1000) return `${fmtNumber(ms)}ms`
  const sec = ms / 1000
  if (sec < 60) return `${fmtNumber(sec)}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${formatRoundedInt(sec % 60)}s`
}

/** Locale-aware seconds represented as rounded minutes/hours: "5m", "2h 10m", or "2h". */
export function formatDurationSecondsAsMinutes(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return FALLBACK
  const h = Math.floor(seconds / 3600)
  const m = (seconds % 3600) / 60
  if (h === 0) return `${fmtNumber(m, 0)}m`
  return m >= 0.5 ? `${fmtNumber(h, 0)}h ${fmtNumber(m, 0)}m` : `${fmtNumber(h, 0)}h`
}

/** Minute duration with rounded minute remainder: "5m" or "2h 05m". */
export function formatDurationMinutes(
  minutes: number | null | undefined,
  options: { subMinuteLabel?: string } = {},
): string {
  if (!isFiniteNumber(minutes) || minutes < 0) return FALLBACK
  if (options.subMinuteLabel && minutes < 1) return options.subMinuteLabel
  const h = Math.floor(minutes / 60)
  const m = formatRoundedInt(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Duration between two timestamps, rounded to whole minutes. */
export function formatDurationRange(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
): string {
  if (start == null || start === '' || end == null || end === '') return FALLBACK
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return FALLBACK
  const ms = e - s
  if (ms < 0) return FALLBACK
  return formatDurationMinutes(Math.round(ms / 60_000))
}

/** Media/player clock duration: "3:07". Returns "—" for nullish, non-finite, or negative durations. */
export function formatDurationClock(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return FALLBACK
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/**
 * Canonical ISO-8601 UTC string (`2026-04-04T14:30:00.000Z`) for machine
 * values: `<time dateTime>`, data props, export payloads, query keys.
 * Returns `null` for missing or unparseable input. Never throws.
 */
export function toIsoString(value: string | number | Date | null | undefined): string | null {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return null
  try {
    return d.toISOString()
  } catch {
    return null
  }
}

/**
 * Short GMT offset label (`GMT-7`, `GMT+5:30`, `GMT`) of an instant in
 * the target zone. For time axes and timelines where the offset
 * disambiguates repeated fall-back hours; not a zone name. Missing or
 * invalid input returns the placeholder. Never throws.
 */
export function formatGmtOffset(
  value: string | number | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return FALLBACK
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return FALLBACK
  const timeZone = safeTimeZone(opts?.tz)
  const fields: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}), timeZoneName: 'shortOffset',
  }
  try {
    const found = new Intl.DateTimeFormat(intlLocale(opts), fields)
      .formatToParts(d).find((p) => p.type === 'timeZoneName')
    return found?.value ?? FALLBACK
  } catch {
    try {
      const found = new Intl.DateTimeFormat('en-US', fields)
        .formatToParts(d).find((p) => p.type === 'timeZoneName')
      return found?.value ?? FALLBACK
    } catch {
      return FALLBACK
    }
  }
}

/**
 * All IANA zones the runtime knows, for zone pickers. The user-facing
 * setting lives in exactly one place (Settings > Units); per-record
 * schedule pickers (quiet-hours windows) also list through here.
 * Returns `[]` when `Intl.supportedValuesOf` is unavailable. Never throws.
 */
export function supportedTimeZones(): string[] {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof sv !== 'function') return []
    return sv.call(Intl, 'timeZone')
  } catch {
    return []
  }
}

/**
 * Stored UTC ISO instant → `<input type="datetime-local">` value
 * ("2026-04-04T14:30", browser-local wall time). Never slice a UTC string
 * directly: the input interprets the value as LOCAL time, so slicing shifts
 * the instant by the UTC offset on save. Returns '' for missing/invalid input.
 */
export function isoUtcToLocalDatetimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return toLocalDatetimeStr(d).slice(0, 16)
}

/**
 * `<input type="datetime-local">` value → stored UTC ISO instant. Returns null
 * for empty/invalid input instead of throwing (a cleared input must never
 * crash the form — callers keep the previous value or show a validation error).
 */
export function localDatetimeInputToIso(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Offset of `timeZone` at `instantMs` in milliseconds (local wall clock
 * minus UTC). Used to interpret `datetime-local` entries in the display
 * zone instead of the browser zone.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instantMs
}

/**
 * Interprets a `datetime-local` wall time (`YYYY-MM-DDTHH:mm`, seconds
 * optional) in `timeZone` and returns the matching UTC instant, or `null`
 * when the text is unparseable. Spring-forward gaps resolve forward to
 * the later offset and fall-back overlaps resolve to the first
 * occurrence, matching `Temporal`'s "compatible" behavior. An unknown
 * zone falls back to browser-local interpretation (plain `new Date`).
 */
export function zonedWallTimeToUtc(wall: string | null | undefined, timeZone: string): Date | null {
  if (typeof wall !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(wall.trim())
  if (!m) return null
  const [, Y, Mo, D, h, mi, s] = m.map(Number)
  const asUTC = Date.UTC(Y, Mo - 1, D, h, mi, s || 0)
  const check = new Date(asUTC)
  if (check.getUTCFullYear() !== Y || check.getUTCMonth() !== Mo - 1 || check.getUTCDate() !== D
    || check.getUTCHours() !== h || check.getUTCMinutes() !== mi || check.getUTCSeconds() !== (s || 0)) {
    return null
  }
  const tz = safeTimeZone(timeZone)
  if (!tz) return new Date(wall)
  try {
    const off0 = zoneOffsetMs(asUTC, tz)
    const first = asUTC - off0
    // Second pass: a DST transition between the guess and the result
    // changes the applicable offset; one correction converges.
    const off1 = zoneOffsetMs(first, tz)
    let instant = asUTC - off1
    if (off1 !== off0) {
      // Offset changed across the guess: verify the wall reads back. A
      // spring-forward gap never reads back, so shift forward by the gap
      // (compatible behavior); a fall-back overlap already resolved to
      // the first occurrence and reads back unchanged.
      const back = instant + zoneOffsetMs(instant, tz)
      if (back !== asUTC) instant += off1 - off0
    }
    return new Date(instant)
  } catch {
    return new Date(wall)
  }
}

/**
 * Formats `d` as a `datetime-local`-ready `YYYY-MM-DDTHH:mm` wall time in
 * `timeZone` (for prefilling entries in the display zone). Unknown zones
 * fall back to browser-local formatting.
 */
export function toZonedDatetimeStr(d: Date, timeZone: string): string {
  const tz = safeTimeZone(timeZone)
  if (!tz) return toLocalDatetimeStr(d)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(d)
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
  } catch {
    return toLocalDatetimeStr(d)
  }
}

/**
 * User-facing hour-of-day bucket name ("12 AM", "3 PM", or "3:00 PM"
 * with `showMinutes`) for the given hour 0-23. Hour buckets are bucket
 * identities, not instants, so they render from a UTC anchor and never
 * shift with the display zone.
 * Out-of-range, non-integer, or missing input returns the placeholder;
 * an invalid locale falls back to `en-US` before giving up.
 * Never throws.
 */
export function formatHourName(
  value: number | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || !Number.isInteger(value) || value < 0 || value > 23) return FALLBACK
  // UTC-anchored bucket label: hour-of-day names are bucket identities,
  // not instants, so they render in UTC and never shift with the zone.
  const d = new Date(Date.UTC(2024, 0, 4, value, 0))
  const fields: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC', hour: 'numeric', ...(opts?.showMinutes ? { minute: '2-digit' as const } : {}),
  }
  try {
    return new Intl.DateTimeFormat(intlLocale(opts), fields).format(d)
  } catch {
    try {
      return new Intl.DateTimeFormat('en-US', fields).format(d)
    } catch {
      return FALLBACK
    }
  }
}

/**
 * Chart tick label with a numeric GMT offset ("Nov 1, 01:30 GMT-7").
 * The offset is not a zone name: it disambiguates repeated fall-back
 * hours on time axes, where the wall time alone is ambiguous.
 * Missing or invalid input returns the placeholder; an invalid locale
 * falls back to `en-US` before giving up. Never throws.
 */
export function formatChartInstant(
  value: string | Date | number | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return FALLBACK
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return FALLBACK
  const timeZone = safeTimeZone(opts?.tz)
  const fields: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}),
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZoneName: 'shortOffset',
  }
  try {
    return new Intl.DateTimeFormat(intlLocale(opts), fields).format(d)
  } catch {
    try {
      return new Intl.DateTimeFormat('en-US', fields).format(d)
    } catch {
      return FALLBACK
    }
  }
}

/**
 * Returns the short timezone abbreviation (e.g. "PST", "EDT") for the
 * given timestamp in the given IANA zone. Date-aware so DST transitions
 * are honored — `tzAbbreviation(jan, 'America/Los_Angeles')` yields
 * "PST" while the same call in July yields "PDT".
 */
export function tzAbbreviation(value: string | Date, tz: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date)
    return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

/**
 * User-facing month-year label ("Mar 2027", or "Mar '27" with
 * `yearStyle: '2-digit'`). Plain `YYYY-MM` / `YYYY-MM-DD`
 * calendar values are formatted zone-stable (noon-anchored UTC, like
 * {@link formatDayKey}); full instants (ISO strings, epoch millis,
 * Dates) are rendered in the target zone.
 * Missing or invalid input returns the placeholder; an invalid locale
 * falls back to `en-US` before giving up. Never throws.
 */
export function formatMonthYear(
  value: string | number | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return FALLBACK
  const yearStyle = opts?.yearStyle ?? 'numeric'
  const render = (d: Date, timeZone: string | undefined): string => {
    const fields: Intl.DateTimeFormatOptions = {
      ...(timeZone ? { timeZone } : {}), year: yearStyle, month: 'short',
    }
    try {
      return new Intl.DateTimeFormat(intlLocale(opts), fields).format(d)
    } catch {
      try {
        return new Intl.DateTimeFormat('en-US', fields).format(d)
      } catch {
        return FALLBACK
      }
    }
  }
  if (typeof value === 'string') {
    const cal = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim())
    if (cal) {
      const month = Number(cal[2])
      if (month < 1 || month > 12) return FALLBACK
      // Validate the full calendar value (including the day when present)
      // with a round-trip, like formatDayKey, so impossible dates such as
      // "2026-02-30" return the placeholder instead of a rolled-over month.
      const day = cal[3] === undefined ? 1 : Number(cal[3])
      const anchor = new Date(0)
      anchor.setUTCHours(12, 0, 0, 0)
      anchor.setUTCFullYear(Number(cal[1]), month - 1, day)
      if (anchor.getUTCFullYear() !== Number(cal[1]) || anchor.getUTCMonth() !== month - 1 || anchor.getUTCDate() !== day) {
        return FALLBACK
      }
      return render(anchor, 'UTC')
    }
  }
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return FALLBACK
  return render(d, safeTimeZone(opts?.tz))
}

/**
 * User-facing month name ("Mar"). Plain `YYYY-MM` calendar values and
 * 1–12 month numbers are formatted zone-stable (mid-month-anchored UTC,
 * like {@link formatMonthYear}); `Date` values and other date strings
 * are treated as instants and rendered in the target zone. Missing or
 * invalid input returns the placeholder; an invalid locale falls back
 * to `en-US` before giving up. Never throws.
 */
export function formatMonthName(
  value: string | number | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return FALLBACK
  const render = (d: Date, timeZone: string | undefined): string => {
    const fields: Intl.DateTimeFormatOptions = {
      ...(timeZone ? { timeZone } : {}), month: 'short',
    }
    try {
      return new Intl.DateTimeFormat(intlLocale(opts), fields).format(d)
    } catch {
      try {
        return new Intl.DateTimeFormat('en-US', fields).format(d)
      } catch {
        return FALLBACK
      }
    }
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 12) return FALLBACK
    return render(new Date(Date.UTC(2024, value - 1, 15)), 'UTC')
  }
  if (typeof value === 'string') {
    const cal = /^(\d{4})-(\d{2})$/.exec(value.trim())
    if (cal) {
      const month = Number(cal[2])
      if (month < 1 || month > 12) return FALLBACK
      return render(new Date(Date.UTC(Number(cal[1]), month - 1, 15)), 'UTC')
    }
  }
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return FALLBACK
  return render(d, safeTimeZone(opts?.tz))
}

/**
 * User-facing weekday name ("Mon", or "Monday" with
 * `{ weekdayStyle: 'long' }`) for the given date in the target zone.
 * Weekday-bucket labels pass a UTC-nooned anchor date with an explicit
 * `{ tz: 'UTC' }` override so the name never shifts with the display
 * zone. Missing or invalid input returns the placeholder; an invalid
 * locale falls back to `en-US` before giving up.
 * Never throws.
 */
export function formatWeekdayName(
  value: string | number | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return FALLBACK
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return FALLBACK
  const timeZone = safeTimeZone(opts?.tz)
  const fields: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}), weekday: opts?.weekdayStyle ?? 'short',
  }
  try {
    return new Intl.DateTimeFormat(intlLocale(opts), fields).format(d)
  } catch {
    try {
      return new Intl.DateTimeFormat('en-US', fields).format(d)
    } catch {
      return FALLBACK
    }
  }
}


/**
 * Compact chart-axis label ("Oct 1, 02 AM") for an instant in the target
 * zone: month + day + hour, without minutes or offset. Unlike
 * {@link formatChartInstant}, repeated fall-back hours render
 * identically; use it for dense axes where the offset would not fit.
 * Missing or invalid input returns the placeholder; an invalid locale
 * falls back to `en-US` before giving up. Never throws.
 */
export function formatMonthDayHour(
  value: string | Date | number | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return FALLBACK
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return FALLBACK
  const timeZone = safeTimeZone(opts?.tz)
  const fields: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}),
    month: 'short', day: 'numeric', hour: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat(intlLocale(opts), fields).format(d)
  } catch {
    try {
      return new Intl.DateTimeFormat('en-US', fields).format(d)
    } catch {
      return FALLBACK
    }
  }
}

/**
 * Narrow an arbitrary runtime value to a {@link TzMode}. Local copy for
 * route-side conversion code (mirrors the private ones in `@/lib/timezone`
 * and `./useDateFormat`): this module must not gain value imports from
 * that widely-mocked module, or tests with explicit mocks break.
 */
function isTzMode(value: unknown): value is TzMode {
  return value === 'vehicle' || value === 'user' || value === 'utc'
}

/**
 * UNSANITIZED resolution for business-instant conversion boundaries ONLY
 * (rate effective dates, journey departure inputs, schedule builders):
 * returns the raw saved/vehicle zone WITHOUT `Intl` validation, falling
 * back to the browser zone only when nothing is set. An invalid saved
 * zone therefore reaches the conversion helper, which decides: strict
 * helpers throw (the form surfaces a validation error instead of
 * persisting instants converted in a guessed zone); legacy wall-clock
 * parsers keep their browser-local fallback. NEVER use for display —
 * display must use `resolveTimezone` / `useTimezone`, which fall back
 * to a usable zone and can never throw at render time.
 */
export function resolveRawTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') return 'UTC'
  const userTz = userOverride && userOverride.trim() ? userOverride : browserTimezoneFallBack()
  if (mode === 'user') return userTz
  if (!vehicleTz || vehicleTz === 'UTC') return userTz
  return vehicleTz
}

/**
 * Browser zone for conversion fallbacks. Local alias (mirrors
 * `browserTimezone` in `@/lib/timezone`): keeps this route-side module
 * free of value imports from the display layer.
 */
function browserTimezoneFallBack(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * React hook returning the UNSANITIZED conversion zone for business-instant
 * conversion boundaries (rate effective dates, journey departure inputs,
 * schedule builders). The mode mirrors `settings.tz_display_default`
 * (validated, `'vehicle'` fallback); the zone itself is raw per
 * {@link resolveRawTimezone} — an invalid saved zone reaches the conversion
 * helper instead of being pre-guessed by the display layer. Only call
 * inside provider-mounted components.
 */
export function useConversionTimezone(): string {
  const { vehicle } = useSelectedVehicle()
  const { settings } = useSettings()
  const requestedMode = settings.tz_display_default
  const mode: TzMode = isTzMode(requestedMode) ? requestedMode : 'vehicle'
  return resolveRawTimezone(mode, vehicle?.timezone, settings.timezone_user)
}

/**
 * Relative *day*-precision label used by date-grouped feeds. Unlike
 * `formatRelative`, this never falls back to an absolute date — it
 * always returns a relative phrase ("Today", "Yesterday", "3d ago",
 * "2w ago", "5mo ago", "1y ago"). Pair it with a separate absolute
 * date label (e.g. group header showing "Apr 24, 2026 · 18d ago").
 *
 * Day deltas are computed in the *target* timezone (defaults to the
 * browser's local zone). Pass `tz` to anchor day boundaries to a
 * specific zone — e.g. the active vehicle's IANA zone — so a drive
 * recorded at 11pm vehicle-local doesn't get reported as "Yesterday"
 * just because the user's browser already rolled to the next day.
 */
export function formatRelativeDays(
  value: string | number | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  const targetKey = ymdInTz(d, opts?.tz)
  if (!targetKey) return '—'
  return formatRelativeDayKey(targetKey, opts)
}
/**
 * Relative day label for an existing `YYYY-MM-DD` calendar key.
 *
 * Unlike converting the key to a UTC instant, this preserves the calendar day
 * chosen by the caller and compares it with "today" in the same target
 * timezone. Use it for grouped list headers whose keys already came from
 * {@link ymdInTz}.
 */
export function formatRelativeDayKey(dayKey: string, opts?: FormatOptions): string {
  if (parseYmdToUtcMillis(dayKey) == null) return FALLBACK
  const todayKey = ymdInTz(new Date(), opts?.tz)
  if (!todayKey) return FALLBACK
  const diffDays = daysBetweenYmd(dayKey, todayKey)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 0) return `in ${Math.abs(diffDays)}d`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}
/**
 * Extract a `YYYY-MM-DD` string from a Date in the requested timezone.
 * Falls back to the browser's local zone when `tz` is unset. Used as the
 * shared day-key primitive that `formatRelativeDays` and the per-feature
 * day-grouping helpers (e.g. `localDayKey` in `drivesAggregation`) build
 * on, so every "what day is this drive on?" question gives the same
 * answer across the page.
 */
export function ymdInTz(d: Date, tz?: string): string | null {
  if (isNaN(d.getTime())) return null
  if (!tz) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  // Use formatToParts so we get raw numeric components — toLocaleDateString
  // would inject locale separators we'd then have to parse back out.
  try {
    const fmt = getFormatter({
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }, 'en-US')
    const parts = fmt.formatToParts(d)
    const get = (type: string) => parts.find(p => p.type === type)?.value
    const y = get('year')
    const m = get('month')
    const day = get('day')
    if (!y || !m || !day) return null
    return `${y}-${m}-${day}`
  } catch {
    // Invalid IANA tz — fall back to browser-local rather than throwing.
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}
/**
 * Compute the inclusive day delta `today - target` from two day keys in
 * `YYYY-MM-DD` form. Used by `formatRelativeDays`. Positive when
 * `target` is earlier than `today`. Returns `0` if either key is malformed.
 */
function daysBetweenYmd(target: string, today: string): number {
  const a = parseYmdToUtcMillis(target)
  const b = parseYmdToUtcMillis(today)
  if (a == null || b == null) return 0
  return Math.round((b - a) / 86_400_000)
}

function parseYmdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const [, ys, ms, ds] = m
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds))
}
