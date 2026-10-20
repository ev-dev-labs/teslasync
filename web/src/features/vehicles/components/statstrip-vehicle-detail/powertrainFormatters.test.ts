import { describe, expect, it } from 'vitest';
import type { MetricPreferences } from '@/lib/metric-reference';
import { voltageFormatter, currentFormatter, torqueFormatter, rpmFormatter } from './powertrainFormatters';

const preferences: MetricPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
  currency: { kind: 'symbol', value: '$' },
};

describe('numeric specialist display callbacks', () => {
  it('retains source V/A/Nm and direct signed RPM rather than converting measurements to text metrics', () => {
    expect(voltageFormatter(400, preferences)).toEqual({ value: '400.00', unit: 'V' });
    expect(currentFormatter(7.84, preferences)).toEqual({ value: '7.84', unit: 'A' });
    expect(torqueFormatter(78.51, preferences)).toEqual({ value: '78.51', unit: 'Nm' });
    expect(rpmFormatter(-343, preferences)).toEqual({ value: '-343', unit: 'RPM' });
    expect(rpmFormatter(0, preferences)).toEqual({ value: '0', unit: 'RPM' });
  });

  it('preserves locale and precision for specialist measurements while RPM remains an integer', () => {
    const localized = { ...preferences, units: { ...preferences.units, locale: 'de-DE', precision: 1 } };
    expect(currentFormatter(7.84, localized)).toEqual({ value: '7,8', unit: 'A' });
    expect(rpmFormatter(1234.4, localized)).toEqual({ value: '1.234', unit: 'RPM' });
  });
});
