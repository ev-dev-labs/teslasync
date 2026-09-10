/**
 * Fleet telemetry honesty — live / stale / guessed / missing.
 *
 * Maps the dashboard posture taxonomy onto the same four words FSD already
 * uses when it refuses to invent kilometres.
 */

export type HonestyKind = 'live' | 'stale' | 'guessed' | 'missing';

export const HONESTY_KINDS: readonly HonestyKind[] = ['live', 'stale', 'guessed', 'missing'];

export function honestyFromPostureCategory(category: string | null | undefined): HonestyKind {
  switch (category) {
    case 'reporting':
    case 'live':
      return 'live';
    case 'stale':
      return 'stale';
    case 'unverified':
    case 'pending':
      return 'guessed';
    default:
      return 'missing';
  }
}

export function emptyHonestyCounts(): Record<HonestyKind, number> {
  return { live: 0, stale: 0, guessed: 0, missing: 0 };
}

export function tallyHonesty(categories: readonly (string | null | undefined)[]): Record<HonestyKind, number> {
  const counts = emptyHonestyCounts();
  for (const category of categories) {
    counts[honestyFromPostureCategory(category)] += 1;
  }
  return counts;
}

export function honestyFromLiveConnection(
  status: 'connected' | 'reconnecting' | 'disconnected' | 'unknown',
  stale: boolean,
): HonestyKind {
  if (status === 'connected' && stale) return 'stale';
  if (status === 'connected') return 'live';
  if (status === 'reconnecting') return 'guessed';
  return 'missing';
}
