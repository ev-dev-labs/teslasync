import type { ChargingSession } from '@/api/types';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { CurvePoint } from './types';

export function isDcSession(s: ChargingSession): boolean {
  return !!(s.charger_type || (s.charger_power_kw_max && s.charger_power_kw_max > 20));
}

export function getChargerLabel(s: ChargingSession): string {
  if (s.charger_type === 'Tesla' || (s.charger_type ?? '').toLowerCase().includes('tesla'))
    return 'Supercharger';
  if (s.charger_type) return 'DC Fast';
  if (s.charger_power_kw_max && s.charger_power_kw_max > 20) return 'DC Fast';
  return 'Home / AC';
}

export function sessionLabel(s: ChargingSession): string {
  const date = formatDateShort(s.start_ts);
  const label = getChargerLabel(s);
  const energy = s.energy_added_kwh != null ? fmtNumber(s.energy_added_kwh, 1) : '?';
  return `${date} — ${label} — ${energy} kWh`;
}

/** Simulate a power-vs-SOC curve based on session metadata. */
export function generateChargingCurve(session: ChargingSession): CurvePoint[] {
  const points: CurvePoint[] = [];
  const startSoc = session.start_battery_pct;
  const endSoc = session.end_battery_pct ?? 100;
  const peakPower = session.charger_power_kw_max ?? 11;
  const dc = isDcSession(session);

  for (let soc = startSoc; soc <= endSoc; soc += 1) {
    let power: number;
    if (dc) {
      if (soc <= 50) {
        power = peakPower;
      } else if (soc <= 80) {
        const taper = 1 - ((soc - 50) / 30) * 0.5;
        power = peakPower * taper;
      } else {
        const drop = 1 - ((soc - 80) / 20) * 0.7;
        power = peakPower * 0.5 * drop;
      }
    } else {
      power = peakPower;
    }
    points.push({ soc, power: Math.max(power, 0) });
  }
  return points;
}

export function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
