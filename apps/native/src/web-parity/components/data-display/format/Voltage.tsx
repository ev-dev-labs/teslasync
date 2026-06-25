// Native parity port of web/src/components/data-display/format/Voltage.tsx.
//
// The web component renders a DOM <span> and imports `fmtNumber` from
// @/lib/numberFormat (a locale-aware formatter backed by a useSettings-managed
// global precision/locale). Neither the DOM span nor the web settings provider
// is wired into the native parity tree, so `fmtNumber` is ported inline with the
// web no-settings defaults (en-US, precision 2) — matching the sibling
// data-display/Delta.tsx and the format/index.ts barrel — and the value renders
// through the shared AppText primitive. The web hover `title` has no native
// equivalent and is surfaced via `accessibilityLabel`. See the .parity.json
// sidecar for the line-by-line source map.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';

// ---- Ported number formatting (web/src/lib/numberFormat.ts: fmtNumber) ------

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
const EM_DASH = '—';

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(
  value: unknown,
  decimals?: number,
  locale = DEFAULT_LOCALE,
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

// ---- Component --------------------------------------------------------------

export interface VoltageProps {
  volts?: number | null;
  precision?: number;
  /** Web Tailwind class retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  /** Overrides the native accessibility label (web exposed the raw value via `title`). */
  accessibilityLabel?: string;
}

/** Voltage renderer with locale-aware number formatting. */
export function Voltage({
  volts,
  precision,
  className: _className,
  style,
  testID,
  accessibilityLabel,
}: VoltageProps): React.ReactElement {
  if (volts == null || !Number.isFinite(volts)) {
    return (
      <AppText
        accessibilityLabel={accessibilityLabel}
        style={style}
        testID={testID}>
        {EM_DASH}
      </AppText>
    );
  }
  return (
    <AppText
      accessibilityLabel={accessibilityLabel ?? `${volts.toFixed(3)} V`}
      style={style}
      testID={testID}>
      {`${fmtNumber(volts, precision)} V`}
    </AppText>
  );
}

Voltage.displayName = 'Voltage';
