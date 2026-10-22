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
 *
 * Instant helpers accept `string | number | Date | null | undefined`:
 * ISO strings, epoch millis, and Dates are instants rendered in the
 * target zone; callers pass raw values, never pre-converting to ISO
 * strings. (Day-key helpers take `YYYY-MM-DD` calendar strings,
 * `formatHourName` takes 0-23 bucket hours, and `formatMonthName` takes
 * 1-12 month numbers — those are bucket identities, not instants.)
 */

import { getGlobalLocale } from './numberFormat'

/** Universal placeholder returned by every formatter for unrenderable input. */
export const FALLBACK = '—'

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
  /** Append ":00" minutes; only `formatHourName` honors this. */
  showMinutes?: boolean
}

/**
 * Usable `timeZone` for `Intl`, or `undefined` (browser zone) when the
 * supplied zone is blank or unknown. Kept local instead of importing
 * `@/lib/timezone` because that module also carries React hooks and this
 * leaf library must stay importable from non-React contexts. Primary
 * validation lives in `resolveTimezone`; this is the backstop that keeps
 * every formatter total per the contract above.
 */
const timeZoneValidityCache = new Map<string, boolean>()

export function safeTimeZone(tz: unknown): string | undefined {
  if (typeof tz !== 'string' || tz.trim() === '') return undefined
  const cached = timeZoneValidityCache.get(tz)
  if (cached !== undefined) return cached ? tz : undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0)
    timeZoneValidityCache.set(tz, true)
    return tz
  } catch {
    timeZoneValidityCache.set(tz, false)
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

export function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale
  // Empty / whitespace-only strings would throw RangeError if handed to
  // `Intl.*`. Treat them as "no override" so the runtime falls back to
  // the browser's default locale.
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  return undefined
}

/**
 * Canonical IANA probe for the date layer: true when `tz` names a zone
 * `Intl` can format in. Display code should prefer `resolveTimezone` /
 * `useDateFormat` (which fall back to a usable zone); this boolean is
 * for branching (normalize-then-compute) in bucketing and schedule code.
 * Never throws.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  return safeTimeZone(tz) !== undefined
}

/**
 * Browser's IANA zone, or `'UTC'` when `Intl` is unavailable. The
 * mock-safe leaf for "default to the browser zone" branching in
 * bucketing and schedule code; display code should prefer
 * `resolveTimezone` / `useDateFormat`. Never throws.
 */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Numeric calendar parts of an instant in a zone. `weekday` is 0 (Sun) - 6. */
export interface ZonedDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()

function cachedPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    partsFormatterCache.set(timeZone, formatter)
  }
  return formatter
}

/**
 * Numeric calendar parts of an instant in the given IANA zone, for
 * bucketing, grouping, and schedule math. Single `formatToParts` call;
 * formatters are cached per zone. Returns `null` for missing, invalid,
 * or unparseable input, or when `timeZone` is not a real zone —
 * callers normalize the zone first (see {@link isValidTimeZone}).
 * Never throws.
 */
export function zonedDateParts(
  value: string | number | Date | null | undefined,
  timeZone: string,
): ZonedDateParts | null {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime()) || !isValidTimeZone(timeZone)) return null
  try {
    const parts = cachedPartsFormatter(timeZone).formatToParts(d)
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
    const year = get('year')
    const month = get('month')
    const day = get('day')
    // h23 midnight reads back as 24 on some ICU builds; bucketing
    // expects 0-23, so normalize here for every caller.
    const rawHour = get('hour')
    const out: ZonedDateParts = {
      year,
      month,
      day,
      hour: rawHour === 24 ? 0 : rawHour,
      minute: get('minute'),
      second: get('second'),
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    }
    if (Object.values(out).some((n) => !Number.isInteger(n))) return null
    return out
  } catch {
    return null
  }
}


/** Full date + time: "Apr 4, 2026, 2:30 AM" */
export function formatDateTime(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(intlLocale(opts), intlOpts({
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }, opts))
}

/** Date only: "Apr 4, 2026" */
export function formatDate(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    year: opts?.yearStyle ?? 'numeric', month: 'short', day: 'numeric',
  }, opts))
}

/** Short date: "Apr 4" */
export function formatDateShort(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
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
export function formatTime(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return cachedTimeFormatter(opts).format(d)
}

/**
 * Locale-aware elapsed time: "3m ago" or "in 2h", then an absolute date
 * after seven days. Uses the selected formatter locale unless overridden.
 * English keeps its existing "just now" label for the first past minute.
 */
export function formatRelative(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
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
  return formatDate(value, { ...opts, locale: formatter.resolvedOptions().locale })
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

export function getFormatter(opts: Intl.DateTimeFormatOptions, locale?: string): Intl.DateTimeFormat {
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


/** Relative time matching dashboard activity feeds: "Just now", "5m ago", or "Apr 4, 02:30 AM" */
export function formatRelativeTime(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  // relative-time: shared event-time formatter
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return d.toLocaleDateString(intlLocale(opts), intlOpts({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, opts))
}


/** Local datetime string for `<input type="datetime-local">` value: "2026-04-04T14:30:00" */
export function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}


/** Weekday + short date: "Fri, Apr 4" */
export function formatDateWithDay(value: string | number | Date | null | undefined, opts?: FormatOptions): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
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
  start: string | number | Date | null | undefined,
  endExclusive: string | number | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (start == null || start === '' || endExclusive == null || endExclusive === '') return FALLBACK
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

