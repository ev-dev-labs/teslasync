import type { MetricDefinition, MetricFormat } from './types';

const metric = (label: string, description: string, format: MetricFormat,
  inputUnit: string, goodDirection: MetricDefinition['goodDirection'] = 'none'): MetricDefinition =>
  ({ label, description, format, inputUnit, goodDirection });

/**
 * Chosen candidate glossary, NOT production semantic approval or an occurrence-ID dictionary.
 * Generic quantities are deliberately neutral about aggregation and period.
 * Source-backed domain entries retain their distinct meanings.
 */
export const glossary = {
  distance: metric('Distance', 'Measured distance; canonical input is meters.', 'distance', 'm'),
  energy: metric('Energy', 'Measured energy; canonical input is watt-hours.', 'energy', 'Wh'),
  duration: metric('Duration', 'Elapsed duration; canonical input is seconds.', 'duration', 's'),
  count: metric('Count', 'Declared count, not inferred from an integer measurement.', 'count', 'count'),
  currency: metric('Cost', 'Amount in its recorded denomination; no currency conversion.', 'currency', 'currency'),
  power: metric('Power', 'Measured power; canonical input is watts.', 'power', 'W'),
  speed: metric('Speed', 'Measured speed; canonical input is meters per second.', 'speed', 'm/s'),
  percent: metric('Percentage', 'Percentage input is already on the 0–100 scale.', 'percent', '%'),
  ratio: metric('Ratio', 'Dimensionless coefficient, not a percentage.', 'ratio', 'ratio'),
  efficiency: metric('Energy intensity', 'Consumption in watt-hours per meter; not reciprocal economy.', 'efficiency', 'Wh/m'),
  temperature: metric('Temperature', 'Absolute temperature in degrees Celsius; not a temperature difference.', 'temperature', '°C'),
  pressure: metric('Pressure', 'Pressure in kilopascals.', 'pressure', 'kPa'),
  score: metric('Score', 'Numeric score on a declared 100-point scale.', 'score', 'points/100'),
  number: metric('Value', 'Unclassified numeric quantity; semantic meaning remains unknown.', 'number', 'unknown'),
  text: metric('Text', 'Source-provided text, retained without numeric coercion.', 'text', 'text'),
  status: metric('Status', 'Source-provided status, retained without numeric coercion.', 'status', 'status'),
  bytes: metric('Data size', 'Recorded byte count, displayed with binary size units.', 'bytes', 'B'),
  byteRate: metric('Data rate', 'Recorded bytes per second; the displayed interval is explicit.', 'byteRate', 'B/s'),
  latency: metric('Latency', 'Recorded non-negative elapsed time in seconds, displayed in milliseconds or seconds.', 'latency', 's'),
  mass: metric('Mass', 'Recorded mass in kilograms.', 'mass', 'kg'),
  multiplier: metric('Multiplier', 'Dimensionless multiplier, not a percentage.', 'multiplier', 'ratio'),
  rate: metric('Rate', 'Source-defined rate; the caller declares the quantity and time unit.', 'rate', 'source-defined'),
  identifier: metric('Identifier', 'Source identifier, retained without grouping or rounding.', 'identifier', 'identifier'),
  'charge.sessions': metric('Sessions', 'Number of returned charging sessions included by the existing filter.', 'count', 'count'),
  'charge.energyAdded': metric('Energy added', 'Recorded energy added on included charging sessions.', 'energy', 'Wh'),
  'charge.recordedCost': metric('Recorded cost', 'Recorded session costs, not tariff estimates or billing.', 'currency', 'currency'),
  'charge.overallRate': metric('Overall charging rate', 'Aggregate valid energy divided by corresponding positive duration; not mean session power.', 'power', 'W'),
  'charge.meanSessionPower': metric('Mean session power', 'Arithmetic mean of finite session average powers; not peak power.', 'power', 'W'),
  'charge.avgDuration': metric('Average session duration', 'Existing average session duration calculation, expressed in canonical seconds.', 'duration', 's'),
  'charge.peakPower': metric('Peak power', 'Highest observed charging power; never a replacement for an average.', 'power', 'W'),
  'seasonal.includedDrives': metric('Included drives', 'Drive count admitted by the existing seasonal eligibility rules.', 'count', 'count'),
  'seasonal.observedIntensity': metric('Observed energy intensity', 'Existing observed consumption over included drives.', 'efficiency', 'Wh/m'),
  'seasonal.fitStatus': metric('Fit status', 'Existing translated fit status; no invented eligibility threshold.', 'status', 'status'),
  'seasonal.inSampleRSquared': metric('In-sample R²', 'Existing dimensionless in-sample coefficient, not a percent.', 'ratio', 'ratio'),
} as const satisfies Record<string, MetricDefinition>;

export type MetricId = keyof typeof glossary;
