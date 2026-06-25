// Native parity port of web/src/components/data-display/format/Range.tsx.
// Renders the user's preferred "primary range" honoring BOTH the distance-unit
// preference (km vs mi, web `useUnits`) and the rated-vs-ideal `preferred_range`
// preference (web `usePreferredRange` → `selectPreferredRange`). The web
// component leans on useUnits, usePreferredRange, formatDistance, and
// react-i18next; those are inlined here (matching the self-contained
// native-parity convention used by the sibling Distance port) and the user
// preference is read from the native useSettings query, derived exactly like
// web `useUnits` / `useSettings().rangeType`. No DOM <span>, Recharts, Leaflet,
// or web UI modules are imported.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

const EM_DASH = '\u2014';
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const DEFAULT_LOCALE = 'en-US';
/** Web `Range` defaults `precision` to 0 (overriding the lib distance default). */
const DEFAULT_PRECISION = 0;
/** lib `DEFAULT_PRECISION.distance` fallback when no override/setting applies. */
const DISTANCE_FALLBACK_PRECISION = 1;

type DistanceUnit = 'km' | 'mi';
type RangeType = 'rated' | 'ideal';

/** Vehicle/charge state snapshot with `rated_range` + `ideal_range` in SI metres. */
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

export interface RangeProps {
  /** Vehicle/charge state snapshot with `rated_range` + `ideal_range` in SI metres. */
  state: PreferredRangeFields | null | undefined;
  /** Optional decimal precision override for the value. */
  precision?: number;
  /** Accepted for web parity; React Native has no CSS class names. */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

/**
 * Reusable "primary range" renderer that respects both the user's
 * distance-unit preference (km vs mi) and the user's `preferred_range`
 * preference (rated vs ideal).
 *
 * Use on surfaces that show "the range" generically — Glance, vehicle list
 * cards, fleet summary, charge status, the dashboard hero. Do NOT use on
 * explicit comparison surfaces (RangeBarWidget, RangeEstimateWidget,
 * BatteryRangePanel) which render BOTH ranges side-by-side regardless of
 * preference.
 */
export function Range({
  state,
  precision = DEFAULT_PRECISION,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: RangeProps) {
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistanceUnit(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const settingsPrecision = derivePrecision(settings?.decimal_precision);

  const {meters} = selectPreferredRange(state, settings?.preferred_range);

  if (meters == null) {
    return (
      <AppText
        accessibilityLabel={accessibilityLabel}
        style={style}
        testID={testID ?? dataTestID ?? 'range'}>
        {EM_DASH}
      </AppText>
    );
  }

  const visibleText = formatDistance(
    meters,
    distanceUnit,
    precision,
    settingsPrecision,
    locale,
  );

  return (
    <AppText
      accessibilityLabel={accessibilityLabel ?? visibleText}
      style={style}
      testID={testID ?? dataTestID ?? 'range'}>
      {visibleText}
    </AppText>
  );
}

Range.displayName = 'Range';

/**
 * Companion hook returning the "Rated Range" / "Ideal Range" label honoring the
 * user's `preferred_range` preference. Use when you need the label separate from
 * the value — e.g. inside a stat tile that renders them in different elements.
 *
 * The web hook localizes via `t('common.${labelKey}', defaultLabel)`. The native
 * parity layer has no react-i18next provider (see `_toastHelpers`), so the
 * English fallback label is returned directly, preserving the i18n intent.
 */
export function useRangeLabel(
  state: PreferredRangeFields | null | undefined,
): string {
  const {data: settings} = useSettings();
  const {defaultLabel} = selectPreferredRange(state, settings?.preferred_range);
  return defaultLabel;
}

/**
 * Pure port of `@/lib/preferredRange#selectPreferredRange`. Defaults to
 * `'rated'` when the preference is missing or mistyped, matching the backend
 * default surfaced by `useSettings`.
 */
function selectPreferredRange(
  state: PreferredRangeFields | null | undefined,
  rangeType: string | null | undefined,
): PreferredRangeResult {
  const type: RangeType = rangeType === 'ideal' ? 'ideal' : 'rated';
  const meters =
    type === 'ideal'
      ? state?.ideal_range ?? null
      : state?.rated_range ?? null;
  return type === 'ideal'
    ? {meters, source: 'ideal', labelKey: 'idealRange', defaultLabel: 'Ideal Range'}
    : {meters, source: 'rated', labelKey: 'ratedRange', defaultLabel: 'Rated Range'};
}

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

/** Mirrors lib `resolvePrecision`: override → settings → distance fallback. */
function resolvePrecision(
  override: number | undefined,
  settingsPrecision: number | undefined,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof settingsPrecision === 'number' &&
    Number.isFinite(settingsPrecision) &&
    settingsPrecision >= 0
  ) {
    return Math.floor(settingsPrecision);
  }
  return DISTANCE_FALLBACK_PRECISION;
}

function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/** Port of lib `formatDistance`: non-finite → em-dash, else `${value} ${unit}`. */
function formatDistance(
  meters: number,
  unit: DistanceUnit,
  override: number | undefined,
  settingsPrecision: number | undefined,
  locale: string,
): string {
  if (!Number.isFinite(meters)) {
    return EM_DASH;
  }
  const digits = resolvePrecision(override, settingsPrecision);
  const value = convertDistanceFromSI(meters, unit);
  return `${fmtNumber(value, digits, locale)} ${unit}`;
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
