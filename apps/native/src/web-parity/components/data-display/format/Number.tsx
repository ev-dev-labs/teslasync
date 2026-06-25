// Native parity port of web/src/components/data-display/format/Number.tsx.
// Replaces the DOM <span> with React Native AppText while preserving the
// locale-aware fmtNumber rendering, optional unit suffix, em-dash empty
// state, and the raw-value tooltip (mapped to an accessibility hint).

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';

const EM_DASH = '—';
const DEFAULT_GLOBAL_PRECISION = 2;

export interface FormattedNumberProps {
  value: number | null | undefined;
  precision?: number;
  /** Optional unit suffix appended after a single space. */
  unit?: string;
  /** Web className retained for source parity; ignored on native. */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

/**
 * Generic locale-aware number renderer. Use the unit-aware components
 * (`Distance`, `Speed`, `Energy`, etc.) when a domain unit applies.
 */
export function FormattedNumber({
  value,
  precision,
  unit,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: FormattedNumberProps) {
  const resolvedTestID = testID ?? dataTestID ?? 'formatted-number';

  if (value == null || !Number.isFinite(value)) {
    return (
      <AppText
        accessibilityLabel={accessibilityLabel}
        style={style}
        testID={resolvedTestID}>
        {EM_DASH}
      </AppText>
    );
  }

  const display = fmtNumber(value, precision);
  const suffix = unit ? ` ${unit}` : '';

  return (
    <AppText
      accessible
      accessibilityHint={`${value}`}
      accessibilityLabel={accessibilityLabel}
      style={style}
      testID={resolvedTestID}>
      {display}
      {suffix}
    </AppText>
  );
}

FormattedNumber.displayName = 'FormattedNumber';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;

  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}
