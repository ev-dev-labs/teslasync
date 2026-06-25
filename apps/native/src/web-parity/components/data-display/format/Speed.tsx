// Native parity port of web/src/components/data-display/format/Speed.tsx.
// Renders a speed value while respecting the user's metric/imperial
// preference. The web source pulls three modules that have no native parity
// surface: `useUnits` (the per-render settings→unit-pref bridge), the
// `convertSpeedFromSI` SI converter from `@/lib/unitConversion`, and
// `fmtNumber` from `@/lib/numberFormat`. To keep behaviour byte-for-byte:
//   - The user's speed preference is resolved from the native `useSettings`
//     web-parity hook (the available settings source), mirroring the web
//     `useUnits → useSettings` chain and the `deriveSpeed` rule
//     (`unit_of_length === 'mi' ? 'mph' : 'km/h'`).
//   - `convertSpeedFromSI` and `fmtNumber` are inlined verbatim from their web
//     definitions (same constants, same locale-fallback formatting, same
//     precision default of 2).
// The web `<span>` becomes an `AppText`, the `className` Tailwind hook is
// retained on the props for source compatibility but ignored on native, and
// the raw-source-value `title` tooltip is surfaced through `accessibilityHint`.

import React from 'react';
import { type StyleProp, type TextStyle } from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { useSettings } from '../../../api/hooks/useSettings';

/** Placeholder rendered when neither a finite mph nor km/h value is supplied. */
const FALLBACK = '—';

/** Default decimal precision — mirrors the web `_globalPrecision` floor of 2. */
const DEFAULT_PRECISION = 2;

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

type SpeedUnitPref = 'km/h' | 'mph';

/** Safe number extraction from unknown values; returns 0 for nullish/NaN. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Format a number with locale-aware separators, falling back to en-US on a bad
 * locale tag. Inlined from `@/lib/numberFormat` `fmtNumber`.
 */
function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/**
 * Convert speed from SI meters-per-second to the user's display unit. Inlined
 * verbatim from `@/lib/unitConversion` `convertSpeedFromSI`.
 */
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

/** Mirrors the web `useUnits` `deriveSpeed`: imperial length ⇒ mph, else km/h. */
function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

/** Mirrors the web `useUnits` `derivePrecision`: floor a valid non-negative int. */
function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') return undefined;
  if (!Number.isFinite(decimalPrecision)) return undefined;
  if (decimalPrecision < 0) return undefined;
  return Math.floor(decimalPrecision);
}

interface SpeedProps {
  /** Canonical input in mph. */
  mph?: number | null;
  /** Alternative input in km/h; converted to mph before display. */
  kmh?: number | null;
  precision?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Speed renderer that respects the user's metric/imperial preference.
 * The `accessibilityHint` (native analog of the web `title` tooltip) shows the
 * raw caller-supplied value with its source unit.
 */
export function Speed({
  mph,
  kmh,
  precision,
  className: _className,
  style,
  testID,
}: SpeedProps) {
  const { data: settings } = useSettings();
  const speedUnit = deriveSpeed(settings?.unit_of_length);
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, speedUnit);

  let sourceMph: number | null = null;
  let title: string | undefined;
  if (mph != null && Number.isFinite(mph)) {
    sourceMph = mph * 0.44704;
    title = `${mph.toFixed(1)} mph`;
  } else if (kmh != null && Number.isFinite(kmh)) {
    sourceMph = (kmh * 1000) / 3600;
    title = `${kmh.toFixed(1)} km/h`;
  }

  if (sourceMph == null) {
    return (
      <AppText style={style} testID={testID}>
        {FALLBACK}
      </AppText>
    );
  }

  const display = fmtNumber(
    toSpeedDisplay(sourceMph),
    precision ?? derivePrecision(settings?.decimal_precision),
  );
  return (
    <AppText accessibilityHint={title} style={style} testID={testID}>
      {display} {speedUnit}
    </AppText>
  );
}
