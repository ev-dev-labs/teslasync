/**
 * Native web-parity port of `web/src/hooks/useFormatting.ts`.
 *
 * Currency + energy-cost formatting bound to the user's settings. Use this in
 * callback contexts where a component cannot be inserted — chart tick/tooltip
 * formatters, table cell renderers, or file-export builders that need a raw
 * string or numeric cost.
 *
 * Returned helpers (contract identical to web):
 *   - `costPerKwh`              — settings.base_cost_per_kwh (0.12 fallback).
 *   - `currencySymbol`         — settings.currency_symbol, '$' fallback.
 *   - `formatEnergyCost(kwh)`  — `${symbol}${fmtNumber(kwh * costPerKwh, precision)}`.
 *   - `formatCurrency(n, d?)`  — `${symbol}${fmtNumber(n, d ?? precision)}`.
 *   - `costPerDistanceUnit(kwh, distanceM)` — cost per the user's distance unit
 *     from SI meters, or `null` when distance is non-positive.
 *   - `estimateGasCost(distanceM)` — gasoline-equivalent cost from SI meters,
 *     or `null` when mpg / gas price / distance is non-positive.
 *
 * Native adaptations (the formatter contract itself is unchanged):
 *   - The web hook read settings + unit prefs through the app-level
 *     `@/hooks/useSettings` + `@/hooks/useUnits` wrappers and imported
 *     `fmtNumber` / `convertDistanceFromSI` / `FUEL` from `@/lib/*`. None of
 *     those exist in the native web-parity layer, so — following the
 *     established self-contained idiom the converted pages use
 *     (FleetComparePage / CostAnalysisPage / TripListPage all inline these
 *     `@/lib` helpers and derive unit prefs from the native settings query) —
 *     the `['settings']` query is read through the native
 *     `../api/hooks/useSettings` hook, the web `useSettings` defaults are merged
 *     for the fields this hook consumes (the web wrapper never returns
 *     `undefined`), the single `unitPrefs.distance` pref `useUnits` exposed is
 *     derived inline via `deriveDistance`, and `fmtNumber` /
 *     `convertDistanceFromSI` / `GALLONS_TO_LITERS` are ported verbatim here.
 *   - Web's `fmtNumber` read a module-global locale that `useSettings` kept in
 *     sync via a `setGlobalLocale` side-effect. The native settings query has no
 *     such side-effect, so the resolved `settings.locale` is threaded
 *     explicitly into the inlined `fmtNumber` to preserve locale-aware (i18n)
 *     number formatting; the bad-locale try/catch keeps it native-safe.
 */

import { useCallback, useMemo } from 'react';

import { useSettings, type AppSettings } from '../api/hooks/useSettings';

/* ── Ported verbatim from web @/lib/constants (FUEL) ──────────────────────── */

/** 1 US gallon = 3.78541 L (web `FUEL.GALLONS_TO_LITERS`). */
const GALLONS_TO_LITERS = 3.78541;

/* ── Ported verbatim from web @/lib/unitConversion ────────────────────────── */

/** Distance display unit (target of `convertDistanceFromSI`). */
type DistanceUnitPref = 'km' | 'mi' | 'ft';

/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000;
/** 1 mile = 1609.344 m exactly (international yard, NIST). */
const METERS_PER_MILE = 1609.344;
/** 1 ft = 0.3048 m exactly (international foot, NIST). */
const METERS_PER_FOOT = 0.3048;

/** Convert distance from SI meters to the user's display unit. */
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    default:
      return meters / METERS_PER_KM;
  }
}

/* ── Ported from web @/lib/numberFormat (safeNumber + fmtNumber) ───────────── */

/** Mirrors web `lib/numberFormat.safeNumber`: nullish / non-finite -> 0. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/**
 * Mirrors web `lib/numberFormat.fmtNumber`. The web fn sourced its locale from a
 * module-global kept in sync by `useSettings`; here the resolved locale is
 * passed in so formatting stays locale-aware. A bad locale tag falls back to
 * 'en-US' so a string is always produced.
 */
function fmtNumber(v: unknown, decimals: number, locale: string): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

/* ── Settings derivation (mirrors web useSettings + useUnits) ──────────────── */

/**
 * Mirrors web `@/lib/locale` `resolveLocale` + the `useSettings` empty-string
 * guard: empty / whitespace-only -> 'en-US' so `Intl` never throws RangeError.
 */
function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) return locale;
  return 'en-US';
}

/** Mirrors web `useUnits.deriveDistance`: `unit_of_length === 'mi'` -> 'mi' else 'km'. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

/**
 * The subset of the web `useSettings` defaults this hook reads. The native
 * settings query returns `undefined` until it resolves; merging these defaults
 * reproduces the web wrapper's defaults-merged settings object (the web hook
 * never sees `undefined`). Values mirror the web `useSettings` `defaults`.
 */
type FormattingSettings = Pick<
  AppSettings,
  | 'base_cost_per_kwh'
  | 'currency_symbol'
  | 'decimal_precision'
  | 'gas_efficiency_mpg'
  | 'gas_price_per_unit'
  | 'gas_unit'
  | 'unit_of_length'
  | 'locale'
>;

const FORMATTING_DEFAULTS: FormattingSettings = {
  base_cost_per_kwh: 0.12,
  currency_symbol: '$',
  decimal_precision: 2,
  gas_efficiency_mpg: 25,
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  unit_of_length: 'km',
  locale: 'en-US',
};

export interface UseFormattingResult {
  costPerKwh: number;
  currencySymbol: string;
  formatEnergyCost: (kwh: number) => string;
  formatCurrency: (amount: number, decimals?: number) => string;
  costPerDistanceUnit: (kwh: number, distanceM: number) => number | null;
  estimateGasCost: (distanceM: number) => number | null;
}

export function useFormatting(): UseFormattingResult {
  const { data: settings } = useSettings();
  const s: FormattingSettings = settings ?? FORMATTING_DEFAULTS;

  const costPerKwh = s.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    s.currency_symbol && s.currency_symbol.trim() ? s.currency_symbol : '$';
  const userPrecision =
    typeof s.decimal_precision === 'number' &&
    Number.isFinite(s.decimal_precision) &&
    s.decimal_precision >= 0
      ? Math.floor(s.decimal_precision)
      : 2;
  const locale = resolveLocale(s.locale);
  const distancePref = deriveDistance(s.unit_of_length);

  const formatEnergyCost = useCallback(
    (kwh: number): string => {
      const cost = kwh * costPerKwh;
      return `${currencySymbol}${fmtNumber(cost, userPrecision, locale)}`;
    },
    [costPerKwh, currencySymbol, userPrecision, locale],
  );

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string => {
      const d = decimals ?? userPrecision;
      return `${currencySymbol}${fmtNumber(amount, d, locale)}`;
    },
    [currencySymbol, userPrecision, locale],
  );

  /**
   * Calculate cost per user-preferred distance unit from SI meters.
   * @since SI cutover: distanceM input changed from legacy miles to SI meters.
   */
  const costPerDistanceUnit = useCallback(
    (kwh: number, distanceM: number): number | null => {
      if (distanceM <= 0) return null;
      const cost = kwh * costPerKwh;
      const distance = convertDistanceFromSI(distanceM, distancePref);
      return distance > 0 ? cost / distance : null;
    },
    [costPerKwh, distancePref],
  );

  /**
   * Estimate gasoline cost for an SI-meter distance. MPG is miles-based, so
   * this one internal bridge converts meters to miles before applying mpg.
   * @since SI cutover: distanceM input changed from legacy miles to SI meters.
   */
  const estimateGasCost = useCallback(
    (distanceM: number): number | null => {
      const mpg = s.gas_efficiency_mpg ?? 0;
      const gasPrice = s.gas_price_per_unit ?? 0;
      if (mpg <= 0 || gasPrice <= 0 || distanceM <= 0) return null;
      const distanceMi = convertDistanceFromSI(distanceM, 'mi');
      const gallonsUsed = distanceMi / mpg;
      if ((s.gas_unit ?? 'gallon') === 'liter') {
        return gallonsUsed * GALLONS_TO_LITERS * gasPrice;
      }
      return gallonsUsed * gasPrice;
    },
    [s.gas_efficiency_mpg, s.gas_price_per_unit, s.gas_unit],
  );

  return useMemo(
    () => ({
      costPerKwh,
      currencySymbol,
      formatEnergyCost,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    }),
    [
      costPerKwh,
      currencySymbol,
      formatEnergyCost,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    ],
  );
}
