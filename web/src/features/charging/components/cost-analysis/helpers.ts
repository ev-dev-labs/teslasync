import type { ChargingSession } from '@/api/types';
import { KWH_PER_GALLON } from './constants';

export function categorizeCharger(session: ChargingSession): string {
  const ct = (session.charger_type ?? '').toLowerCase();
  if (ct.includes('tesla') || ct.includes('supercharger')) return 'Supercharger';
  if ((session.charger_power_kw_max ?? 0) > 22) return 'Public DC';
  const loc = (session.charger_location ?? '').toLowerCase();
  if (loc.includes('work') || loc.includes('office')) return 'Work / L2';
  return 'Home';
}

export function gasEquivalentCost(
  energyKwh: number,
  mpg: number,
  gasPrice: number,
): number {
  const gallonsEquiv = energyKwh / KWH_PER_GALLON;
  const milesEquiv = gallonsEquiv * mpg;
  return (milesEquiv / mpg) * gasPrice;
}
