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

/** Stable category codes are distinct from server/user display names. */
export function chargerCategoryLabel(
  t: (key: string, fallback: string) => string,
  code: string,
  suppliedName?: string | null,
): string {
  if (suppliedName != null) return suppliedName;
  switch (code) {
    case 'home': return t('costAnalysis.category.home', 'Home');
    case 'supercharger': return t('costAnalysis.category.supercharger', 'Supercharger');
    case 'public': return t('costAnalysis.category.public', 'Public');
    case 'public_dc': return t('costAnalysis.category.publicDC', 'Public DC');
    case 'work_l2': return t('costAnalysis.category.workL2', 'Work / L2');
    case 'other': return t('costAnalysis.category.other', 'Other');
    default: return code;
  }
}

export function chargerCategoryCode(session: ChargingSession): string {
  const raw = session.charger_type;
  const code = raw?.toLowerCase();
  if (code && ['home','supercharger','public','public_dc','work_l2','other'].includes(code)) return code;
  if (raw && !/^(?:tesla\b|supercharger\b|ccs\b|ac$|dc$|type[ _-]?2$|j1772$)/i.test(raw)) return raw;
  const category = categorizeCharger(session);
  return ({Home:'home',Supercharger:'supercharger','Public DC':'public_dc','Work / L2':'work_l2'} as Record<string,string>)[category] ?? category;
}
