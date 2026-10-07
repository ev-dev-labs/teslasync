import type { SignalHistoryPoint } from '@/api/types';

export type SignalHistorySample = Pick<SignalHistoryPoint, 'ts' | 'kind' | 'value'>;

export interface SignalHistoryMeasurement {
  ms: number;
  value: number;
}

/**
 * Extract raw measurements without reinterpreting enum codes or numeric text.
 * Boolean promotion is reserved for models that already compare on/off states.
 * Only valid measurements participate in last-valid-row timestamp deduplication.
 */
export function toSignalHistoryMeasurements(
  samples: readonly SignalHistorySample[],
  includeBooleans = false,
): SignalHistoryMeasurement[] {
  const points: SignalHistoryMeasurement[] = [];
  for (const sample of samples) {
    if (typeof sample.ts !== 'string') continue;
    const ms = Date.parse(sample.ts);
    if (!Number.isFinite(ms)) continue;

    let value: number;
    switch (sample.kind) {
      case 'ValueKindInt32':
      case 'ValueKindInt64':
      case 'ValueKindFloat':
      case 'ValueKindDouble':
        if (typeof sample.value !== 'number' || !Number.isFinite(sample.value)) continue;
        value = sample.value;
        break;
      case 'ValueKindBool':
        if (!includeBooleans || typeof sample.value !== 'boolean') continue;
        value = sample.value ? 1 : 0;
        break;
      default:
        continue;
    }
    points.push({ ms, value });
  }
  points.sort((a, b) => a.ms - b.ms);
  const deduped: SignalHistoryMeasurement[] = [];
  for (const point of points) {
    const prior = deduped[deduped.length - 1];
    if (prior?.ms === point.ms) prior.value = point.value;
    else deduped.push(point);
  }
  return deduped;
}
