import type { TirePosition, TirePressureReading } from '../../pages/TirePressurePage';
import { formatDateTime } from '@/lib/dateFormat';

const fields = {
  fl: 'front_left', fr: 'front_right', rl: 'rear_left', rr: 'rear_right',
} as const;
const positions = ['fl', 'fr', 'rl', 'rr'] as const;
export const PRESSURE_THRESHOLDS_PA = {
  normalMin: 250_000,
  normalMax: 350_000,
  softLow: 200_000,
  softHigh: 400_000,
  domainMin: 150_000,
  domainMax: 450_000,
} as const;

/** The handler projects canonical Pa verbatim. Never guess a unit from magnitude.
 * Zero remains the inherited TPMS no-reading sentinel, not a healthy measurement.
 * Keep the wire/cache payload intact; this selector is exclusively presentation.
 */
export function readPressurePa(reading: TirePressureReading, position: TirePosition): number | null {
  const raw = reading[fields[position]];
  return raw != null && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Numeric projection supplied by the existing usePressureFormat SI bridge. */
export type PressureValueConverter = (pa: number) => number | null;

export interface PressureSummary {
  avg: number;
  min: number;
  warningCount: number;
  reportedCount: number;
}

export function summarisePressure(reading: TirePressureReading | null | undefined): PressureSummary | null {
  if (!reading) return null;
  const values = positions.map(pos => readPressurePa(reading, pos))
    .filter((value): value is number => value != null);
  if (!values.length) return null;
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    warningCount: values.filter(value =>
      value < PRESSURE_THRESHOLDS_PA.normalMin || value > PRESSURE_THRESHOLDS_PA.normalMax).length,
    reportedCount: values.length,
  };
}

export function chronologicalPressure(rows: readonly TirePressureReading[] | null | undefined): TirePressureReading[] {
  return [...(rows ?? [])].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

export interface PressureChartDatum {
  [key: string]: string | number | null;
  time: string;
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

export function pressureChartRows(rows: readonly TirePressureReading[], convert: PressureValueConverter): PressureChartDatum[] {
  return rows.map(row => {
    const display = (pos: TirePosition) => {
      const pa = readPressurePa(row, pos);
      return pa == null ? null : convert(pa);
    };
    return {
      time: formatDateTime(row.created_at),
      fl: display('fl'), fr: display('fr'), rl: display('rl'), rr: display('rr'),
    };
  });
}
