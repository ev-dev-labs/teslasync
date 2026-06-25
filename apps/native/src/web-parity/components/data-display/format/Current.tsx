// Native parity port of web/src/components/data-display/format/Current.tsx.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';

export interface CurrentProps {
  amps?: number | null;
  precision?: number;
  className?: string;
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

/** Current (amperage) renderer with locale-aware number formatting. */
export function Current({
  amps,
  precision,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: CurrentProps) {
  if (amps == null || !Number.isFinite(amps)) {
    return (
      <AppText style={style} testID={testID ?? dataTestID}>
        {EMPTY_VALUE}
      </AppText>
    );
  }

  const exactAmps = `${amps.toFixed(3)} A`;

  return (
    <AppText
      accessibilityLabel={exactAmps}
      style={style}
      testID={testID ?? dataTestID}>
      {fmtNumber(amps, precision)} A
    </AppText>
  );
}
