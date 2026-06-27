/**
 * Native parity for web/src/lib/signalObservation.ts.
 *
 * The web module imports `SignalObservation` from `@/types/signals`, an alias
 * the native parity layer does not expose, so the interface (and the
 * `SignalSource` union it depends on) is inlined here verbatim — matching the
 * same inlining used by the native useTelemetry parity hook. Pure, non-visual
 * TypeScript with no DOM, browser, charting, or web UI dependencies.
 */

type SignalSource = 'fleet_telemetry' | 'fleet_api' | 'manual' | 'backfill';

interface SignalObservation {
  vehicle_id: number;
  ts: string;
  signal_name: string;
  value_numeric: number | null;
  value_text: string | null;
  value_bool: boolean | null;
  source: SignalSource;
}

/** Extract the latest numeric value from a signal-observations query result. */
export function latestNumeric(
  data: SignalObservation[] | undefined,
): number | null {
  return data?.[0]?.value_numeric ?? null;
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
