// Native parity port of web/src/components/data-display/format/Percentage.tsx.
// Swaps the DOM <span> + Tailwind className for a React Native <AppText> node and
// inlines a locale-aware number formatter (the parity analogue of web's
// lib/numberFormat fmtNumber). Web's fmtNumber reads module-global precision and
// locale that useSettings() seeds at runtime, so the native port sources the same
// values from the native useSettings() query hook: an omitted precision falls back
// to settings.decimal_precision (the web _globalPrecision) and the locale comes
// from settings.locale (the web _globalLocale). The value-vs-ratio selection, the
// 0–1 ratio ×100 conversion, the null fallback ("—"), and the canonical two-decimal
// value previously exposed via the `title` attribute (now accessibilityLabel) are
// all preserved.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

export interface PercentageProps {
  /** Already a percentage value, e.g. SoC of 85 → "85%". */
  value?: number | null;
  /** A 0–1 ratio; multiplied by 100 before display. */
  ratio?: number | null;
  precision?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<TextStyle>;
  /** Test hook. */
  testID?: string;
}

/** Percentage renderer that accepts either a percentage or a 0–1 ratio. */
export function Percentage({
  value,
  ratio,
  precision,
  className: _className,
  style,
  testID,
}: PercentageProps) {
  const {data: settings} = useSettings();
  const locale =
    settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';
  const decimals = precision ?? settings?.decimal_precision ?? 2;

  let v: number | null = null;
  if (value != null && Number.isFinite(value)) {
    v = value;
  } else if (ratio != null && Number.isFinite(ratio)) {
    v = ratio * 100;
  }

  if (v == null) {
    return (
      <AppText style={style} testID={testID}>
        —
      </AppText>
    );
  }

  return (
    <AppText
      accessibilityLabel={`${v.toFixed(2)}%`}
      style={style}
      testID={testID}>
      {fmtNumber(v, decimals, locale)}%
    </AppText>
  );
}

Percentage.displayName = 'Percentage';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}
