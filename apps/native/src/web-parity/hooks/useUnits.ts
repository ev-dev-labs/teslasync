// Native parity port of web/src/hooks/useUnits.ts.
//
// The web module is a pure, UI-agnostic React hook: `useCallback` / `useMemo`
// wiring that bridges the user's settings preference to the SI-floor unit
// formatters. It contains no JSX, no DOM element, no Recharts/Leaflet, and no
// browser-only API, so the logic ports 1:1 to React Native — Hermes runs the
// same `useMemo` / `useCallback` primitives, and `Intl.NumberFormat` (used by
// the inlined formatters) is already relied on across the native app
// (UptimeHeatmap, ChartSummary, formatOperationsValue, …).
//
// Two web imports are adapted following the established parity conventions:
//
//   * `./useSettings` — the web app-level settings hook returns a `settings`
//     object that is ALWAYS fully populated (it merges a `defaults` bag while
//     the query loads). That hook is not ported. Following the
//     usePreferredRange / useFaviconBadge precedent, the preference is read
//     from the native `../api/hooks/useSettings` query hook, whose
//     `AppSettings` exposes the same snake_case fields
//     (`unit_of_length` / `unit_of_temp` / `unit_of_pressure` / `locale` /
//     `decimal_precision`). That query hook returns `data === undefined` while
//     loading, so each `derive*` helper receives `undefined` and collapses to
//     the SAME default the web `defaults` bag injects — `km` / `km/h` / `°C` /
//     `bar` / `en-US`. The one field whose web default is a non-collapsing
//     value is `decimal_precision` (web default `2`), so the loading-time read
//     is `settings?.decimal_precision ?? 2`, reproducing the web hook's
//     observable precision both while loading and after the query resolves.
//     This `?? 2` also matches the native FormatterPrefsBridge convention.
//   * `../lib/unitConversion` — the SI-floor converters/formatters + `UnitPref`
//     types are not yet ported to native. Following the inline precedent
//     (ChargingHeatmapPage inlines `convertEnergyFromSI`; usePreferredRange /
//     useConfirm / useActiveFilterChips inline not-yet-available module
//     surface), the exact SI-floor surface `useUnits` consumes — the seven
//     `formatX` formatters (here named `libFormatX` to avoid shadowing the
//     hook's `formatX` callbacks, mirroring the web `as libFormatX` aliases),
//     their `convertXFromSI` converters, the locale/precision/empty helpers,
//     and the `UnitPref` + per-quantity pref types — is inlined module-locally
//     byte-for-byte. The hook body itself still performs NO unit math: every
//     `formatX` callback delegates to the inlined `libFormatX`, preserving the
//     web "let the lib do it; never hand-type a mile-to-km factor here"
//     contract that consolidated the legacy drift.
//
// `UnitPref` and the per-quantity pref types are re-exported (the web hook's
// `UseUnitsResult.unitPrefs` is typed `UnitPref`, and native has no other
// module to import these from until `lib/unitConversion` is ported) — a
// documented superset of the web `useUnits.ts` export surface. The lib's
// internal `FormatOptions` (`{ precision?: number }`) is identical to the
// hook's exported `FormatOptions`, so the two are merged into the single
// exported `FormatOptions` here. No DOM / Recharts / Leaflet / web-UI imports
// are introduced; the only runtime dependencies are react and the native
// useSettings query hook.

import {useCallback, useMemo} from 'react';

import {useSettings} from '../api/hooks/useSettings';

/** Per-call formatter override surface. Mirrors lib `FormatOptions`. */
export interface FormatOptions {
  /** Override the default `maximumFractionDigits` for this call only. */
  precision?: number;
}

/* ─── Inlined SI-floor unit conversion surface (web `@/lib/unitConversion`) ────
 * Every converter / formatter below accepts canonical SI input ONLY (meters,
 * m/s, °C, kPa, Wh, seconds, watts). There is NO runtime "guess the input unit"
 * fallback — producers (api/hooks/*) deliver SI; renderers convert at the
 * boundary. Inlined here byte-for-byte because the native lib is not yet
 * ported (ChargingHeatmapPage / usePreferredRange inline precedent). */

/** Distance display unit (target of formatDistance). */
export type DistanceUnitPref = 'km' | 'mi' | 'ft';
/** Speed display unit (target of formatSpeed). */
export type SpeedUnitPref = 'km/h' | 'mph';
/** Temperature display unit (target of formatTemperature). */
export type TemperatureUnitPref = '°C' | '°F';
/** Pressure display unit (target of formatPressure). */
export type PressureUnitPref = 'kPa' | 'psi' | 'bar';
/** Energy display unit (target of formatEnergy). */
export type EnergyUnitPref = 'Wh' | 'kWh';
/** Duration display unit (target of formatDuration). */
export type DurationUnitPref = 's' | 'min' | 'h' | 'd';
/** Power display unit (target of formatPower). */
export type PowerUnitPref = 'W' | 'kW';

/**
 * UnitPref aggregates the user's per-quantity display preference plus
 * locale + precision hints for `Intl.NumberFormat`. Pages compute one
 * UnitPref per render (typically from `useUnits`) and pass it to each
 * `formatX` call. There is intentionally no module-level cache — the
 * caller owns the preference lifecycle.
 */
export interface UnitPref {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  pressure: PressureUnitPref;
  energy: EnergyUnitPref;
  duration: DurationUnitPref;
  power: PowerUnitPref;
  /** BCP-47 locale tag passed to `Intl.NumberFormat`. Undefined = host. */
  locale?: string;
  /** Default `maximumFractionDigits` when formatX has no per-call override. */
  precision?: number;
  /** Display fallback when a formatX receives null/undefined/NaN. Default '—'. */
  emptyDisplay?: string;
}

/**
 * Canonical SI input units this module accepts. Frozen so the per-quantity
 * default-precision map can key off `typeof SI`.
 */
const SI = Object.freeze({
  distance: 'm',
  speed: 'm/s',
  temperature: '°C',
  pressure: 'kPa',
  energy: 'Wh',
  duration: 's',
  power: 'W',
} as const);

/** 1 mile = 1609.344 m exactly (international yard, NIST). */
const METERS_PER_MILE = 1609.344;
/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000;
/** 1 ft = 0.3048 m exactly (international foot, NIST). */
const METERS_PER_FOOT = 0.3048;
/** 1 psi = 6.894757 kPa (NIST SP 811, rounded to display precision). */
const KPA_PER_PSI = 6.894757;
/** 1 bar = 100 kPa (BIPM definition). */
const KPA_PER_BAR = 100;
/** Seconds in a minute / hour / day. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** Convert distance from SI meters to the user's display unit. */
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

/** Convert speed from SI meters-per-second to the user's display unit. */
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

/** Convert temperature from SI Celsius to the user's display unit. */
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

/** Convert pressure from SI kilopascals to the user's display unit. */
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

/** Convert energy from SI watt-hours to the user's display unit. */
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

/** Convert duration from SI seconds to the user's display unit. */
function convertDurationFromSI(seconds: number, to: DurationUnitPref): number {
  switch (to) {
    case 's':
      return seconds;
    case 'min':
      return seconds / SECONDS_PER_MINUTE;
    case 'h':
      return seconds / SECONDS_PER_HOUR;
    case 'd':
      return seconds / SECONDS_PER_DAY;
  }
}

/** Convert power from SI watts to the user's display unit. */
function convertPowerFromSI(watts: number, to: PowerUnitPref): number {
  switch (to) {
    case 'W':
      return watts;
    case 'kW':
      return watts / 1000;
  }
}

/** Default fallback string for nullish / NaN inputs. */
const DEFAULT_EMPTY_DISPLAY = '\u2014';

/** Default precision per quantity when `pref.precision` is unset. */
const DEFAULT_PRECISION: Record<keyof typeof SI, number> = {
  distance: 1,
  speed: 0,
  temperature: 1,
  pressure: 1,
  energy: 2,
  duration: 0,
  power: 2,
};

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  // Intl.NumberFormat handles negatives, very large, very small, locale
  // separators, and grouping. We pin maximum + minimum to the same digit
  // count to keep tabular layouts aligned.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function resolveEmpty(pref: Pick<UnitPref, 'emptyDisplay'> | undefined): string {
  return pref?.emptyDisplay ?? DEFAULT_EMPTY_DISPLAY;
}

function resolvePrecision(
  pref: Pick<UnitPref, 'precision'> | undefined,
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
    pref &&
    typeof pref.precision === 'number' &&
    Number.isFinite(pref.precision) &&
    pref.precision >= 0
  ) {
    return Math.floor(pref.precision);
  }
  return fallback;
}

/** Format an SI-meters distance for display in the user's unit. */
function libFormatDistance(
  meters: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(meters)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.distance,
  );
  const value = convertDistanceFromSI(meters, pref.distance);
  return `${formatNumber(value, pref.locale, digits)} ${pref.distance}`;
}

/** Format an SI m/s speed for display in the user's unit. */
function libFormatSpeed(
  mps: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(mps)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.speed,
  );
  const value = convertSpeedFromSI(mps, pref.speed);
  return `${formatNumber(value, pref.locale, digits)} ${pref.speed}`;
}

/** Format an SI Celsius temperature for display in the user's unit. */
function libFormatTemperature(
  celsius: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(celsius)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.temperature,
  );
  const value = convertTempFromSI(celsius, pref.temperature);
  // No space between number and °unit (typographic convention).
  return `${formatNumber(value, pref.locale, digits)}${pref.temperature}`;
}

/** Format an SI kilopascal pressure for display in the user's unit. */
function libFormatPressure(
  kpa: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(kpa)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.pressure,
  );
  const value = convertPressureFromSI(kpa, pref.pressure);
  return `${formatNumber(value, pref.locale, digits)} ${pref.pressure}`;
}

/** Format an SI watt-hours energy for display in the user's unit. */
function libFormatEnergy(
  wh: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(wh)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.energy,
  );
  const value = convertEnergyFromSI(wh, pref.energy);
  return `${formatNumber(value, pref.locale, digits)} ${pref.energy}`;
}

/** Format an SI seconds duration for display in the user's unit. */
function libFormatDuration(
  seconds: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(seconds)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.duration,
  );
  const value = convertDurationFromSI(seconds, pref.duration);
  return `${formatNumber(value, pref.locale, digits)} ${pref.duration}`;
}

/** Format SI watts for display in the user's unit. */
function libFormatPower(
  watts: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(watts)) return resolveEmpty(pref);
  const digits = resolvePrecision(
    pref,
    options?.precision,
    DEFAULT_PRECISION.power,
  );
  const value = convertPowerFromSI(watts, pref.power);
  return `${formatNumber(value, pref.locale, digits)} ${pref.power}`;
}

/* ─── useUnits public surface (web `src/hooks/useUnits.ts`) ─────────────────── */

/**
 * `useUnits` is the per-render bridge between the user's settings preference
 * and SI-floor formatters.
 *
 * Contract:
 * - Reads `useSettings()` once per render and derives a stable `UnitPref`.
 * - Exposes `formatDistance / formatSpeed / formatTemperature /
 * formatPressure / formatEnergy / formatDuration / formatPower`. Every
 * formatter delegates to the corresponding `libFormatX(value, pref, options)`
 * inlined above — this hook performs NO unit math itself. Inline math here was
 * the source of legacy drift that consolidated; rule of thumb: never reach for
 * a hand-typed mile-to-km factor or a Fahrenheit offset in this file — let the
 * (inlined) lib do it.
 * - Returns a stable `unitPrefs` so non-hook utilities (chart-axis label
 * resolvers, custom report builders) can pass it to the same
 * `libFormatX(value, pref)` functions outside of the React tree.
 *
 * Reference stability:
 * - `unitPrefs`, every `formatX`, and the outer return object are memoized over
 * the primitive preference dependencies (distance, speed, temperature,
 * pressure, energy, duration prefs + locale + precision). Re-renders that don't
 * change those primitives return identical references, so memoized child
 * components / `useMemo` hooks downstream don't recompute.
 */

/** Function signature shared by every formatter returned by `useUnits`. */
export type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

/** Shape of the value returned by `useUnits`. */
export interface UseUnitsResult {
  /** Stable `UnitPref` bag suitable for direct use with the inlined formatters. */
  unitPrefs: UnitPref;
  formatDistance: UnitFormatter;
  formatSpeed: UnitFormatter;
  formatTemperature: UnitFormatter;
  formatPressure: UnitFormatter;
  formatEnergy: UnitFormatter;
  formatDuration: UnitFormatter;
  formatPower: UnitFormatter;
}

/**
 * Default energy display unit. The backend's energy fields surface in
 * watt-hours (SI), but vehicle-energy widgets read more naturally in kWh.
 * A future settings field can promote this to a user preference; for now
 * the hook centralises the default so adoption sites don't need to know.
 */
const DEFAULT_ENERGY_PREF: EnergyUnitPref = 'kWh';

/**
 * Default duration display unit. Drives, charging sessions, and idle
 * windows are all conveniently expressed in hours; sub-minute durations
 * should pass `{ precision }` if they need finer granularity.
 */
const DEFAULT_DURATION_PREF: DurationUnitPref = 'h';
const DEFAULT_POWER_PREF: PowerUnitPref = 'kW';

/** Default locale fallback when `settings.locale` is absent or empty. */
const DEFAULT_LOCALE = 'en-US';

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

function deriveTemperature(
  unitOfTemp: string | undefined,
): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) return locale;
  return DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') return undefined;
  if (!Number.isFinite(decimalPrecision)) return undefined;
  if (decimalPrecision < 0) return undefined;
  return Math.floor(decimalPrecision);
}

export function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();

  const distance = deriveDistance(settings?.unit_of_length);
  const speed = deriveSpeed(settings?.unit_of_length);
  const temperature = deriveTemperature(settings?.unit_of_temp);
  const pressure = derivePressure(settings?.unit_of_pressure);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision ?? 2);

  const unitPrefs = useMemo<UnitPref>(
    () => ({
      distance,
      speed,
      temperature,
      pressure,
      energy: DEFAULT_ENERGY_PREF,
      duration: DEFAULT_DURATION_PREF,
      power: DEFAULT_POWER_PREF,
      locale,
      precision,
    }),
    [distance, speed, temperature, pressure, locale, precision],
  );

  const formatDistance = useCallback<UnitFormatter>(
    (value, options) => libFormatDistance(value, unitPrefs, options),
    [unitPrefs],
  );
  const formatSpeed = useCallback<UnitFormatter>(
    (value, options) => libFormatSpeed(value, unitPrefs, options),
    [unitPrefs],
  );
  const formatTemperature = useCallback<UnitFormatter>(
    (value, options) => libFormatTemperature(value, unitPrefs, options),
    [unitPrefs],
  );
  const formatPressure = useCallback<UnitFormatter>(
    (value, options) => libFormatPressure(value, unitPrefs, options),
    [unitPrefs],
  );
  const formatEnergy = useCallback<UnitFormatter>(
    (value, options) => libFormatEnergy(value, unitPrefs, options),
    [unitPrefs],
  );
  const formatDuration = useCallback<UnitFormatter>(
    (value, options) => libFormatDuration(value, unitPrefs, options),
    [unitPrefs],
  );
  const formatPower = useCallback<UnitFormatter>(
    (value, options) => libFormatPower(value, unitPrefs, options),
    [unitPrefs],
  );

  return useMemo(
    () => ({
      unitPrefs,
      formatDistance,
      formatSpeed,
      formatTemperature,
      formatPressure,
      formatEnergy,
      formatDuration,
      formatPower,
    }),
    [
      unitPrefs,
      formatDistance,
      formatSpeed,
      formatTemperature,
      formatPressure,
      formatEnergy,
      formatDuration,
      formatPower,
    ],
  );
}
