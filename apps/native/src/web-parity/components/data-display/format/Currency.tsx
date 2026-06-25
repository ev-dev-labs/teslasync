// Native parity port of web/src/components/data-display/format/Currency.tsx.
// Swaps the DOM <span> + Tailwind className for a React Native <AppText> node,
// sources the user's currency symbol/locale from the native useSettings() query
// hook (the parity analogue of web's useFormatting()), and inlines a locale-aware
// number formatter (the parity analogue of web's lib/numberFormat fmtNumber).
// Verbatim-amount behavior, precision/symbolOverride/fallback semantics, and the
// canonical value previously exposed via the `title` attribute (now
// accessibilityLabel) are all preserved.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

export interface CurrencyProps {
  /**
   * Amount in the user's preferred currency. The component does NOT perform
   * FX conversion -- the value is rendered verbatim with the user's chosen
   * currency symbol from settings.
   */
  value?: number | null;
  /** Decimal places to render (defaults to 2 -- the standard for fiat amounts). */
  precision?: number;
  /**
   * Override the symbol prefix. Useful when a chart axis or tooltip needs a
   * forced symbol that differs from the global setting (rare).
   */
  symbolOverride?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<TextStyle>;
  /** Custom rendering when value is null/undefined/NaN. Defaults to "—". */
  fallback?: string;
  /** Test hook. */
  testID?: string;
}

/**
 * Currency renderer that uses the user's preferred symbol from settings and
 * formats the numeric portion with the global locale (so 1 234,56 € works in
 * de-DE just like $1,234.56 in en-US).
 *
 * Always exposes the canonical numeric value via accessibilityLabel (the native
 * analogue of the web `title` attribute) so assistive tech remains unambiguous
 * regardless of locale.
 */
export function Currency({
  value,
  precision = 2,
  symbolOverride,
  className: _className,
  style,
  fallback = '—',
  testID,
}: CurrencyProps) {
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const locale =
    settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';

  if (value == null || !Number.isFinite(value)) {
    return (
      <AppText style={style} testID={testID}>
        {fallback}
      </AppText>
    );
  }

  const symbol = symbolOverride ?? currencySymbol;
  const display = fmtNumber(value, precision, locale);
  return (
    <AppText
      accessibilityLabel={`${symbol}${value.toFixed(precision)}`}
      style={style}
      testID={testID}>
      {symbol}
      {display}
    </AppText>
  );
}

Currency.displayName = 'Currency';

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
