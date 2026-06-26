// Native parity port of web/src/hooks/usePressureFormat.ts.
//
// The web hook (web L37-56) is a pure, render-time bridge that surfaces BOTH a
// numeric SI->display pressure converter (`toPressureValue`) AND a formatted
// display string (`formatPressureValue`) from a single source of truth. It
// touches no DOM, Recharts, Leaflet, or web UI APIs, so the logic ports cleanly
// to React Native — only its two source imports need native substitutes:
//
//   - `./useUnits` (web L2: `useUnits`, type `UnitFormatter`): the parity tree
//     has no shared native `useUnits`. Following the established precedent
//     (ChargeStatusWidget/GeofenceWidget inline a `useUnits` shim reading the
//     native `useSettings`), this port reads the SAME native settings query and
//     reproduces the exact `derivePressure`/`deriveLocale`/`derivePrecision`
//     logic from web `useUnits` (web useUnits L88-116) plus the
//     `formatPressure` UnitFormatter it binds (web useUnits L155-158). The
//     `UnitFormatter` / `FormatOptions` types are re-declared here verbatim
//     from web useUnits L47-56.
//   - `@/lib/unitConversion` (web L3: `convertPressureFromSI`, type
//     `PressureUnitPref`): `convertPressureFromSI` is a non-deprecated SI->unit
//     converter; it and the `formatPressure` formatter are ported verbatim
//     alongside their constants from web/src/lib/unitConversion.ts.
//
// No browser-only behavior is involved, so there is no "unavailable" state to
// expose — the hook is fully faithful on native.

import {useCallback, useMemo} from 'react';

import {useSettings} from '../api/hooks/useSettings';

// ---- Ported @/lib/unitConversion (pressure slice, non-deprecated) -----------

/** Pressure display unit (web `PressureUnitPref`, unitConversion L67). */
export type PressureUnitPref = 'kPa' | 'psi' | 'bar';

/** 1 psi = 6.894757 kPa (NIST SP 811, rounded to display precision). */
const KPA_PER_PSI = 6.894757;
/** 1 bar = 100 kPa (BIPM definition). */
const KPA_PER_BAR = 100;

/**
 * Convert pressure from SI kilopascals to the user's display unit. Ported
 * verbatim from web `convertPressureFromSI` (unitConversion L178-190).
 */
function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

/** Default pressure precision (web DEFAULT_PRECISION.pressure, unitConversion L256). */
const DEFAULT_PRESSURE_PRECISION = 1;
/** Default fallback string for nullish / NaN inputs (web DEFAULT_EMPTY_DISPLAY). */
const DEFAULT_EMPTY_DISPLAY = '—';

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Locale-aware number formatter. Ported from web `formatNumber`
 * (unitConversion L271-283): max + min fraction digits are pinned together so
 * tabular layouts stay aligned.
 */
function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Resolve effective precision. Ported from web `resolvePrecision`
 * (unitConversion L289-306): a per-call override wins, then the pref-level
 * precision, then the quantity fallback.
 */
function resolvePrecision(
  precision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof precision === 'number' &&
    Number.isFinite(precision) &&
    precision >= 0
  ) {
    return Math.floor(precision);
  }
  return fallback;
}

/**
 * Format an SI kilopascal pressure for display in the user's unit. Ported from
 * web `formatPressure` (unitConversion L362-371) with the `pref` bag flattened
 * to the pressure/locale/precision slice this hook owns.
 */
function formatPressure(
  kpa: number | null | undefined,
  pressure: PressureUnitPref,
  locale: string | undefined,
  precision: number | undefined,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(kpa)) return DEFAULT_EMPTY_DISPLAY;
  const digits = resolvePrecision(
    precision,
    options?.precision,
    DEFAULT_PRESSURE_PRECISION,
  );
  const value = convertPressureFromSI(kpa, pressure);
  return `${formatNumber(value, locale, digits)} ${pressure}`;
}

// ---- Ported @/hooks/useUnits derivations + formatter contract ---------------

/** Per-call formatter override surface (web useUnits `FormatOptions`, L47-50). */
export interface FormatOptions {
  /** Override the default `maximumFractionDigits` for this call only. */
  precision?: number;
}

/** Function signature shared by every `useUnits` formatter (web L52-56). */
export type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

/** Default locale fallback (web useUnits `DEFAULT_LOCALE`, L88). */
const DEFAULT_LOCALE = 'en-US';

/** Mirror of web useUnits `derivePressure` (L102-104). */
function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

/** Mirror of web useUnits `deriveLocale` (L106-109). */
function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) return locale;
  return DEFAULT_LOCALE;
}

/** Mirror of web useUnits `derivePrecision` (L111-116). */
function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') return undefined;
  if (!Number.isFinite(decimalPrecision)) return undefined;
  if (decimalPrecision < 0) return undefined;
  return Math.floor(decimalPrecision);
}

// ---- usePressureFormat (web L5-56) ------------------------------------------

export interface UsePressureFormatResult {
  /** Pressure unit pref ('bar' | 'psi'). */
  pressureUnit: PressureUnitPref;
  /**
   * Convert a Pascals-source value to the user's preferred pressure unit
   * as a NUMBER. Use this in chart-axis tickFormatters / reference-line
   * positions / data-mappers where a numeric value is needed rather than a
   * formatted string.
   */
  toPressureValue: (pa: number | null | undefined) => number | null;
  /**
   * Format a Pascals-source value as a localized string with the
   * user-preferred unit suffix already appended (e.g. `"2.4 bar"`).
   * Equivalent to `useUnits().formatPressure`, surfaced here for symmetry with
   * `toPressureValue` so widgets that need both can take a single hook
   * dependency.
   */
  formatPressureValue: UnitFormatter;
}

/**
 * Reusable bridge for surfaces that need BOTH a numeric converted pressure
 * value (e.g. for plotting on a chart axis) AND a formatted display string
 * (e.g. for the legend / tooltip / summary tile). Built on top of the native
 * `useSettings` query — the same source web `useUnits()` reads — so a single
 * source of truth governs both projections and avoids the `decimal_precision`
 * drift that historically came from duplicating the conversion in two places.
 */
export function usePressureFormat(): UsePressureFormatResult {
  const {data} = useSettings();

  // Web reads `const { unitPrefs, formatPressure } = useUnits()` (web L38);
  // here we derive the pressure-relevant slice of `unitPrefs` from the same
  // settings the web `useUnits` consumes.
  const pressureUnit = derivePressure(data?.unit_of_pressure);
  const locale = deriveLocale(data?.locale);
  const precision = derivePrecision(data?.decimal_precision);

  const toPressureValue = useCallback(
    (pa: number | null | undefined): number | null => {
      if (pa == null || !Number.isFinite(pa)) return null;
      return convertPressureFromSI(pa, pressureUnit);
    },
    [pressureUnit],
  );

  const formatPressureValue = useCallback<UnitFormatter>(
    (value, options) => formatPressure(value, pressureUnit, locale, precision, options),
    [pressureUnit, locale, precision],
  );

  return useMemo(
    () => ({
      pressureUnit,
      toPressureValue,
      formatPressureValue,
    }),
    [pressureUnit, toPressureValue, formatPressureValue],
  );
}
