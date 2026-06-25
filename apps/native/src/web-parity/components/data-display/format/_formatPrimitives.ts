// Shared native parity primitives for web/src/components/data-display/format/*.
//
// The web format components import three browser-oriented modules that have no
// native counterpart in this tree: @/lib/numberFormat (fmtNumber + its global
// locale/precision), @/lib/unitConversion (the SI converters) and
// @/hooks/useUnits / @/hooks/useFormatting (the settings→unit-pref bridges).
// Their pure logic is ported verbatim here and kept self-contained so the
// rendered strings — unit selection, the SI→display conversion and the
// locale-aware fmtNumber output — match the web renderers. Native has no
// useUnits hook, so the distance/speed/temperature preference, decimal
// precision, locale and currency symbol are derived directly from the existing
// native useSettings query, mirroring web useUnits/useFormatting/numberFormat.

import {useSettings} from '../../../api/hooks/useSettings';

/** Distance display unit (target of convertDistanceFromSI). Ported from web. */
export type DistanceUnit = 'km' | 'mi';
/** Speed display unit (target of convertSpeedFromSI). Ported from web. */
export type SpeedUnit = 'km/h' | 'mph';
/** Temperature display unit (target of convertTempFromSI). Ported from web. */
export type TempUnit = '°C' | '°F';
/** Pressure display unit. Ported from web useUnits derivePressure. */
export type PressureUnit = 'bar' | 'psi';
/** Preferred-range selector, mirrors web `preferred_range` setting. */
export type RangeType = 'rated' | 'ideal';

/** 1 km = 1000 m. */
const METERS_PER_KM = 1000;
/** 1 mile = 1609.344 m (international mile). */
const METERS_PER_MILE = 1609.344;
/** Seconds per hour, for m/s → distance/hour conversions. */
const SECONDS_PER_HOUR = 3600;

/** Fallback decimal precision when settings.decimal_precision is unavailable. */
const DEFAULT_PRECISION = 2;
/** Fallback BCP-47 locale when settings.locale is unavailable. */
const DEFAULT_LOCALE = 'en-US';
/** Fallback currency symbol when settings.currency_symbol is unavailable. */
const DEFAULT_CURRENCY = '$';

/** Universal placeholder returned for unrenderable input. Ported from web. */
export const FALLBACK = '—';

/** Safe number extraction; returns 0 for nullish/NaN. Ported from numberFormat. */
export function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Finite-number guard. Ported from numberFormat.isFiniteNumber. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Locale-aware fixed-precision number formatter ported from web
 * `@/lib/numberFormat` fmtNumber. Falls back to 'en-US' if the locale tag is
 * rejected so a string is always produced.
 */
export function fmtNumberRaw(
  v: unknown,
  decimals: number,
  locale: string,
): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

/** Convert distance from SI meters to display unit. Ported from unitConversion. */
export function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/** Convert speed from SI m/s to display unit. Ported from unitConversion. */
export function convertSpeedFromSI(mps: number, to: SpeedUnit): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

/** Convert temperature from SI Celsius to display unit. Ported from unitConversion. */
export function convertTempFromSI(celsius: number, to: TempUnit): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

/** Mirror web useUnits.deriveDistance: only 'mi' opts out of the 'km' default. */
function deriveDistance(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

/** Mirror web useUnits.deriveSpeed: 'mi' → mph, otherwise km/h. */
function deriveSpeed(unitOfLength: string | undefined): SpeedUnit {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

/** Mirror web useUnits.deriveTemperature: 'F' → °F, otherwise °C. */
function deriveTemperature(unitOfTemp: string | undefined): TempUnit {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

/** Mirror web useUnits.derivePressure: only 'psi' opts out of the 'bar' default. */
function derivePressure(unitOfPressure: string | undefined): PressureUnit {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

/** Mirror web preferredRange: only 'ideal' opts out of the 'rated' default. */
function deriveRangeType(preferredRange: string | undefined): RangeType {
  return preferredRange === 'ideal' ? 'ideal' : 'rated';
}

/**
 * Resolve the effective decimal precision the way web numberFormat's
 * setGlobalPrecision does: clamp to 0–20, falling back to 2 for invalid input.
 */
export function resolvePrecision(decimals: number | undefined): number {
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) {
    return DEFAULT_PRECISION;
  }
  return Math.max(0, Math.min(20, decimals));
}

/** Resolve the effective locale: blank / whitespace-only falls back to 'en-US'. */
export function resolveLocale(locale: string | undefined): string {
  return locale && locale.trim() ? locale : DEFAULT_LOCALE;
}

/** Resolved formatting preferences + a bound locale-aware number formatter. */
export interface FormatPrefs {
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  tempUnit: TempUnit;
  pressureUnit: PressureUnit;
  rangeType: RangeType;
  locale: string;
  /** Global decimal precision (settings-derived, clamped 0–20). */
  precision: number;
  currencySymbol: string;
  /** Locale-aware formatter; uses `precision` when `decimals` is omitted. */
  fmt: (value: unknown, decimals?: number) => string;
}

/**
 * Native bridge between the user's settings preference and the SI-floor
 * formatters. Mirrors web useUnits/useFormatting/numberFormat by reading the
 * native useSettings query once and deriving a stable preference bag.
 */
export function useFormatPrefs(): FormatPrefs {
  const {data: settings} = useSettings();
  const locale = resolveLocale(settings?.locale);
  const precision = resolvePrecision(settings?.decimal_precision);
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : DEFAULT_CURRENCY;

  return {
    distanceUnit: deriveDistance(settings?.unit_of_length),
    speedUnit: deriveSpeed(settings?.unit_of_length),
    tempUnit: deriveTemperature(settings?.unit_of_temp),
    pressureUnit: derivePressure(settings?.unit_of_pressure),
    rangeType: deriveRangeType(settings?.preferred_range),
    locale,
    precision,
    currencySymbol,
    fmt: (value, decimals) =>
      fmtNumberRaw(value, decimals ?? precision, locale),
  };
}
