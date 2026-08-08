import { fmtNumber } from '@/lib/numberFormat';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { convertDistanceToSI, convertEnergyFromSI, type UnitPref } from '@/lib/unitConversion';

/**
 * Ownership display formatters.
 *
 * Every helper here takes canonical SI (metres, seconds, watt-hours, watts) or
 * ISO-4217 minor units and converts only at the render boundary, per the
 * phase-48 SI cutover rule. Nothing in this module ever produces a stored value.
 */

/** Format an ISO-currency amount supplied in that currency's minor units. */
export function formatCurrencyMinor(
  minor: number | null | undefined,
  currency: string | null | undefined,
  locale = 'en-US',
): string {
  if (minor == null || !Number.isFinite(minor) || !currency) return '—';
  let fractionDigits = 2;
  try {
    fractionDigits =
      new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // The shared formatter renders an unknown code with a literal prefix.
  }
  const major = minor / 10 ** fractionDigits;
  return formatCurrencyValue(major, currency, locale, fractionDigits, { useGrouping: true }) || '—';
}

/**
 * Format a per-watt-hour price (in minor units) as a price per the user's
 * preferred energy unit — e.g. 0.00018 minor/Wh becomes "18.00 ¢/kWh"-ish in
 * whatever the locale's minor unit is called.
 */
export function formatPricePerEnergy(
  minorPerWh: number | null | undefined,
  currency: string | null | undefined,
  units: UnitPref,
  locale = 'en-US',
): string {
  if (minorPerWh == null || !Number.isFinite(minorPerWh) || !currency) return '—';
  // 1 display energy unit expressed in Wh: invert the from-SI conversion.
  const displayUnitInWh = 1 / (convertEnergyFromSI(1, units.energy) || 1);
  const minorPerDisplayUnit = minorPerWh * displayUnitInWh;
  return `${formatCurrencyMinor(minorPerDisplayUnit, currency, locale)}/${units.energy}`;
}

/**
 * Format a per-metre price (in minor units) as a price per the user's preferred
 * distance unit.
 */
export function formatPricePerDistance(
  minorPerM: number | null | undefined,
  currency: string | null | undefined,
  units: UnitPref,
  locale = 'en-US',
): string {
  if (minorPerM == null || !Number.isFinite(minorPerM) || !currency) return '—';
  const displayUnitInM = convertDistanceToSI(1, units.distance);
  return `${formatCurrencyMinor(minorPerM * displayUnitInM, currency, locale)}/${units.distance}`;
}

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

/** Percentage with a fixed precision, or an em dash when not computed. */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${fmtNumber(value, digits)}%`;
}

/** Signed percentage — used for deltas where direction carries meaning. */
export function formatSignedPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmtNumber(value, digits)}%`;
}

/** Plain number with an em-dash fallback. */
export function formatCount(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return fmtNumber(value, digits);
}

/** Byte count in binary multiples, capped at TiB. */
export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${fmtNumber(scaled, index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Render a duration in seconds as a coarse human span. Used where an exact
 * clock reading is noise — retention windows, warranty terms, remaining life.
 */
export function formatSpan(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';
  if (abs < 3600) return `${sign}${fmtNumber(abs / 60, 0)} min`;
  if (abs < 172800) return `${sign}${fmtNumber(abs / 3600, 1)} h`;
  if (abs < 63072000) return `${sign}${fmtNumber(abs / 86400, 0)} d`;
  return `${sign}${fmtNumber(abs / 31557600, 1)} y`;
}

/** Convert seconds to whole days for form inputs that think in days. */
export function secondsToDays(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return Math.round(seconds / 86400);
}

/** Convert whole days back to canonical seconds. */
export function daysToSeconds(days: number | null | undefined): number {
  if (days == null || !Number.isFinite(days)) return 0;
  return Math.round(days * 86400);
}

/** ISO date-time string for `<input type="datetime-local">` round-tripping. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

/** Turn a `yyyy-mm-dd` form value into an RFC-3339 instant at UTC midnight. */
export function fromDateInput(value: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
