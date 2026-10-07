import { fmtNumber } from '@/lib/numberFormat';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import {
  convertDistanceToSI,
  convertEnergyFromSI,
  type UnitPref,
} from '@/lib/unitConversion';

/** Format canonical Wh/m in the user's energy-per-distance display units. */
export function formatEfficiencyFromSI(
  whPerM: number | null | undefined,
  units: UnitPref,
): string {
  if (whPerM == null || !Number.isFinite(whPerM)) return '—';
  const whPerDisplayDistance = whPerM * convertDistanceToSI(1, units.distance);
  const energy = convertEnergyFromSI(whPerDisplayDistance, units.energy);
  return `${fmtNumber(energy, 3)} ${units.energy}/${units.distance}`;
}

/** Format an ISO-currency amount supplied in that currency's minor units. */
export function formatCurrencyMinor(
  minor: number | null | undefined,
  currency: string | null | undefined,
  locale = 'en-US',
): string {
  if (minor == null || !Number.isFinite(minor) || !currency) return '—';
  let fractionDigits = 2;
  try {
    fractionDigits = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // The shared formatter safely renders an invalid code with a literal prefix.
  }
  const major = minor / (10 ** fractionDigits);
  return formatCurrencyValue(
    major,
    currency,
    locale,
    fractionDigits,
    { useGrouping: true },
  ) || '—';
}
