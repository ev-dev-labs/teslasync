// Native parity port of web/src/components/data-display/format/Distance.tsx.
// Preserves the metric/imperial preference, miles/km input handling, optional
// precision, and the raw-value exposure (web `title`) using React Native
// primitives instead of a DOM <span>. The web component leans on useUnits,
// fmtNumber, and convertDistanceFromSI; those are inlined here (matching the
// self-contained native-parity convention) and the user preference is read
// from the native useSettings query, derived exactly like web `useUnits`.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

const EM_DASH = '\u2014';
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const DEFAULT_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';

type DistanceUnit = 'km' | 'mi';

export interface DistanceProps {
  /** Canonical input in miles (matches the codebase internal unit). */
  miles?: number | null;
  /** Alternative input in kilometres; converted to miles before display. */
  km?: number | null;
  /** Optional decimal precision; defaults to the user's settings precision. */
  precision?: number;
  /** Accepted for web parity; React Native has no CSS class names. */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

/**
 * Distance renderer that respects the user's metric/imperial preference.
 * Always exposes the raw caller-supplied value via the accessibility hint
 * (the native analogue of the web `title` attribute).
 */
export function Distance({
  miles,
  km,
  precision,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: DistanceProps) {
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistanceUnit(settings?.unit_of_length);
  const settingsPrecision = derivePrecision(settings?.decimal_precision);
  const locale = deriveLocale(settings?.locale);

  let sourceMeters: number | null = null;
  let rawLabel: string | undefined;
  if (miles != null && Number.isFinite(miles)) {
    sourceMeters = miles * METERS_PER_MILE;
    rawLabel = `${miles.toFixed(2)} mi`;
  } else if (km != null && Number.isFinite(km)) {
    sourceMeters = km * METERS_PER_KM;
    rawLabel = `${km.toFixed(2)} km`;
  }

  if (sourceMeters == null) {
    return (
      <AppText
        accessibilityLabel={accessibilityLabel}
        style={style}
        testID={testID ?? dataTestID ?? 'distance'}>
        {EM_DASH}
      </AppText>
    );
  }

  const effectivePrecision = precision ?? settingsPrecision ?? DEFAULT_PRECISION;
  const display = fmtNumber(
    convertDistanceFromSI(sourceMeters, distanceUnit),
    effectivePrecision,
    locale,
  );
  const visibleText = `${display} ${distanceUnit}`;

  return (
    <AppText
      accessibilityHint={rawLabel}
      accessibilityLabel={accessibilityLabel ?? visibleText}
      style={style}
      testID={testID ?? dataTestID ?? 'distance'}>
      {visibleText}
    </AppText>
  );
}

Distance.displayName = 'Distance';

function deriveDistanceUnit(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision)) {
    return undefined;
  }
  if (decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function fmtNumber(value: number, decimals: number, locale: string): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(safeValue);
  } catch {
    try {
      return new Intl.NumberFormat(DEFAULT_LOCALE, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(safeValue);
    } catch {
      return safeValue.toFixed(digits);
    }
  }
}
