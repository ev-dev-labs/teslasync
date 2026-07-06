import type { ChargingSession } from '@/api/types';
import { KWH_PER_GALLON } from './constants';

export function categorizeCharger(session: ChargingSession): string {
  const ct = (session.charger_type ?? '').toLowerCase();
  if (ct.includes('tesla') || ct.includes('supercharger')) return 'Supercharger';
  if ((session.peak_power_w ?? 0) > 22_000) return 'Public DC';
  const loc = (session.start_place ?? '').toLowerCase();
  if (loc.includes('work') || loc.includes('office')) return 'Work / L2';
  return 'Home';
}

export function gasEquivalentCost(
  energyKwh: number,
  _mpg: number,
  gasPrice: number,
): number {
  // Energy-content equivalence: the gasoline (in gallons) that holds the same
  // energy as `energyKwh`, priced at `gasPrice`. This mirrors coreStats.gasCost
  // and the Go lifetime handler (gallons × gasPrice). Vehicle mpg does not
  // affect this equivalence, so `_mpg` is intentionally unused — the previous
  // `× mpg ÷ mpg` round-trip both obscured that and returned 0 / 0 = NaN when
  // mpg was 0. Non-finite inputs collapse to 0 so a bad upstream value can
  // never poison the monthly savings columns with NaN.
  const kwh = Number.isFinite(energyKwh) ? energyKwh : 0;
  const price = Number.isFinite(gasPrice) ? gasPrice : 0;
  return (kwh / KWH_PER_GALLON) * price;
}
