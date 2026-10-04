import type { MetricId, MetricPreferences, MetricRaw } from '@/lib/metric-reference';

export interface FormatFixture {
  readonly id: string;
  readonly metricId: MetricId;
  readonly rawValue: MetricRaw;
  readonly originalExample: string;
  readonly units?: Partial<MetricPreferences['units']>;
}
/** Synthetic canonical fixtures. Original examples retained, not asserted as new defaults. */
export const formatFixtures: readonly FormatFixture[] = [
  { id: 'count-six', metricId: 'count', rawValue: 6, originalExample: '6' },
  { id: 'count-grouped', metricId: 'count', rawValue: 1240, originalExample: '1,240' },
  { id: 'currency-small', metricId: 'currency', rawValue: 33.6, originalExample: '$33.60' },
  { id: 'currency-grouped', metricId: 'currency', rawValue: 1204.5, originalExample: '$1,204.50' },
  { id: 'currency-zero', metricId: 'currency', rawValue: 0, originalExample: '$0.00' },
  { id: 'currency-long', metricId: 'currency', rawValue: 12345678.9, originalExample: '$12,345,678.90' },
  { id: 'currency-drift', metricId: 'currency', rawValue: 36.7, originalExample: '$36.7 → $36.70 (historical proposed example)' },
  { id: 'energy-small', metricId: 'energy', rawValue: 4500, originalExample: '4.5 kWh' },
  { id: 'energy-medium', metricId: 'energy', rawValue: 26300, originalExample: '26.3 kWh' },
  { id: 'energy-large', metricId: 'energy', rawValue: 158000, originalExample: '158 kWh' },
  { id: 'energy-wh', metricId: 'energy', rawValue: 850, originalExample: '850 Wh', units: { energy: 'Wh' } },
  { id: 'energy-drift', metricId: 'energy', rawValue: 183800, originalExample: '183.8 kWh' },
  { id: 'energy-planned', metricId: 'energy', rawValue: 184000, originalExample: '184 kWh' },
  { id: 'energy-round-low', metricId: 'energy', rawValue: 26340, originalExample: '26.34 → 26.3 (historical adaptive example)' },
  { id: 'energy-round-high', metricId: 'energy', rawValue: 158400, originalExample: '158.4 → 158 (historical adaptive example)' },
  { id: 'power-small', metricId: 'power', rawValue: 12100, originalExample: '12.1 kW' },
  { id: 'power-large', metricId: 'power', rawValue: 150000, originalExample: '150.0 kW' },
  { id: 'duration-minutes', metricId: 'duration', rawValue: 1920, originalExample: '32m' },
  { id: 'duration-hours', metricId: 'duration', rawValue: 7800, originalExample: '2h 10m' },
  { id: 'duration-whole', metricId: 'duration', rawValue: 21600, originalExample: '6h 00m' },
  { id: 'duration-days', metricId: 'duration', rawValue: 273600, originalExample: '3d 4h' },
  { id: 'duration-drift', metricId: 'duration', rawValue: 8280, originalExample: '2.3 h → 2h 18m (historical humanized example)' },
  { id: 'duration-before-day', metricId: 'duration', rawValue: 86399.99, originalExample: 'Just below 24 hours' },
  { id: 'duration-day', metricId: 'duration', rawValue: 86400, originalExample: 'Exactly 24 hours' },
  { id: 'distance-km', metricId: 'distance', rawValue: 14500, originalExample: '14.5 km' },
  { id: 'distance-mi', metricId: 'distance', rawValue: 1234366.848, originalExample: '767 mi', units: { distance: 'mi' } },
  { id: 'speed-km', metricId: 'speed', rawValue: 160 / 9, originalExample: '64 km/h' },
  { id: 'percent-whole', metricId: 'percent', rawValue: 74, originalExample: '74%' },
  { id: 'percent-fraction', metricId: 'percent', rawValue: 4.5, originalExample: '4.5%' },
  { id: 'efficiency-mi', metricId: 'efficiency', rawValue: 300 / 1609.344, originalExample: '300 Wh/mi', units: { distance: 'mi', energy: 'Wh' } },
  { id: 'efficiency-km', metricId: 'efficiency', rawValue: 0.186, originalExample: '18.6 kWh/100km (same quantity; selected display unit preserved)' },
  { id: 'temperature-c', metricId: 'temperature', rawValue: 21.5, originalExample: '21.5°C' },
  { id: 'grade', metricId: 'status', rawValue: 'A', originalExample: 'A' },
  { id: 'score', metricId: 'score', rawValue: 85, originalExample: '85/100' },
  { id: 'zero', metricId: 'energy', rawValue: 0, originalExample: '0 kWh' },
  { id: 'negative-zero', metricId: 'currency', rawValue: -0, originalExample: '-0 must not appear' },
  { id: 'null', metricId: 'power', rawValue: null, originalExample: 'Missing, not zero' },
  { id: 'undefined', metricId: 'number', rawValue: undefined, originalExample: 'Missing, not zero' },
  { id: 'nan', metricId: 'power', rawValue: NaN, originalExample: 'Invalid finite measurement' },
  { id: 'positive-infinity', metricId: 'energy', rawValue: Infinity, originalExample: 'Invalid finite measurement' },
  { id: 'negative-infinity', metricId: 'duration', rawValue: -Infinity, originalExample: 'Invalid finite measurement' },
  { id: 'round-100', metricId: 'energy', rawValue: 99950, originalExample: '99.95 kWh rounding boundary' },
  { id: 'round-hour', metricId: 'duration', rawValue: 3576, originalExample: '59.6 minutes; preserve duration preference, no forced minute rollover' },
  { id: 'sub-minute', metricId: 'duration', rawValue: 0.25, originalExample: 'Sub-minute source detail retained', units: { duration: 's' } },
  { id: 'signed', metricId: 'temperature', rawValue: -21.5, originalExample: 'Signed measurement' },
  { id: 'rounded-negative', metricId: 'currency', rawValue: -0.00001, originalExample: 'No display-rounded negative zero' },
  { id: 'ratio', metricId: 'ratio', rawValue: 0.045, originalExample: 'Ratio is not 4.5%' },
  { id: 'pressure', metricId: 'pressure', rawValue: 250, originalExample: '250 kPa', units: { pressure: 'kPa' } },
  { id: 'extreme', metricId: 'distance', rawValue: Number.MAX_VALUE, originalExample: 'Finite numeric extreme' },
  { id: 'overflow', metricId: 'speed', rawValue: Number.MAX_VALUE, originalExample: 'Display conversion overflow is invalid' },
  { id: 'tiny', metricId: 'number', rawValue: Number.MIN_VALUE, originalExample: 'Smallest positive finite input' },
];

export const stripMetrics = [
  { metricId: 'count', rawValue: 6 },
  { metricId: 'energy', rawValue: 158000 },
  { metricId: 'currency', rawValue: 33.6 },
  { metricId: 'charge.overallRate', rawValue: 12100 },
  { metricId: 'duration', rawValue: 7800 },
  { metricId: 'charge.peakPower', rawValue: 23300 },
] as const;
