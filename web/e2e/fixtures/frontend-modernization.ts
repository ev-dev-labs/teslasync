/** QA-only raw values, not production payloads or runtime acceptance evidence. */
export const EXTREME_VALUES = [0, 1, 10, 99, 999, 999999, Number.MAX_SAFE_INTEGER, -1, null, undefined] as const;

export const EXTREME_TEXT = Object.freeze({
  label: 'Synthetic QA label with deliberately long explanatory context '.repeat(8),
  vehicleName: 'Synthetic QA vehicle — exceptionally long multilingual name 車両 مركبة '.repeat(6),
  address: 'Synthetic QA address, Building 999999, Long Street, District, Region '.repeat(8),
  identifier: 'synthetic-qa-identifier-without-natural-breaks-'.repeat(12),
  timestamp: '2099-12-31T23:59:59.999999+14:00',
});

export interface ModernizationFixtureRow {
  id: number;
  name: string;
  value: number | null | undefined;
  address: string;
}

/** Call only from tests; avoids allocating large datasets during module loading. */
export function createExtremeRows(count = 1000): ModernizationFixtureRow[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000) {
    throw new RangeError('QA row count must be an integer from 0 through 10000');
  }
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `${EXTREME_TEXT.vehicleName}${index + 1}`,
    value: EXTREME_VALUES[index % EXTREME_VALUES.length],
    address: EXTREME_TEXT.address,
  }));
}

export const EXTREME_CASES = Object.freeze({
  empty: [] as readonly ModernizationFixtureRow[],
  single: [{ id: 1, name: EXTREME_TEXT.vehicleName, value: 1, address: EXTREME_TEXT.address }],
  missing: { value: null, absent: undefined },
});

/** Semantic readiness cases only; never injected into application API responses. */
export const QA_READINESS_CASES = Object.freeze({
  measuredGauge: { role: 'progressbar', valueNow: '73', label: 'Battery health' },
  zeroGauge: { role: 'progressbar', valueNow: '0', label: 'Energy used' },
  loadingProgress: { role: 'progressbar', valueNow: '25', label: 'Loading' },
  indeterminateProgress: { role: 'progressbar', label: 'Pending' },
  busySection: { busy: 'true', label: 'Battery health' },
  spinner: { role: 'status', label: 'Loading', loading: true },
  settledStatus: { role: 'status', label: 'Live data' },
});
