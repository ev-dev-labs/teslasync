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
 *  - The boundary is the local midnight of the supplied `timezone`. A
 *    single-day window picks the next local midnight as exclusive end.
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
  /** RFC 3339 instant of `startDate`'s local midnight. */
  startInstant: string;
  /** RFC 3339 instant of the day AFTER `endDate`'s local midnight (exclusive). */
  endInstantExclusive: string;
}

/**
 * Returns the UTC instant of `YYYY-MM-DD T 00:00:00` interpreted in the
 * given IANA timezone. Uses an `Intl.DateTimeFormat` round-trip which
 * is correct across DST transitions — the local "midnight" on a
 * spring-forward day is still the instant whose wall-clock components
 * print as `HH=00 MM=00`.
 */
export function localMidnightToInstant(date: string, timezone: string): Date {
  const [yStr, mStr, dStr] = date.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`localMidnightToInstant: invalid date "${date}"`);
  }

  // Start with the UTC instant for the same wall-clock; then correct
  // by the offset between that wall-clock as seen in `timezone` and
  // the same wall-clock as seen in UTC. A second pass catches the rare
  // DST-edge case where the first correction crosses a transition.
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offsetMs = tzOffsetMs(guess, timezone);
  const corrected = guess - offsetMs;
  const offset2 = tzOffsetMs(corrected, timezone);
  return new Date(guess - offset2);
}

function tzOffsetMs(instantMs: number, timezone: string): number {
  // Format the instant as wall-clock components in `timezone`, then
  // re-encode those components as a UTC instant — the difference is
  // the tz offset at that instant.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - instantMs;
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
