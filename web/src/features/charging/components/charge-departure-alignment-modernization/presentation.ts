import type { DeparturePair } from '../../lib/chargeDepartureAlignment';

/** Observed timestamps only, not server coverage or an inferred analysis window. */
export function observedBounds(values: readonly (string | null | undefined)[]) {
  const timestamps = values
    .filter((value): value is string => value != null)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return {
    first: Math.min(...timestamps),
    last: Math.max(...timestamps),
    count: timestamps.length,
  };
}

/** Render-boundary accessors shared by the table and its mobile adapter.
 * No model arithmetic, precision decisions or SI cache conversions live here. */
export function pairDisplayValues(
  pair: DeparturePair,
  date: (ms: number) => string,
  percent: (value: number) => string,
  duration: (seconds: number) => string,
  flags: (pair: DeparturePair) => string,
): Record<string, string | number> {
  const pct = (value: number | null) => value != null ? percent(value) : '—';
  return {
    chargeEndedMs: date(pair.chargeEndedMs),
    driveStartMs: date(pair.driveStartMs),
    chargeId: pair.chargeId,
    driveId: pair.driveId,
    dwellS: duration(pair.dwellS),
    readinessMarginPct: pct(pair.readinessMarginPct),
    socUsedPct: pct(pair.socUsedPct),
    endSocPct: pct(pair.endSocPct),
    driveStartSocPct: pct(pair.driveStartSocPct),
    driveEndSocPct: pct(pair.driveEndSocPct),
    socDriftPct: pct(pair.socDriftPct),
    earlyFullDwellS: duration(pair.earlyFullDwellS),
    flags: flags(pair),
  };
}
