// Native parity port of web/src/components/data-display/format/Energy.tsx.
// Renders an energy value, auto-selecting Wh vs kWh for readability and
// exposing the canonical kWh value through the native accessibility label
// (the web component used the DOM `title` attribute for this).

import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';

// Web `fmtNumber` reads a module-level global precision (default 2) set by
// useSettings. The native parity layer has no settings store wired in here,
// so we mirror the web module's out-of-box default precision and en-US locale.
const DEFAULT_GLOBAL_PRECISION = 2;

export interface EnergyProps {
  /** Canonical input in kWh. */
  kwh?: number | null;
  /** Alternative input in Wh; converted to kWh before display. */
  wh?: number | null;
  precision?: number;
  /** Web-only styling hook; accepted for source compatibility, ignored on native. */
  className?: string;
  /** Force a display unit. Defaults to auto: Wh when |kWh| < 1, else kWh. */
  unit?: 'kWh' | 'Wh';
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Energy renderer that auto-picks Wh vs kWh for readability and exposes
 * the canonical kWh value via the accessibility label.
 */
export function Energy({
  kwh,
  wh,
  precision,
  className: _className,
  unit,
  style,
  testID,
}: EnergyProps) {
  let sourceKwh: number | null = null;
  if (kwh != null && Number.isFinite(kwh)) {
    sourceKwh = kwh;
  } else if (wh != null && Number.isFinite(wh)) {
    sourceKwh = wh / 1000;
  }

  if (sourceKwh == null) {
    return (
      <AppText style={style} testID={testID}>
        —
      </AppText>
    );
  }

  const useWh = unit === 'Wh' || (unit !== 'kWh' && Math.abs(sourceKwh) < 1);
  const value = useWh ? sourceKwh * 1000 : sourceKwh;
  const display = fmtNumber(value, precision);
  const unitLabel = useWh ? 'Wh' : 'kWh';
  return (
    <AppText
      accessibilityLabel={`${sourceKwh.toFixed(3)} kWh`}
      style={style}
      testID={testID}>
      {`${display} ${unitLabel}`}
    </AppText>
  );
}

Energy.displayName = 'Energy';

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
