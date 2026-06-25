// Native parity port of web/src/components/data-display/format/index.ts.
//
// The web barrel re-exports a family of unit/value renderer components
// (Distance, Speed, Temperature, Pressure, Energy, Power, Voltage, Current,
// Currency, Percentage, FormattedNumber, Duration, DateTime, Range) plus the
// `useRangeLabel` hook. Each web sibling renders a DOM <span> and reaches into
// the web hook stack (useUnits / useFormatting / usePreferredRange / useSettings
// / react-i18next) and the @/lib SI conversion + date helpers.
//
// None of those web hooks/libs are wired into the native parity tree, so this
// barrel ports the underlying SI math, number/date formatting, and
// preferred-range selection inline and renders with React Native text
// primitives via React.createElement (the file keeps the source `.ts`
// extension, matching the native charts barrel, so JSX is intentionally not
// used). The public export names are preserved and native-safe substitutions
// are documented in `nativeFormatBarrelCapabilities` and the .parity.json
// sidecar:
//   - The web hover `title` has no native hover equivalent and is surfaced via
//     `accessibilityLabel`.
//   - `useUnits()`/`useSettings()` unit preferences are unavailable; unit-aware
//     renderers default to the web no-settings fallback (metric: km, km/h, °C,
//     bar) and accept an explicit `unit` override prop.
//   - react-i18next is absent; `useRangeLabel` returns the English default
//     label that web passed as the `t()` fallback.
//   - The vehicle/user timezone provider is absent; `DateTime` renders in the
//     device timezone (or UTC when `in="utc"`).

import React from 'react';
import {StyleSheet, Text, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

// ---------------------------------------------------------------------------
// Capabilities — native-safe substitutions for absent web behavior.
// ---------------------------------------------------------------------------

export const nativeFormatBarrelCapabilities = {
  hoverTitle: {
    available: false,
    reason:
      'React Native has no hover tooltip; the web `title` value is exposed via accessibilityLabel.',
  },
  unitPreferences: {
    available: false,
    reason:
      'The web useUnits/useSettings provider is absent; unit-aware renderers default to metric (km, km/h, °C, bar) and accept an explicit unit override prop.',
  },
  i18n: {
    available: false,
    reason:
      'react-i18next is not wired into the native parity tree; useRangeLabel returns the English default label.',
  },
  timezoneProvider: {
    available: false,
    reason:
      'The web vehicle/user timezone provider is absent; DateTime renders in the device timezone (or UTC when in="utc").',
  },
} as const;

// ---------------------------------------------------------------------------
// Ported number formatting (web/src/lib/numberFormat.ts: fmtNumber).
// ---------------------------------------------------------------------------

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
const EM_DASH = '—';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function fmtNumber(
  value: unknown,
  decimals?: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const digits = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

// ---------------------------------------------------------------------------
// Ported SI conversions (web/src/lib/unitConversion.ts). Every renderer feeds
// canonical SI into these — no input-unit guessing.
// ---------------------------------------------------------------------------

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
const SECONDS_PER_HOUR = 3600;

export type DistanceUnit = 'km' | 'mi';
export type SpeedUnit = 'km/h' | 'mph';
export type TemperatureUnit = '°C' | '°F';
export type PressureUnit = 'kPa' | 'psi' | 'bar';

function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number, to: SpeedUnit): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

function convertTempFromSI(celsius: number, to: TemperatureUnit): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

function convertPressureFromSI(kpa: number, to: PressureUnit): number {
  switch (to) {
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
    case 'kPa':
    default:
      return kpa;
  }
}

// ---------------------------------------------------------------------------
// Ported date/duration formatting (web/src/lib/dateFormat.ts).
// ---------------------------------------------------------------------------

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function intlDateOptions(
  base: Intl.DateTimeFormatOptions,
  tz?: string,
): Intl.DateTimeFormatOptions {
  return tz ? {...base, timeZone: tz} : base;
}

function formatDateTime(
  value: string | Date | null | undefined,
  tz?: string,
): string {
  const date = toDate(value);
  if (!date) {
    return EM_DASH;
  }
  return date.toLocaleString(
    undefined,
    intlDateOptions(
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      tz,
    ),
  );
}

function formatDate(
  value: string | Date | null | undefined,
  tz?: string,
): string {
  const date = toDate(value);
  if (!date) {
    return EM_DASH;
  }
  return date.toLocaleDateString(
    undefined,
    intlDateOptions({year: 'numeric', month: 'short', day: 'numeric'}, tz),
  );
}

function formatDateShort(
  value: string | Date | null | undefined,
  tz?: string,
): string {
  const date = toDate(value);
  if (!date) {
    return EM_DASH;
  }
  return date.toLocaleDateString(
    undefined,
    intlDateOptions({month: 'short', day: 'numeric'}, tz),
  );
}

function formatTime(
  value: string | Date | null | undefined,
  tz?: string,
): string {
  const date = toDate(value);
  if (!date) {
    return EM_DASH;
  }
  return date.toLocaleTimeString(
    undefined,
    intlDateOptions({hour: '2-digit', minute: '2-digit'}, tz),
  );
}

function formatRelativeTime(
  value: string | Date | null | undefined,
  tz?: string,
): string {
  const date = toDate(value);
  if (!date) {
    return EM_DASH;
  }
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  return date.toLocaleDateString(
    undefined,
    intlDateOptions(
      {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'},
      tz,
    ),
  );
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString(DEFAULT_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) {
    return EM_DASH;
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDurationMsCompact(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) {
    return EM_DASH;
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) {
    return EM_DASH;
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  return `${min}m ${formatRoundedInt(sec % 60)}s`;
}

function formatDurationClock(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) {
    return EM_DASH;
  }
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function tzAbbreviation(value: string | Date, tz: string): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find(part => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ---------------------------------------------------------------------------
// Ported preferred-range selection (web/src/lib/preferredRange.ts).
// ---------------------------------------------------------------------------

export type RangeType = 'rated' | 'ideal';

export interface PreferredRangeFields {
  rated_range?: number | null;
  ideal_range?: number | null;
}

interface PreferredRangeResult {
  meters: number | null;
  source: RangeType;
  labelKey: 'idealRange' | 'ratedRange';
  defaultLabel: 'Ideal Range' | 'Rated Range';
}

function selectPreferredRange(
  state: PreferredRangeFields | null | undefined,
  rangeType: string | null | undefined,
): PreferredRangeResult {
  const type: RangeType = rangeType === 'ideal' ? 'ideal' : 'rated';
  const meters =
    type === 'ideal' ? state?.ideal_range ?? null : state?.rated_range ?? null;
  return type === 'ideal'
    ? {
        meters,
        source: 'ideal',
        labelKey: 'idealRange',
        defaultLabel: 'Ideal Range',
      }
    : {
        meters,
        source: 'rated',
        labelKey: 'ratedRange',
        defaultLabel: 'Rated Range',
      };
}

// ---------------------------------------------------------------------------
// Shared native text renderer. Maps the web `title` hover to accessibilityLabel.
// ---------------------------------------------------------------------------

interface BaseFormatProps {
  /** Web Tailwind class retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
  /** Overrides the native accessibility label (web exposed the raw value via `title`). */
  accessibilityLabel?: string;
}

interface RenderOptions {
  title?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  dataTestID?: string;
  accessibilityLabel?: string;
}

function renderValue(
  children: React.ReactNode,
  opts: RenderOptions,
): React.ReactElement {
  return React.createElement(
    AppText,
    {
      accessibilityLabel: opts.accessibilityLabel ?? opts.title,
      style: opts.style,
      testID: opts.testID ?? opts.dataTestID,
    },
    children,
  );
}

// ---------------------------------------------------------------------------
// Distance.
// ---------------------------------------------------------------------------

export interface DistanceProps extends BaseFormatProps {
  /** Canonical input in miles (matches the web codebase internal unit). */
  miles?: number | null;
  /** Alternative input in kilometres; converted to miles before display. */
  km?: number | null;
  /** Optional decimal precision; defaults to 2 (the web global default). */
  precision?: number;
  /** Display unit; defaults to the web no-settings metric fallback. */
  unit?: DistanceUnit;
}

export function Distance({
  miles,
  km,
  precision,
  className: _className,
  unit = 'km',
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: DistanceProps): React.ReactElement {
  let sourceMeters: number | null = null;
  let title: string | undefined;
  if (isFiniteNumber(miles)) {
    sourceMeters = miles * METERS_PER_MILE;
    title = `${miles.toFixed(2)} mi`;
  } else if (isFiniteNumber(km)) {
    sourceMeters = km * METERS_PER_KM;
    title = `${km.toFixed(2)} km`;
  }

  if (sourceMeters === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const display = `${fmtNumber(
    convertDistanceFromSI(sourceMeters, unit),
    precision,
  )} ${unit}`;
  return renderValue(display, {
    title,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Distance.displayName = 'Distance';

// ---------------------------------------------------------------------------
// Speed.
// ---------------------------------------------------------------------------

export interface SpeedProps extends BaseFormatProps {
  /** Canonical input in mph. */
  mph?: number | null;
  /** Alternative input in km/h; converted to mph before display. */
  kmh?: number | null;
  precision?: number;
  /** Display unit; defaults to the web no-settings metric fallback. */
  unit?: SpeedUnit;
}

export function Speed({
  mph,
  kmh,
  precision,
  className: _className,
  unit = 'km/h',
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: SpeedProps): React.ReactElement {
  let sourceMps: number | null = null;
  let title: string | undefined;
  if (isFiniteNumber(mph)) {
    sourceMps = mph * 0.44704;
    title = `${mph.toFixed(1)} mph`;
  } else if (isFiniteNumber(kmh)) {
    sourceMps = (kmh * 1000) / 3600;
    title = `${kmh.toFixed(1)} km/h`;
  }

  if (sourceMps === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const display = `${fmtNumber(
    convertSpeedFromSI(sourceMps, unit),
    precision,
  )} ${unit}`;
  return renderValue(display, {
    title,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Speed.displayName = 'Speed';

// ---------------------------------------------------------------------------
// Temperature.
// ---------------------------------------------------------------------------

export interface TemperatureProps extends BaseFormatProps {
  /** Canonical input in °C. */
  c?: number | null;
  /** Alternative input in °F; converted to °C before display. */
  f?: number | null;
  precision?: number;
  /** Display unit; defaults to the web no-settings metric fallback. */
  unit?: TemperatureUnit;
}

export function Temperature({
  c,
  f,
  precision,
  className: _className,
  unit = '°C',
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: TemperatureProps): React.ReactElement {
  let sourceC: number | null = null;
  let title: string | undefined;
  if (isFiniteNumber(c)) {
    sourceC = c;
    title = `${c.toFixed(1)} °C`;
  } else if (isFiniteNumber(f)) {
    sourceC = ((f - 32) * 5) / 9;
    title = `${f.toFixed(1)} °F`;
  }

  if (sourceC === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const display = `${fmtNumber(
    convertTempFromSI(sourceC, unit),
    precision,
  )}${unit}`;
  return renderValue(display, {
    title,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Temperature.displayName = 'Temperature';

// ---------------------------------------------------------------------------
// Pressure.
// ---------------------------------------------------------------------------

export interface PressureProps extends BaseFormatProps {
  /** Canonical input in bar. */
  bar?: number | null;
  /** Alternative input in PSI; converted to bar before display. */
  psi?: number | null;
  precision?: number;
  /** Display unit; defaults to the web no-settings metric fallback. */
  unit?: PressureUnit;
}

export function Pressure({
  bar,
  psi,
  precision,
  className: _className,
  unit = 'bar',
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: PressureProps): React.ReactElement {
  let sourceKpa: number | null = null;
  let title: string | undefined;
  if (isFiniteNumber(bar)) {
    sourceKpa = bar * 100;
    title = `${bar.toFixed(2)} bar`;
  } else if (isFiniteNumber(psi)) {
    sourceKpa = psi * KPA_PER_PSI;
    title = `${psi.toFixed(2)} psi`;
  }

  if (sourceKpa === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const display = `${fmtNumber(
    convertPressureFromSI(sourceKpa, unit),
    precision,
  )} ${unit}`;
  return renderValue(display, {
    title,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Pressure.displayName = 'Pressure';

// ---------------------------------------------------------------------------
// Energy (auto Wh vs kWh).
// ---------------------------------------------------------------------------

export interface EnergyProps extends BaseFormatProps {
  /** Canonical input in kWh. */
  kwh?: number | null;
  /** Alternative input in Wh; converted to kWh before display. */
  wh?: number | null;
  precision?: number;
  /** Force a display unit. Defaults to auto: Wh when |kWh| < 1, else kWh. */
  unit?: 'kWh' | 'Wh';
}

export function Energy({
  kwh,
  wh,
  precision,
  className: _className,
  unit,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: EnergyProps): React.ReactElement {
  let sourceKwh: number | null = null;
  if (isFiniteNumber(kwh)) {
    sourceKwh = kwh;
  } else if (isFiniteNumber(wh)) {
    sourceKwh = wh / 1000;
  }

  if (sourceKwh === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const useWh = unit === 'Wh' || (unit !== 'kWh' && Math.abs(sourceKwh) < 1);
  const value = useWh ? sourceKwh * 1000 : sourceKwh;
  const display = `${fmtNumber(value, precision)} ${useWh ? 'Wh' : 'kWh'}`;
  return renderValue(display, {
    title: `${sourceKwh.toFixed(3)} kWh`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Energy.displayName = 'Energy';

// ---------------------------------------------------------------------------
// Power (auto W vs kW).
// ---------------------------------------------------------------------------

export interface PowerProps extends BaseFormatProps {
  /** Canonical input in kW. */
  kw?: number | null;
  /** Alternative input in W; converted to kW before display. */
  w?: number | null;
  precision?: number;
  /** Force a display unit. Defaults to auto: W when |kW| < 1, else kW. */
  unit?: 'kW' | 'W';
}

export function Power({
  kw,
  w,
  precision,
  className: _className,
  unit,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: PowerProps): React.ReactElement {
  let sourceKw: number | null = null;
  if (isFiniteNumber(kw)) {
    sourceKw = kw;
  } else if (isFiniteNumber(w)) {
    sourceKw = w / 1000;
  }

  if (sourceKw === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const useW = unit === 'W' || (unit !== 'kW' && Math.abs(sourceKw) < 1);
  const value = useW ? sourceKw * 1000 : sourceKw;
  const display = `${fmtNumber(value, precision)} ${useW ? 'W' : 'kW'}`;
  return renderValue(display, {
    title: `${sourceKw.toFixed(3)} kW`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Power.displayName = 'Power';

// ---------------------------------------------------------------------------
// Voltage.
// ---------------------------------------------------------------------------

export interface VoltageProps extends BaseFormatProps {
  volts?: number | null;
  precision?: number;
}

export function Voltage({
  volts,
  precision,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: VoltageProps): React.ReactElement {
  if (!isFiniteNumber(volts)) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }
  return renderValue(`${fmtNumber(volts, precision)} V`, {
    title: `${volts.toFixed(3)} V`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Voltage.displayName = 'Voltage';

// ---------------------------------------------------------------------------
// Current (amperage).
// ---------------------------------------------------------------------------

export interface CurrentProps extends BaseFormatProps {
  amps?: number | null;
  precision?: number;
}

export function Current({
  amps,
  precision,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: CurrentProps): React.ReactElement {
  if (!isFiniteNumber(amps)) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }
  return renderValue(`${fmtNumber(amps, precision)} A`, {
    title: `${amps.toFixed(3)} A`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Current.displayName = 'Current';

// ---------------------------------------------------------------------------
// Currency.
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCY_SYMBOL = '$';

export interface CurrencyProps extends BaseFormatProps {
  /** Amount in the user's preferred currency. No FX conversion is performed. */
  value?: number | null;
  /** Decimal places to render (defaults to 2 — the standard for fiat amounts). */
  precision?: number;
  /** Override the symbol prefix. */
  symbolOverride?: string;
  /** Currency symbol from settings; defaults to "$" (the web no-settings fallback). */
  currencySymbol?: string;
  /** Custom rendering when value is null/undefined/NaN. Defaults to "—". */
  fallback?: string;
}

export function Currency({
  value,
  precision = 2,
  symbolOverride,
  className: _className,
  currencySymbol = DEFAULT_CURRENCY_SYMBOL,
  fallback = EM_DASH,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: CurrencyProps): React.ReactElement {
  if (!isFiniteNumber(value)) {
    return renderValue(fallback, {style, testID, dataTestID, accessibilityLabel});
  }
  const symbol = symbolOverride ?? currencySymbol;
  const display = `${symbol}${fmtNumber(value, precision)}`;
  return renderValue(display, {
    title: `${symbol}${value.toFixed(precision)}`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Currency.displayName = 'Currency';

// ---------------------------------------------------------------------------
// Percentage.
// ---------------------------------------------------------------------------

export interface PercentageProps extends BaseFormatProps {
  /** Already a percentage value, e.g. SoC of 85 → "85%". */
  value?: number | null;
  /** A 0–1 ratio; multiplied by 100 before display. */
  ratio?: number | null;
  precision?: number;
}

export function Percentage({
  value,
  ratio,
  precision,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: PercentageProps): React.ReactElement {
  let resolved: number | null = null;
  if (isFiniteNumber(value)) {
    resolved = value;
  } else if (isFiniteNumber(ratio)) {
    resolved = ratio * 100;
  }

  if (resolved === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  return renderValue(`${fmtNumber(resolved, precision)}%`, {
    title: `${resolved.toFixed(2)}%`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Percentage.displayName = 'Percentage';

// ---------------------------------------------------------------------------
// FormattedNumber (web Number.tsx).
// ---------------------------------------------------------------------------

export interface FormattedNumberProps extends BaseFormatProps {
  value: number | null | undefined;
  precision?: number;
  /** Optional unit suffix appended after a single space. */
  unit?: string;
}

export function FormattedNumber({
  value,
  precision,
  unit,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: FormattedNumberProps): React.ReactElement {
  if (!isFiniteNumber(value)) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }
  const display = `${fmtNumber(value, precision)}${unit ? ` ${unit}` : ''}`;
  return renderValue(display, {
    title: `${value}`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

FormattedNumber.displayName = 'FormattedNumber';

// ---------------------------------------------------------------------------
// Duration (millisecond input).
// ---------------------------------------------------------------------------

export type DurationVariant = 'short' | 'long' | 'compact' | 'clock';

export interface DurationProps extends BaseFormatProps {
  ms: number | null | undefined;
  variant?: DurationVariant;
}

export function Duration({
  ms,
  variant = 'short',
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: DurationProps): React.ReactElement {
  if (!isFiniteNumber(ms)) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  let display: string;
  switch (variant) {
    case 'long':
      display = formatDurationMsLong(ms);
      break;
    case 'compact':
      display = formatDurationMsCompact(ms);
      break;
    case 'clock':
      display = formatDurationClock(ms);
      break;
    case 'short':
    default:
      display = formatDurationMs(ms);
      break;
  }

  return renderValue(display, {
    title: `${ms} ms`,
    style,
    testID,
    dataTestID,
    accessibilityLabel,
  });
}

Duration.displayName = 'Duration';

// ---------------------------------------------------------------------------
// DateTime.
// ---------------------------------------------------------------------------

export type DateTimeVariant = 'full' | 'date' | 'time' | 'relative' | 'short';

/** Timezone resolution mode. Mirrors web/src/lib/timezone.ts `TzMode`. */
export type TzMode = 'vehicle' | 'user' | 'utc';

export interface DateTimeProps extends BaseFormatProps {
  value: string | Date | null | undefined;
  variant?: DateTimeVariant;
  /**
   * Override timezone. Only `'utc'` is honored natively; `'vehicle'`/`'user'`
   * require a settings/vehicle provider that is absent in the parity tree, so
   * they fall back to the device timezone.
   */
  in?: TzMode;
  /** Append the short tz abbreviation (e.g. "PST") after the rendered value. */
  showTz?: boolean;
}

function resolveDateTz(mode?: TzMode): string | undefined {
  return mode === 'utc' ? 'UTC' : undefined;
}

export function DateTime({
  value,
  variant = 'full',
  in: mode,
  showTz,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: DateTimeProps): React.ReactElement {
  const tz = resolveDateTz(mode);

  let display: string;
  switch (variant) {
    case 'relative':
      display = formatRelativeTime(value, tz);
      break;
    case 'date':
      display = formatDate(value, tz);
      break;
    case 'time':
      display = formatTime(value, tz);
      break;
    case 'short':
      display = formatDateShort(value, tz);
      break;
    case 'full':
    default:
      display = formatDateTime(value, tz);
      break;
  }

  const date = toDate(value);
  let title: string | undefined;
  if (date) {
    title = tz ? `${date.toISOString()} (${tz})` : date.toISOString();
  }

  const abbrevTz = mode === 'utc' ? 'UTC' : deviceTimeZone();
  const abbrev = showTz && value ? tzAbbreviation(value, abbrevTz) : '';

  return React.createElement(
    AppText,
    {
      accessibilityLabel: accessibilityLabel ?? title,
      style,
      testID: testID ?? dataTestID,
    },
    display,
    abbrev
      ? React.createElement(Text, {style: styles.tzAbbrev}, ` ${abbrev}`)
      : null,
  );
}

DateTime.displayName = 'DateTime';

// ---------------------------------------------------------------------------
// Range + useRangeLabel.
// ---------------------------------------------------------------------------

export interface RangeProps extends BaseFormatProps {
  /** Vehicle/charge state snapshot with `rated_range` + `ideal_range` in SI metres. */
  state: PreferredRangeFields | null | undefined;
  /** Optional decimal precision override for the value. */
  precision?: number;
  /** Distance display unit; defaults to the web no-settings metric fallback. */
  unit?: DistanceUnit;
  /** Preferred range type; defaults to "rated" (the web settings default). */
  rangeType?: RangeType;
}

export function Range({
  state,
  precision = 0,
  className: _className,
  unit = 'km',
  rangeType = 'rated',
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: RangeProps): React.ReactElement {
  const {meters} = selectPreferredRange(state, rangeType);

  if (meters === null) {
    return renderValue(EM_DASH, {style, testID, dataTestID, accessibilityLabel});
  }

  const display = `${fmtNumber(
    convertDistanceFromSI(meters, unit),
    precision,
  )} ${unit}`;
  return renderValue(display, {style, testID, dataTestID, accessibilityLabel});
}

Range.displayName = 'Range';

/**
 * Companion hook returning the "Rated Range" / "Ideal Range" label honoring the
 * preferred range type. react-i18next is unavailable in the parity tree, so the
 * English default label (web's `t()` fallback) is returned directly.
 */
export function useRangeLabel(
  state: PreferredRangeFields | null | undefined,
  rangeType: RangeType = 'rated',
): string {
  return selectPreferredRange(state, rangeType).defaultLabel;
}

const styles = StyleSheet.create({
  tzAbbrev: {
    color: colors.textMuted,
    fontSize: 11,
  },
});
