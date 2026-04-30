import type { SignalObservation } from '@/types/signals';

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
