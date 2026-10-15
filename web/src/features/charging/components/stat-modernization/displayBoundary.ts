import {
  convertDurationFromSI, convertEnergyFromSI, convertPowerFromSI, convertDistanceToSI,
} from '@/lib/unitConversion';
import type { MetricDisplayOptions, MetricRaw } from '@/lib/metric-reference';

/** Derived local kWh/min/kW fields are display inputs, never API/DTO conversions. */
// Runtime guards also preserve unexpected raw text for formatMetric's invalid state;
// a numeric-looking string is never parsed/coerced into a measured quantity.
export const kwhToCanonicalWh = (value: number | null | undefined): MetricRaw =>
  value == null ? null : typeof value === 'number' ? value / convertEnergyFromSI(1, 'kWh') : value;
export const minutesToCanonicalSeconds = (value: number | null | undefined): MetricRaw =>
  value == null ? null : typeof value === 'number' ? value / convertDurationFromSI(1, 'min') : value;
export const kwToCanonicalWatts = (value: number | null | undefined): MetricRaw =>
  value == null ? null : typeof value === 'number' ? value / convertPowerFromSI(1, 'kW') : value;
export const kmToCanonicalMeters = (value: number | null | undefined): MetricRaw =>
  value == null ? null : typeof value === 'number' ? convertDistanceToSI(value, 'km') : value;

/** Existing explicit kWh/kW/min labels keep their original display contract. */
export const energyDisplay: MetricDisplayOptions = { units: { energy: 'kWh' } };
export const powerDisplay: MetricDisplayOptions = { units: { power: 'kW' } };
export const minuteDisplay: MetricDisplayOptions = { units: { duration: 'min' } };
