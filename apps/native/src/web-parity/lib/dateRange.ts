/**
 * Native parity port of web/src/lib/dateRange.ts.
 *
 * Pure, non-visual calendar-day → API-instant conversion helpers. There is no
 * DOM, JSX, Recharts, Leaflet, or browser-only behavior here — every type and
 * computation is ported verbatim and behaves identically under React Native.
 * The only platform primitives used — `Date`, `Date.UTC`, and
 * `Intl.DateTimeFormat`/`formatToParts` with an IANA `timeZone` + `hourCycle`
 * — are available on Hermes and in the Jest/Node gate environment;
 * `Intl.DateTimeFormat`/`formatToParts` already has native-parity precedent in
 * lib/chargingAggregation.ts and components/forms/CurrencyInput.tsx.
 *
 * The half-open `[startInstant, endInstantExclusive)` API contract, the
 * required-`timezone` (no silent default) rule, and the DST-correct two-pass
 * offset round-trip are preserved byte-for-byte from web — callers convert at
 * the display edge exactly as on web.
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
