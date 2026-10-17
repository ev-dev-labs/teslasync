import type { Drive } from '../../src/api/types';
import type { ClimateWire } from './vehicle-systems.fixtures';

export const preconditioningPath = '/preconditioning-effectiveness?vehicle_id=7';
export type TemperaturePreference = 'C' | 'F';
export type DepartureWire = Pick<
  Drive, 'id' | 'vehicle_id' | 'start_ts' | 'end_ts' | 'duration_s' | 'distance_m'
>;

const departure = Date.UTC(2026, 7, 25, 8);
const hourMs = 3_600_000;

function climateAt(
  departureMs: number, minutesBefore: number, insideC: number, hvacPower: boolean,
): ClimateWire {
  return {
    timestamp: new Date(departureMs - minutesBefore * 60_000).toISOString(),
    inside_temp: insideC,
    driver_temp_setting: 21,
    passenger_temp_setting: 21,
    hvac_power: hvacPower,
  };
}

// Translate the public unit fixture at preconditioningEffectiveness.test.ts:344-370
// through the real snake_case wire. The hot active sibling is not a cold control.
export const matchedClimate: ClimateWire[] = [
  climateAt(departure, 30, 35, false),
  climateAt(departure, 5, 24, true),
  climateAt(departure + hourMs, 30, 5, false),
  climateAt(departure + hourMs, 5, 18, true),
  climateAt(departure + 2 * hourMs, 30, 6, false),
  climateAt(departure + 2 * hourMs, 5, 7, false),
];

export const matchedDepartures: DepartureWire[] = [0, 1, 2].map(index => ({
  id: 9101 + index,
  vehicle_id: 7,
  start_ts: new Date(departure + index * hourMs).toISOString(),
  end_ts: null,
  duration_s: 600,
  distance_m: 1_000,
}));

export const matchedExpected = {
  climateReturned: 6,
  drivesReturned: 3,
  classified: 3,
  active: 2,
  control: 1,
  hotActive: 1,
  hotControl: 0,
  coldActive: 1,
  coldControl: 1,
  pooledActive: 1,
  pooledControl: 1,
  readinessActiveC: 3,
  readinessControlC: 14,
  readinessDifferenceC: 11,
  improvementActiveC: 13,
  improvementControlC: 1,
  improvementDifferenceC: 12,
  balancedPairs: 1,
  comparisonVolume: 2,
  confidence: 1 / 48,
  observationSpanS: 1_500,
  finalStateLeadS: 300,
  driveSpanS: 7_200,
  climateSpanS: 8_700,
} as const;

// Deliberately independent of the product converter: a delta changes scale,
// never origin. In Fahrenheit, +11 C is +19.80 F, not +51.80 F.
export function expectedDelta(
  celsius: number, preference: TemperaturePreference, signed = false,
): string {
  const value = preference === 'F' ? celsius * 9 / 5 : celsius;
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(2)} °${preference}`;
}

export const supportedBandIds = [
  'preconditioning-evidence',
  'preconditioning-climate-source-summary',
  'preconditioning-drive-source-summary',
  'preconditioning-climate-disposition-summary',
  'preconditioning-departure-disposition-summary',
  'preconditioning-join-summary',
  'preconditioning-availability-summary',
  'preconditioning-confidence-summary',
] as const;
