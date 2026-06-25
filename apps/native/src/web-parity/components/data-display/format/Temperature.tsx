// Native parity port of web/src/components/data-display/format/Temperature.tsx.
// Renders a temperature value honoring the user's °C/°F preference. The web
// component read that preference through useUnits → useSettings; the native
// port reads the same preference from the native useSettings parity hook.
// The web component exposed the raw caller-supplied value via the DOM `title`
// attribute; on native that maps to the accessibility label since React Native
// has no hover-title equivalent.

import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

// Web `fmtNumber` reads a module-level global precision (default 2) and locale
// (default en-US) set imperatively by useSettings. The native parity layer
// doesn't wire that global store here, so we mirror the web module's out-of-box
// defaults — matching the sibling Energy parity port.
const DEFAULT_GLOBAL_PRECISION = 2;

type TemperatureUnit = '°C' | '°F';

export interface TemperatureProps {
  /** Canonical input in °C. */
  c?: number | null;
  /** Alternative input in °F; converted to °C before display. */
  f?: number | null;
  precision?: number;
  /** Web-only styling hook; accepted for source compatibility, ignored on native. */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Temperature renderer that respects the user's °C/°F preference. The
 * accessibility label exposes the raw caller-supplied value with its source
 * unit (the web component used the DOM `title` attribute for this).
 */
export function Temperature({
  c,
  f,
  precision,
  className: _className,
  style,
  testID,
}: TemperatureProps) {
  const {data: settings} = useSettings();
  const tempUnit = deriveTemperatureUnit(settings?.unit_of_temp);
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, tempUnit);

  let sourceC: number | null = null;
  let label: string | undefined;
  if (c != null && Number.isFinite(c)) {
    sourceC = c;
    label = `${c.toFixed(1)} °C`;
  } else if (f != null && Number.isFinite(f)) {
    sourceC = ((f - 32) * 5) / 9;
    label = `${f.toFixed(1)} °F`;
  }

  if (sourceC == null) {
    return (
      <AppText style={style} testID={testID}>
        —
      </AppText>
    );
  }

  const display = fmtNumber(toTemperatureDisplay(sourceC), precision);
  return (
    <AppText accessibilityLabel={label} style={style} testID={testID}>
      {`${display}${tempUnit}`}
    </AppText>
  );
}

Temperature.displayName = 'Temperature';

// Mirrors web useUnits' deriveTemperature: settings.unit_of_temp === 'F' → °F,
// otherwise the canonical °C default (covers undefined while settings load).
function deriveTemperatureUnit(
  unitOfTemp: string | undefined,
): TemperatureUnit {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

// Mirrors web convertTempFromSI (lib/unitConversion.ts): identity for °C and
// the Celsius→Fahrenheit affine transform for °F.
function convertTempFromSI(celsius: number, to: TemperatureUnit): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

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
