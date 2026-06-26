import type {ChargingSession} from '../../../../api/types';

// ── Inlined constant (mirror web ./constants KWH_PER_GALLON) ──────────────
// The sibling ./constants module is not a converted native target yet, so the
// single value consumed by gasEquivalentCost is inlined here verbatim: 33.7
// kWh is the energy equivalent of one US gallon of gasoline.
const KWH_PER_GALLON = 33.7;

export function categorizeCharger(session: ChargingSession): string {
  const ct = (session.charger_type ?? '').toLowerCase();
  if (ct.includes('tesla') || ct.includes('supercharger'))
    return 'Supercharger';
  if ((session.peak_power_w ?? 0) > 22_000) return 'Public DC';
  const loc = (session.start_place ?? '').toLowerCase();
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
