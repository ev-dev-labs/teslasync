/**
 * Pure helpers for the Charging Places workspace.
 *
 * Every rate on the wire is `rate_per_wh` — SI-canonical currency units
 * per **watt-hour** (see `internal/models/system/geofence_rate.go`). The
 * UI always displays/edits currency **per kWh** (the business requirement
 * explicitly calls for this), so this module owns the one conversion
 * boundary between the two.
 *
 * `unitConversion.ts`'s `convertEnergyFromSI`/`EnergyUnitPref` is the
 * wrong tool here: that converts an energy AMOUNT (Wh → kWh by dividing
 * by 1000), whereas a price PER unit energy needs the inverse scaling
 * (currency/Wh → currency/kWh by MULTIPLYING by 1000, since the per-unit
 * price grows as the unit shrinks). These helpers are intentionally small,
 * local, and dedicated rather than bolted onto the generic energy-amount
 * conversion module. Energy AMOUNTS elsewhere in this feature (e.g.
 * `total_energy_wh`) still go through `useUnits().formatEnergy` as usual.
 */

import { formatCurrencyValue, parseCurrencyText } from '@/lib/currencyFormat';

/** Watt-hours per kilowatt-hour — the one constant this module exists for. */
const WH_PER_KWH = 1000;

/** Convert a user-facing currency/kWh rate into the canonical `rate_per_wh`. */
export function currencyPerKwhToRatePerWh(perKwh: number): number {
  return perKwh / WH_PER_KWH;
}

/** Convert a canonical `rate_per_wh` value into currency/kWh for display/editing. */
export function ratePerWhToCurrencyPerKwh(ratePerWh: number): number {
  return ratePerWh * WH_PER_KWH;
}

/**
 * Format a canonical `rate_per_wh` value as a localized currency/kWh
 * string, e.g. `0.00012` USD/Wh → `"$0.120"`. Returns `''` for a
 * null/non-finite input so callers can render a placeholder dash.
 *
 * Rates commonly need more precision than money (0.10 vs 0.12 currency/kWh
 * is a meaningful difference), so this defaults to 3 fractional digits
 * rather than the 2 used for plain costs — override via `precision` if a
 * given currency needs more.
 */
export function formatRatePerWh(
  ratePerWh: number | null | undefined,
  currency: string,
  locale: string,
  precision = 3,
): string {
  if (ratePerWh == null || !Number.isFinite(ratePerWh)) return '';
  return formatCurrencyValue(ratePerWhToCurrencyPerKwh(ratePerWh), currency, locale, precision, {
    useGrouping: true,
  });
}

/**
 * Parse a user-typed currency/kWh string (locale-aware, symbol-tolerant —
 * see `parseCurrencyText`) into a canonical `rate_per_wh` value. Returns
 * `null` for empty/unparseable input so the caller's form validation can
 * surface a precise "required"/"invalid" message rather than silently
 * coercing to 0.
 */
export function parseRatePerWhFromCurrencyPerKwh(
  text: string,
  currency: string,
  locale: string,
): number | null {
  const perKwh = parseCurrencyText(text, currency, locale);
  if (perKwh == null) return null;
  return currencyPerKwhToRatePerWh(perKwh);
}

/** Whether a rate version's half-open interval is unbounded at the end. */
export function isRateOpen(rate: { effective_to?: string | null }): boolean {
  return rate.effective_to == null;
}

/**
 * Whether a rate version was active at instant `at` (defaults to now),
 * mirroring the backend's `GeofenceRate.IsActiveAt` half-open interval
 * semantics exactly so the frontend never disagrees with pricing history.
 */
export function isRateActiveAt(
  rate: { effective_from: string; effective_to?: string | null },
  at: Date = new Date(),
): boolean {
  const from = new Date(rate.effective_from).getTime();
  if (Number.isNaN(from) || at.getTime() < from) return false;
  if (rate.effective_to == null) return true;
  const to = new Date(rate.effective_to).getTime();
  return Number.isNaN(to) ? true : at.getTime() < to;
}
