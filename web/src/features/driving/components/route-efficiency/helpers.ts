import { safeNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';

export type EfficiencyVariant = 'success' | 'info' | 'warning' | 'danger';

/**
 * Map an efficiency figure (Wh/km, SI-per-km as returned by the API) onto a
 * Badge variant. Lower Wh/km means less energy per distance, so it is better.
 * Thresholds are the pre-existing route-efficiency bands.
 *
 * A non-finite figure (NaN / ±Infinity from a degraded sample or a
 * divide-by-zero in an upstream aggregate) is treated as the best/neutral
 * 'success' band rather than silently falling through to 'danger'. This keeps
 * the badge colour consistent with the caller's `?? 0 → 'success'` path and
 * with the displayed value, which collapses the same non-finite input to "0"
 * via `safeNumber` — a missing efficiency must never render a red badge over a
 * "0 Wh/km" readout.
 */
export function efficiencyVariant(whPerKm: number): EfficiencyVariant {
  if (!Number.isFinite(whPerKm) || whPerKm < 140) return 'success';
  if (whPerKm < 180) return 'info';
  if (whPerKm < 220) return 'warning';
  return 'danger';
}

/**
 * 1 mile expressed in kilometres. Used only at the display boundary to turn
 * a Wh/km figure into Wh/mi (there is no formatEfficiency in the SI lib, so
 * this named factor keeps the conversion out of the JSX).
 */
const KM_PER_MILE = 1.609344;

/**
 * Display-boundary unit helpers derived from the user's distance preference.
 * The API returns SI (metres for distance, Wh/km for efficiency); every value
 * is converted here, never inside a hook or in state.
 */
export interface UnitDisplay {
  /** User's distance preference ('km' | 'mi'). */
  distanceUnit: DistanceUnitPref;
  /** Efficiency label matching the distance preference. */
  efficiencyUnit: string;
  /** SI metres → display distance number. */
  toDistance: (meters: number | null | undefined) => number;
  /** Wh/km → display efficiency number (Wh/km or Wh/mi). */
  toEfficiency: (whPerKm: number | null | undefined) => number;
}

/** Build the memoisable {@link UnitDisplay} bag for a distance preference. */
export function makeUnitDisplay(distance: DistanceUnitPref): UnitDisplay {
  const isMiles = distance === 'mi';
  return {
    distanceUnit: distance,
    efficiencyUnit: isMiles ? 'Wh/mi' : 'Wh/km',
    // `safeNumber` collapses null / undefined / NaN / ±Infinity to 0 so a bad
    // upstream value can never poison the RouteCard range-bar gradient math
    // (`Math.max(NaN, 1)` is NaN, which would emit a broken `NaN%` CSS stop).
    toDistance: (meters) => convertDistanceFromSI(safeNumber(meters), distance),
    toEfficiency: (whPerKm) => {
      const w = safeNumber(whPerKm);
      return isMiles ? w * KM_PER_MILE : w;
    },
  };
}
