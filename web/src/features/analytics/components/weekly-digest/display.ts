import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceToSI, type UnitPref } from '@/lib/unitConversion';

export function formatEfficiencyFromSI(
  valueWhPerM: number | null | undefined,
  unitPrefs: UnitPref,
  precision = 1,
): string {
  if (valueWhPerM == null || !Number.isFinite(valueWhPerM)) return '—';
  const whPerDisplayDistance =
    valueWhPerM * convertDistanceToSI(1, unitPrefs.distance);
  return `${fmtNumber(
    whPerDisplayDistance,
    precision,
    unitPrefs.locale,
  )} Wh/${unitPrefs.distance}`;
}
