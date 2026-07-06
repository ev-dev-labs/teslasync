import type { SignalObservation } from '@/types/signals';

/**
 * Extract the latest numeric value from a signal-observations query result.
 *
 * Callers request the newest row first (`limit: 1` against a `ts DESC`
 * backend), so the value is read from the head of the list. Non-finite
 * readings (`NaN`, `±Infinity`) are treated as missing and coerced to
 * `null`: left unguarded they slip past every downstream `!= null` check and
 * render as "NaN" or corrupt chart aggregations. This mirrors the invariant
 * the wire adapter already enforces (see `adaptObservations` in
 * `api/hooks/useTelemetry.ts`). A genuine `0` reading is preserved.
 */
export function latestNumeric(
  data: SignalObservation[] | undefined,
): number | null {
  const value = data?.[0]?.value_numeric;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Extract the latest boolean value from a signal-observations query result. */
export function latestBool(
  data: SignalObservation[] | undefined,
): boolean | null {
  return data?.[0]?.value_bool ?? null;
}

/** Extract the latest text value from a signal-observations query result. */
export function latestText(
  data: SignalObservation[] | undefined,
): string | null {
  return data?.[0]?.value_text ?? null;
}
