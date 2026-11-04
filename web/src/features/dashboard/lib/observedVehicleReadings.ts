import type { VehicleStateReadings } from '@/api/types';
import type { VerifiedVehicleStateField } from '@/api/hooks/useVehicles';

export function observedVehicleReadings(
  state: VehicleStateReadings | null | undefined,
  verifiedFields: readonly VerifiedVehicleStateField[] = [],
): VehicleStateReadings | null {
  if (!state) return null;
  // Retain genuine observations, including stale zeros and false values.
  // Defaults without field provenance are not measurements.
  const read = <K extends VerifiedVehicleStateField>(field: K) =>
    verifiedFields.includes(field) ? state[field] ?? null : null;
  return {
    ...state,
    state: read('state'),
    speed: read('speed'),
    power: read('power'),
    battery_level: read('battery_level'),
    rated_range: read('rated_range'),
    ideal_range: read('ideal_range'),
    odometer: read('odometer'),
    inside_temp: read('inside_temp'),
    outside_temp: read('outside_temp'),
    is_climate_on: read('is_climate_on'),
    is_charging: read('is_charging'),
    charger_power: read('charger_power'),
    charge_rate: read('charge_rate'),
    time_to_full_charge: read('time_to_full_charge'),
    is_locked: read('is_locked'),
    sentry_mode: read('sentry_mode'),
    software_version: read('software_version'),
  };
}
