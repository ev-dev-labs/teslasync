// Native parity port of web/src/components/data-display/format/Pressure.tsx.
//
// The web component pulls three browser-oriented modules that have no native
// counterpart in this tree: @/hooks/useUnits (the per-render settings→unit-pref
// bridge), @/lib/numberFormat (fmtNumber + its locale/precision globals) and
// @/lib/unitConversion (convertPressureFromSI + the kPa↔psi/bar constants).
// Their pure logic is ported verbatim and kept self-contained below so the
// rendered string — unit selection, the bar*100 / psi*6.894757 kPa
// normalisation, the SI→display conversion, and the locale-aware fmtNumber
// output — matches the web renderer. Native has no useUnits hook, so the
// pressure preference, decimal precision and locale are derived directly from
// the existing native ../../../api/hooks/useSettings query, mirroring web
// useUnits/numberFormat (derivePressure → 'psi'|'bar'; global precision clamped
// 0–20, default 2; global locale validated, default 'en-US'). The DOM <span> +
// title (hover tooltip) + className surface becomes an AppText whose raw
// caller-supplied value is exposed through accessibilityLabel (React Native has
// no hover tooltip, matching the DateTime parity precedent).

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

/** Pressure display unit (target of convertPressureFromSI). Ported from web. */
type PressureUnitPref = 'kPa' | 'psi' | 'bar';

/** 1 psi = 6.894757 kPa (NIST SP 811, rounded to display precision). */
const KPA_PER_PSI = 6.894757;
/** 1 bar = 100 kPa (BIPM definition). */
const KPA_PER_BAR = 100;

/** Fallback decimal precision when settings.decimal_precision is unavailable. */
const DEFAULT_PRECISION = 2;
/** Fallback BCP-47 locale when settings.locale is unavailable. */
const DEFAULT_LOCALE = 'en-US';

/**
 * Convert pressure from SI kilopascals to the user's display unit.
 * Ported verbatim from web `@/lib/unitConversion`.
 */
function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
    // no default
  }
}

/**
 * Derive the pressure display preference from the raw settings string.
 * Mirrors web `useUnits` derivePressure: only 'psi' opts out of the 'bar'
 * default (kPa is never selected by the settings bridge).
 */
function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

/**
 * Resolve the effective decimal precision the way web `numberFormat`'s
 * setGlobalPrecision does: clamp to 0–20, falling back to 2 for invalid input.
 */
function resolveGlobalPrecision(decimals: number | undefined): number {
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) {
    return DEFAULT_PRECISION;
  }
  return Math.max(0, Math.min(20, decimals));
}

/**
 * Resolve the effective locale the way web `numberFormat`'s setGlobalLocale
 * does: blank / whitespace-only falls back to 'en-US'.
 */
function resolveGlobalLocale(locale: string | undefined): string {
  return locale && locale.trim() ? locale : DEFAULT_LOCALE;
}

/** Safe number extraction; returns 0 for nullish/NaN. Ported from numberFormat. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Locale-aware fixed-precision number formatter ported from web
 * `@/lib/numberFormat`. Falls back to 'en-US' if the locale tag is rejected.
 */
function fmtNumber(v: unknown, decimals: number, locale: string): string {
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

interface PressureProps {
  /**
   * Canonical input in bar. Matches the convention used by
   * `useSettings.toPressureDisplay(bar)`.
   */
  bar?: number | null;
  /** Alternative input in PSI; converted to bar before display. */
  psi?: number | null;
  precision?: number;
  /** Accepted for web parity; not applied on native (no className styling). */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Pressure renderer that respects the user's bar/psi preference. The raw
 * caller-supplied value with its source unit (the web hover title) is exposed
 * via accessibilityLabel since React Native has no hover tooltip.
 */
export function Pressure({
  bar,
  psi,
  precision,
  className: _className,
  style,
  testID,
}: PressureProps) {
  const {data: settings} = useSettings();
  const pressureUnit = derivePressure(settings?.unit_of_pressure);
  const globalPrecision = resolveGlobalPrecision(settings?.decimal_precision);
  const globalLocale = resolveGlobalLocale(settings?.locale);
  const toPressureDisplay = (value: number) =>
    convertPressureFromSI(value, pressureUnit);

  let sourceBar: number | null = null;
  let title: string | undefined;
  if (bar != null && Number.isFinite(bar)) {
    sourceBar = bar * 100;
    title = `${bar.toFixed(2)} bar`;
  } else if (psi != null && Number.isFinite(psi)) {
    sourceBar = psi * 6.894757;
    title = `${psi.toFixed(2)} psi`;
  }

  if (sourceBar == null) {
    return (
      <AppText style={style} testID={testID}>
        —
      </AppText>
    );
  }

  const display = fmtNumber(
    toPressureDisplay(sourceBar),
    precision ?? globalPrecision,
    globalLocale,
  );
  return (
    <AppText accessibilityLabel={title} style={style} testID={testID}>
      {`${display} ${pressureUnit}`}
    </AppText>
  );
}
