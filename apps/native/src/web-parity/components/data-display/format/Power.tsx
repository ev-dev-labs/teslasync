// Native parity port of web/src/components/data-display/format/Power.tsx.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';

export interface PowerProps {
  /** Canonical input in kW. */
  kw?: number | null;
  /** Alternative input in W; converted to kW before display. */
  w?: number | null;
  precision?: number;
  className?: string;
  /** Force a display unit. Defaults to auto: W when |kW| < 1, else kW. */
  unit?: 'kW' | 'W';
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
}

const DEFAULT_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';
const EMPTY_VALUE = '—';

function fmtNumber(value: number, precision = DEFAULT_PRECISION): string {
  try {
    return value.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  } catch {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }
}

/**
 * Power renderer that auto-picks W vs kW for readability and exposes the
 * canonical kW value via the accessibility label.
 */
export function Power({
  kw,
  w,
  precision,
  className: _className,
  unit,
  style,
  testID,
  'data-testid': dataTestID,
}: PowerProps) {
  let sourceKw: number | null = null;
  if (kw != null && Number.isFinite(kw)) {
    sourceKw = kw;
  } else if (w != null && Number.isFinite(w)) {
    sourceKw = w / 1000;
  }

  if (sourceKw == null) {
    return (
      <AppText style={style} testID={testID ?? dataTestID}>
        {EMPTY_VALUE}
      </AppText>
    );
  }

  const useW = unit === 'W' || (unit !== 'kW' && Math.abs(sourceKw) < 1);
  const value = useW ? sourceKw * 1000 : sourceKw;
  const display = fmtNumber(value, precision);
  return (
    <AppText
      accessibilityLabel={`${sourceKw.toFixed(3)} kW`}
      style={style}
      testID={testID ?? dataTestID}>
      {display} {useW ? 'W' : 'kW'}
    </AppText>
  );
}
