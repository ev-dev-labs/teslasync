import { describe, expect, it } from 'vitest';
import { formatEnergyPerDistance, formatTemperatureDelta, type UnitPref } from './unitConversion';

const pref: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
  energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US',
};

describe('analysis display units', () => {
  it('scales temperature differences without an absolute offset', () => {
    expect(formatTemperatureDelta(0, { ...pref, temperature: '°F' })).toBe('0.0°F');
    expect(formatTemperatureDelta(10, { ...pref, temperature: '°F' })).toBe('18.0°F');
    expect(formatTemperatureDelta(10, pref)).toBe('10.0°C');
  });
  it('formats SI consumption per preferred distance', () => {
    expect(formatEnergyPerDistance(0.2, pref)).toBe('200 Wh/km');
    expect(formatEnergyPerDistance(0.2, { ...pref, distance: 'mi' })).toBe('322 Wh/mi');
    expect(formatEnergyPerDistance(null, pref)).toBe('—');
  });
});
