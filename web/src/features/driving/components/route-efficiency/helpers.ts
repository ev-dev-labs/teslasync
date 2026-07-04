import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';

export type EfficiencyVariant = 'success' | 'info' | 'warning' | 'danger';

/**
 * Map an efficiency figure (Wh/km, SI-per-km as returned by the API) onto a
 * Badge variant. Lower Wh/km means less energy per distance, so it is better.
 * Thresholds are the pre-existing route-efficiency bands.
 */
export function efficiencyVariant(whPerKm: number): EfficiencyVariant {
  if (whPerKm < 140) return 'success';
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
    toDistance: (meters) => convertDistanceFromSI(meters ?? 0, distance),
    toEfficiency: (whPerKm) => (isMiles ? (whPerKm ?? 0) * KM_PER_MILE : whPerKm ?? 0),
  };
}
