/**
 * Calendar-day → API instant conversion.
 *
 * The user's date picker speaks in calendar-day strings (`YYYY-MM-DD`)
 * scoped to a *display* timezone. The API speaks in absolute instants
 * (RFC 3339). Naive `new Date('2026-05-12').toISOString()` resolves the
 * date as UTC midnight, which silently drops today's local rows for any
 * user not on UTC — the symptom that motivated this helper.
 *
 * Canonical contract:
 *
 *  - The window is **half-open**: `[startInstant, endInstantExclusive)`.
 *    Inclusive end-of-day is a footgun (DST, sub-second precision,
 *    `23:59:59.999` rounding). Half-open intervals are unambiguous and
 *    composable.
 *  - The boundary is the first valid instant of the local date in the supplied
 *    `timezone`. This is normally midnight; if a timezone skips midnight, the
 *    boundary advances to the first representable wall-clock instant.
 *  - `timezone` is required. Vehicle-centric pages should pass the
 *    vehicle's IANA tz; user-centric pages should pass the browser /
 *    user-override tz. Callers must be explicit — we don't pick a
 *    default here so the wrong default never silently wins.
 */

export interface CalendarRange {
  /** Local-calendar start day, `YYYY-MM-DD`. */
  startDate: string;
  /** Local-calendar end day (inclusive), `YYYY-MM-DD`. */
  endDate: string;
  /** IANA timezone the dates are interpreted in (e.g. `America/Los_Angeles`). */
  timezone: string;
}

export interface InstantRange {
  /** RFC 3339 first valid instant of `startDate`. */
  startInstant: string;
  /** RFC 3339 first valid instant of the day AFTER `endDate` (exclusive). */
  endInstantExclusive: string;
}

/**
 * Returns the first UTC instant whose local civil date is `YYYY-MM-DD`.
 * Binary-searching absolute time avoids constructing a nonexistent local
 * midnight. If a timezone skips the whole date, this returns the first instant
 * after it, yielding an empty half-open window for that date.
 */
export function localMidnightToInstant(date: string, timezone: string): Date {
  const [yStr, mStr, dStr] = date.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`localMidnightToInstant: invalid date "${date}"`);
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const target = y * 10_000 + m * 100 + d;
  const localDateKey = (instantMs: number): number => {
    const parts = formatter.formatToParts(new Date(instantMs));
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    return get('year') * 10_000 + get('month') * 100 + get('day');
  };

  const anchor = Date.UTC(y, m - 1, d, 12);
  let low = anchor - 48 * 60 * 60 * 1000;
  let high = anchor + 48 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (localDateKey(mid) < target) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return new Date(high);
}

/**
 * Convert a calendar range to half-open API instants.
 */
export function calendarRangeToInstants(range: CalendarRange): InstantRange {
  const start = localMidnightToInstant(range.startDate, range.timezone);
  const endNext = nextDay(range.endDate);
  const endExclusive = localMidnightToInstant(endNext, range.timezone);
  return {
    startInstant: start.toISOString(),
    endInstantExclusive: endExclusive.toISOString(),
  };
}

function nextDay(date: string): string {
  const [yStr, mStr, dStr] = date.split('-');
  const d = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
