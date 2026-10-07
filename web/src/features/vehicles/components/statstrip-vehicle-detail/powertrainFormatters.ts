import { fmtNumber } from '@/lib/numberFormat';
import type { MetricPreferences } from '@/lib/metric-reference';

const measurement = (unit: string) => (raw: number, preferences: MetricPreferences) => ({
  value: fmtNumber(raw, preferences.units.precision, preferences.units.locale),
  unit,
});

export const voltageFormatter = measurement('V');
export const currentFormatter = measurement('A');
export const torqueFormatter = measurement('Nm');
/** Existing axle readings are displayed directly, not inferred to be rad/s. */
export const rpmFormatter = (raw: number, preferences: MetricPreferences) => ({
  value: fmtNumber(raw, 0, preferences.units.locale),
  unit: 'RPM',
});
