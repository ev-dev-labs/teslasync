import { describe, expect, it } from 'vitest';
import { objectsToCSV } from '@/lib/csvExport';
import type { ThermalTaxSample } from '../../lib/chargingThermalTax';
import { thermalPowerRows } from './thermalPresentation';

function sample(ts: string, heater: number | null = 1234.5): ThermalTaxSample {
  return {
    ts,
    battery_heater_power_w: heater,
    ac_charging_power_w: 250.5,
    dc_charging_power_w: 5000.25,
    ac_charging_energy_in_wh: null,
    dc_charging_energy_in_wh: null,
  };
}

describe('thermalPowerRows timestamp identity', () => {
  it('retains exact source offsets and precision when short labels repeat across a DST transition', () => {
    const earlier = '2026-11-01T01:30:00.123456-07:00';
    const later = '2026-11-01T01:30:00.123456-08:00';
    const rows = thermalPowerRows([sample(later, null), sample(earlier)], 'en-US', () => '01:30');

    expect(rows).toEqual([
      { timestamp: earlier, tMs: Date.parse(earlier), time: '01:30', heaterW: 1234.5, chargeW: 5250.75 },
      { timestamp: later, tMs: Date.parse(later), time: '01:30', heaterW: null, chargeW: 5250.75 },
    ]);
    const csv = objectsToCSV(rows);
    expect(csv).toContain('timestamp');
    expect(csv).toContain(earlier);
    expect(csv).toContain(later);
    expect(csv).toContain('1234.5');
    expect(csv).toContain('5250.75');
    expect(csv).not.toContain('null');
  });

  it('preserves populated UTC readings, localized axis labels, measured zero and null gaps', () => {
    const ts = '2026-10-01T00:00:00Z';
    const rows = thermalPowerRows([
      sample(ts, 0),
      { ...sample('2026-10-02T00:00:00Z', null), ac_charging_power_w: null, dc_charging_power_w: null },
      sample('invalid'),
    ], 'de-DE');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      timestamp: ts,
      tMs: Date.parse(ts),
      time: new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      heaterW: 0,
      chargeW: 5250.75,
    });
    expect(rows[1]).toMatchObject({ timestamp: '2026-10-02T00:00:00Z', heaterW: null, chargeW: null });
    expect(thermalPowerRows([], 'de-DE')).toEqual([]);
  });
});
