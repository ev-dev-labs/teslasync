import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { DistanceUnitPref } from '@/lib/unitConversion';
import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint, DriveStats } from './types';

function reading(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function driveOdometerEvidence(
  drive: DriveDetail,
  stats: DriveStats,
  unit: DistanceUnitPref,
  chartData?: ChartDataPoint[],
) {
  const recordedStart = reading(drive.start_odometer_m);
  const recordedEnd = reading(drive.end_odometer_m);
  const samples = chartData?.map((point) => reading(point.odometer))
    .filter((value): value is number => value != null);
  // Legacy display stats use zero as the missing sentinel; actual samples
  // and persisted endpoints can distinguish a genuine zero reading.
  const sampledStart = samples ? samples[0] ?? null : stats.odometerStart > 0 ? reading(stats.odometerStart) : null;
  const sampledEnd = samples
    ? samples.length > 1 || drive.endTs == null ? samples[samples.length - 1] ?? null : null
    : stats.odometerEnd > 0 ? reading(stats.odometerEnd) : null;
  return {
    start: recordedStart != null ? convertDistanceFromSI(recordedStart, unit) : sampledStart,
    end: recordedEnd != null ? convertDistanceFromSI(recordedEnd, unit) : sampledEnd,
    source: recordedStart != null && recordedEnd != null ? 'aggregate'
      : recordedStart != null || recordedEnd != null ? 'mixed' : 'sampled',
  };
}
