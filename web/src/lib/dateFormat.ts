/**
 * Centralized date/time formatting utilities.
 *
 * Instant helpers convert backend ISO 8601 UTC timestamps to the user's
 * timezone. Calendar business dates use formatDayKey without timezone shifts.
 *
 * Every helper accepts an optional second
 * `FormatOptions` argument carrying an IANA timezone name and a BCP-47
 * locale, plus optional explicit clock fields (including seconds). When
 * omitted the helper preserves its prior behavior (browser
 * locale + browser timezone) so existing callers stay byte-for-byte
 * identical. When `tz` is supplied the timestamp is rendered in that
 * zone via `Intl.DateTimeFormat`, which is what `<DateTime in="vehicle">`
 * relies on to render drive/charge times in the car's local time.
 *
 * Formatter contract:
 * Every formatter in this file accepts `null | undefined` and any garbage
 * numeric input (a non-finite number such as NaN, Infinity, -Infinity, a
 * negative duration, or a non-number masquerading via a cast) and returns
 * the universal "—" placeholder rather than throwing or producing strings
 * like "NaN:NaN" or "Invalid Date". Callers should NOT pre-guard.
 */

import { fmtNumber, getGlobalLocale, isFiniteNumber } from './numberFormat'

/** Universal placeholder returned by every formatter for unrenderable input. */
const FALLBACK = '—'

/** Optional locale + timezone overrides for the shared formatters. */
export interface FormatOptions {
  /** IANA timezone name, e.g. 'America/Los_Angeles'. Defaults to browser. */
  tz?: string
  /** BCP-47 locale, e.g. 'en-US'. Defaults to browser locale. */
  locale?: string
  /** Explicit clock fields for instants; date-only and business-day labels ignore these. */
  clock?: Pick<Intl.DateTimeFormatOptions, 'hour' | 'minute' | 'second' | 'hour12' | 'hourCycle'>
  /** Year width; only `formatDate` and `formatMonthYear` honor this. */
  yearStyle?: 'numeric' | '2-digit'
  /** Weekday width; only `formatWeekdayName` honors this. */
  weekdayStyle?: 'short' | 'long'
}

/**
 * Usable `timeZone` for `Intl`, or `undefined` (browser zone) when the
 * supplied zone is blank or unknown. Kept local instead of importing
 * `@/lib/timezone` because that module also carries React hooks and this
 * leaf library must stay importable from non-React contexts. Primary
 * validation lives in `resolveTimezone`; this is the backstop that keeps
 * every formatter total per the contract above.
 */
function safeTimeZone(tz: unknown): string | undefined {
  if (typeof tz !== 'string' || tz.trim() === '') return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0)
    return tz
  } catch {
    return undefined
  }
}

function intlOpts(base: Intl.DateTimeFormatOptions, opts?: FormatOptions): Intl.DateTimeFormatOptions {
  const fields = base.hour ? { ...base, ...opts?.clock } : base
  const timeZone = safeTimeZone(opts?.tz)
  if (timeZone) {
    return { ...fields, timeZone }
  }
  return fields
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale
  // Empty / whitespace-only strings would throw RangeError if handed to
  // `Intl.*`. Treat them as "no override" so the runtime falls back to
  // the browser's default locale.
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  return undefined
}

/** Full date + time: "Apr 4, 2026, 2:30 AM" */
export function formatDateTime(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(intlLocale(opts), intlOpts({
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }, opts))
}

/** Date only: "Apr 4, 2026" */
export function formatDate(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    year: opts?.yearStyle ?? 'numeric', month: 'short', day: 'numeric',
  }, opts))
}

/** Short date: "Apr 4" */
export function formatDateShort(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    month: 'short', day: 'numeric',
  }, opts))
}

/**
 * Cached time-only Intl formatters keyed by locale + timezone + clock fields.
 *
 * `Date#toLocaleTimeString` builds a new Intl formatter on every call
 * (~70µs) — chart datasets with hundreds of thousands of rows (a 48-100h
 * home charge) spent 40+s in `formatTime` alone. A cached
 * `Intl.DateTimeFormat` formats the identical string in well under a
 * microsecond. The key space (locales × timezones) is tiny, so no eviction
 * is needed. Output is unchanged: `toLocaleTimeString(l, o)` is defined as
 * `new Intl.DateTimeFormat(l, o).format(d)` with the same arguments.
 */
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>()

function cachedTimeFormatter(opts?: FormatOptions): Intl.DateTimeFormat {
  const locale = intlLocale(opts)
  const key = `${locale ?? ''}|${opts?.tz ?? ''}|${JSON.stringify(opts?.clock ?? {})}`
  let formatter = timeFormatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      locale === undefined ? [] : locale,
      intlOpts({ hour: '2-digit', minute: '2-digit' }, opts),
    )
    timeFormatterCache.set(key, formatter)
  }
  return formatter
}

/** Time only: "02:30" (24h) or "2:30 AM" (based on locale) */
export function formatTime(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return cachedTimeFormatter(opts).format(d)
}

/**
 * Locale-aware elapsed time: "3m ago" or "in 2h", then an absolute date
 * after seven days. Uses the selected formatter locale unless overridden.
 * English keeps its existing "just now" label for the first past minute.
 */
export function formatRelative(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const diff = d.getTime() - Date.now()
  const seconds = Math.floor(Math.abs(diff) / 1000)
  const locale = intlLocale(opts) ?? getGlobalLocale()
  const relativeOptions = {
    style: 'narrow',
    numeric: seconds < 60 ? 'auto' : 'always',
  } as const
  let formatter: Intl.RelativeTimeFormat
  try {
    formatter = new Intl.RelativeTimeFormat(locale, relativeOptions)
  } catch {
    formatter = new Intl.RelativeTimeFormat('en-US', relativeOptions)
  }
  if (diff <= 0 && seconds < 60) {
    // relative-time: shared event-time formatter
    if (formatter.resolvedOptions().locale.startsWith('en')) return 'just now'
    return formatter.format(0, 'second')
  }
  // A future instant within the next second must not collapse to "now".
  if (seconds < 60) return formatter.format(Math.max(1, seconds), 'second')
  const direction = diff > 0 ? 1 : -1
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return formatter.format(direction * minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return formatter.format(direction * hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return formatter.format(direction * days, 'day')
  return formatDate(iso, { ...opts, locale: formatter.resolvedOptions().locale })
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
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '—'
  const d = new Date(iso)
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

/* ------------------------------------------------------------------ */
/*  Timezone-aware day primitives                                     */
/* ------------------------------------------------------------------ */

/**
 * Cache of `Intl.DateTimeFormat` instances keyed by `tz|locale|fields`.
 * `Intl.DateTimeFormat` constructors are expensive enough that re-creating
 * one per call (e.g. once per drive in a 10K-row list) is a real cost.
 * Module-level memoization keeps the helpers cheap to call in tight loops.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function getFormatter(opts: Intl.DateTimeFormatOptions, locale?: string): Intl.DateTimeFormat {
  // Empty / whitespace-only locale strings would throw `RangeError: Invalid
  // language tag: ` if passed to `Intl.DateTimeFormat`. Coerce to undefined
  // so the runtime falls back to the host default.
  const safeLocale = typeof locale === 'string' && locale.trim().length > 0 ? locale : undefined
  const key = `${safeLocale ?? ''}|${JSON.stringify(opts)}`
  let fmt = FORMATTER_CACHE.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(safeLocale, opts)
    FORMATTER_CACHE.set(key, fmt)
  }
  return fmt
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
 * Render a valid `YYYY-MM-DD` business day without timezone conversion.
 * Missing or invalid calendar keys return the universal placeholder.
 * `style: 'long'` returns
 * "Apr 24, 2026", `style: 'short'` returns "Apr 24". Locale-aware via
 * `opts.locale`.
 */
export function formatDayKey(
  key: string | null | undefined,
  opts?: FormatOptions & { style?: 'short' | 'long' },
): string {
  if (typeof key !== 'string') return FALLBACK
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return FALLBACK
  const [, ys, ms, ds] = m
  const year = Number(ys)
  const month = Number(ms)
  const day = Number(ds)
  // Anchor at UTC noon of the requested calendar day, then format in UTC
  // so the formatter doesn't shift the wall-clock back into a previous
  // day in negative-offset zones. Noon-anchoring also avoids the
  // `new Date('2026-04-24')` UTC-midnight pitfall.
  const noon = new Date(0)
  noon.setUTCHours(12, 0, 0, 0)
  noon.setUTCFullYear(year, month - 1, day)
  if (noon.getUTCFullYear() !== year || noon.getUTCMonth() !== month - 1 || noon.getUTCDate() !== day) {
    return FALLBACK
  }
  const style = opts?.style ?? 'long'
  const fmtOpts: Intl.DateTimeFormatOptions = style === 'short'
    ? { timeZone: 'UTC', month: 'short', day: 'numeric' }
    : { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }
  return getFormatter(fmtOpts, opts?.locale).format(noon)
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

/** Relative time matching dashboard activity feeds: "Just now", "5m ago", or "Apr 4, 02:30 AM" */
export function formatRelativeTime(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  // relative-time: shared event-time formatter
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return d.toLocaleDateString(intlLocale(opts), intlOpts({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, opts))
}

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
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  if (!start || !end) return FALLBACK
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

/** Local datetime string for `<input type="datetime-local">` value: "2026-04-04T14:30:00" */
export function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

/** Weekday + short date: "Fri, Apr 4" */
export function formatDateWithDay(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    weekday: 'short', month: 'short', day: 'numeric',
  }, opts))
}

/**
 * User-facing label for a half-open API range `[start, endExclusive)`:
 * renders the inclusive last day ("Sep 22 – Oct 21, 2026") via
 * `Intl.DateTimeFormat.formatRange`, which collapses shared fields in a
 * locale-aware way. A reversed range is swapped rather than thrown on —
 * a display helper must stay total. Missing or invalid bounds return
 * the universal placeholder.
 */
export function formatDateRange(
  start: string | Date | null | undefined,
  endExclusive: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!start || !endExclusive) return FALLBACK
  const s = new Date(start)
  const e = new Date(endExclusive)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return FALLBACK
  let from = s.getTime()
  let until = e.getTime()
  if (until < from) [from, until] = [until, from]
  // Last included instant, then its civil day in the target zone. Query
  // ends carry millisecond precision, so minus 1ms is exactly the final
  // included millisecond; a DST transition inside the day cannot move it.
  const inclusiveEnd = new Date(Math.max(0, until - 1))
  const timeZone = safeTimeZone(opts?.tz)
  try {
    const fmt = new Intl.DateTimeFormat(intlLocale(opts), {
      ...(timeZone ? { timeZone } : {}),
      year: 'numeric', month: 'short', day: 'numeric',
    })
    // ICU pads the range separator with thin/narrow spaces that vary by
    // version; normalize to plain spaces so labels, tests and snapshots
    // stay stable and match the existing "{{start}} – {{end}}" labels.
    return fmt.formatRange(new Date(from), inclusiveEnd).replace(/[\u2009\u202F]/g, ' ')
  } catch {
    return FALLBACK
  }
}

/**
 * User-facing label for an inclusive `YYYY-MM-DD` calendar span
 * ("Aug 1 – 8, 2026"). Business dates are not instants, so both ends
 * are noon-anchored in UTC exactly like {@link formatDayKey} — the label
 * never shifts with the display zone. A reversed span is swapped rather
 * than thrown on; missing or invalid keys return the placeholder.
 */
export function formatDayKeyRange(
  startKey: string | null | undefined,
  endKey: string | null | undefined,
  opts?: FormatOptions,
): string {
  const toNoon = (key: string | null | undefined): Date | null => {
    if (typeof key !== 'string') return null
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
    if (!m) return null
    const noon = new Date(0)
    noon.setUTCHours(12, 0, 0, 0)
    noon.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (noon.getUTCFullYear() !== Number(m[1]) || noon.getUTCMonth() !== Number(m[2]) - 1 || noon.getUTCDate() !== Number(m[3])) {
      return null
    }
    return noon
  }
  const from = toNoon(startKey)
  const until = toNoon(endKey)
  if (!from || !until) return FALLBACK
  const [first, last] = from.getTime() <= until.getTime() ? [from, until] : [until, from]
  try {
    const fmt = new Intl.DateTimeFormat(intlLocale(opts), {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    })
    return fmt.formatRange(first, last).replace(/[\u2009\u202F]/g, ' ')
  } catch {
    return FALLBACK
  }
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
 * User-facing month-year label ("Mar 2027", or "Mar '27" with
 * `yearStyle: '2-digit'`). Plain `YYYY-MM` / `YYYY-MM-DD`
 * calendar values are formatted zone-stable (noon-anchored UTC, like
 * {@link formatDayKey}); full instants are rendered in the target zone.
 * Missing or invalid input returns the placeholder; an invalid locale
 * falls back to `en-US` before giving up. Never throws.
 */
export function formatMonthYear(
  value: string | Date | null | undefined,
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
  value: string | Date | null | undefined,
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
 * User-facing hour-of-day bucket name ("12 AM", "3 PM") for the given
 * hour 0-23. Hour buckets are bucket identities, not instants, so they
 * render from a UTC anchor and never shift with the display zone.
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
  const fields: Intl.DateTimeFormatOptions = { timeZone: 'UTC', hour: 'numeric' }
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

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
