// Native parity port of web/src/components/data-display/Delta.tsx.
//
// Preserves the direction-aware change-indicator behavior: metric-semantics
// resolution, signed delta, percent/absolute/both display, the unified arrow +
// good/bad color, the trailing comparedTo label, the loading skeleton, and the
// missing-input em-dash. The web hook stack (react-i18next, useUnits,
// useFormatting) and lucide-react arrow icons have no native equivalents wired
// into this parity tree, so they are replaced with a native-safe translation
// fallback, a default unit-preference bridge (overridable via props), and text
// arrow glyphs. See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, type ReactNode} from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

// ---- Ported metric semantics (web/src/lib/metricSemantics.ts) ---------------

/** Direction-is-good for a metric; drives the Delta color. */
export type Direction = 'higher_better' | 'lower_better' | 'neutral';

/** Unit hint used to pick the right suffix/prefix. */
export type MetricUnit =
  | 'currency'
  | 'percent'
  | 'mi'
  | 'km'
  | 'kwh'
  | 'wh'
  | 'wh_per_mi'
  | 'h'
  | 'min'
  | 'count'
  | 'mph'
  | 'kph'
  | 'c'
  | 'f'
  | 'bar';

export interface MetricSemantic {
  id: string;
  direction: Direction;
  unit?: MetricUnit;
}

const METRIC_SEMANTICS = {
  cost: {id: 'cost', direction: 'lower_better', unit: 'currency'},
  cost_per_mi: {id: 'cost_per_mi', direction: 'lower_better', unit: 'currency'},
  energy_consumed: {
    id: 'energy_consumed',
    direction: 'lower_better',
    unit: 'kwh',
  },
  energy_per_mi: {
    id: 'energy_per_mi',
    direction: 'lower_better',
    unit: 'wh_per_mi',
  },
  range: {id: 'range', direction: 'higher_better', unit: 'mi'},
  efficiency: {id: 'efficiency', direction: 'lower_better', unit: 'wh_per_mi'},
  regen_pct: {id: 'regen_pct', direction: 'higher_better', unit: 'percent'},
  drive_score: {id: 'drive_score', direction: 'higher_better', unit: 'count'},
  vampire_drain: {id: 'vampire_drain', direction: 'lower_better', unit: 'kwh'},
  idle_time: {id: 'idle_time', direction: 'lower_better', unit: 'h'},
  distance: {id: 'distance', direction: 'neutral', unit: 'mi'},
  trip_count: {id: 'trip_count', direction: 'neutral', unit: 'count'},
  charging_sessions: {
    id: 'charging_sessions',
    direction: 'neutral',
    unit: 'count',
  },
  battery_health_pct: {
    id: 'battery_health_pct',
    direction: 'higher_better',
    unit: 'percent',
  },
  speed_avg: {id: 'speed_avg', direction: 'neutral', unit: 'mph'},
  temperature: {id: 'temperature', direction: 'neutral', unit: 'c'},
  pressure: {id: 'pressure', direction: 'neutral', unit: 'bar'},
} as const satisfies Record<string, MetricSemantic>;

export type MetricId = keyof typeof METRIC_SEMANTICS;

/**
 * Resolve a metric input (id or inline object) to a `MetricSemantic`.
 * Falls back to `{ direction: 'neutral' }` for unknown ids so the UI never
 * crashes on a typo.
 */
export function resolveSemantic(
  metric: MetricId | MetricSemantic | {direction: Direction; unit?: MetricUnit},
): MetricSemantic {
  if (typeof metric === 'string') {
    const found = METRIC_SEMANTICS[metric];
    if (found) {
      return found;
    }
    return {id: metric, direction: 'neutral'};
  }
  if ('id' in metric && typeof metric.id === 'string') {
    return metric as MetricSemantic;
  }
  return {id: 'inline', direction: metric.direction, unit: metric.unit};
}

// ---- Ported number formatting (web/src/lib/numberFormat.ts: fmtNumber) ------

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(
  value: unknown,
  decimals?: number,
  locale = DEFAULT_LOCALE,
): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

// ---- Native-safe unit-label bridge (web useUnits/useFormatting) -------------

/**
 * Display-unit preferences. Mirrors the strings `useUnits().unitPrefs` yields
 * on web. Defaults match the web no-settings fallback (metric / `$`); native
 * screens can inject real preferences once a settings provider is wired.
 */
export interface DeltaUnitPrefs {
  distance: 'mi' | 'km';
  speed: 'mph' | 'km/h';
  temperature: '°C' | '°F';
  pressure: 'bar' | 'psi';
}

const DEFAULT_UNIT_PREFS: DeltaUnitPrefs = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
};

const DEFAULT_CURRENCY_SYMBOL = '$';

interface ResolvedUnitLabels {
  /** Prefix shown before the value (e.g. currency symbol). */
  prefix: string;
  /** Suffix shown after the value with a leading space (e.g. "kWh"). */
  suffix: string;
}

function resolveUnitLabels(
  unit: MetricUnit | undefined,
  unitPrefs: DeltaUnitPrefs,
  currencySymbol: string,
): ResolvedUnitLabels {
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const pressureUnit = unitPrefs.pressure;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  switch (unit) {
    case 'currency':
      return {prefix: currencySymbol, suffix: ''};
    case 'percent':
      return {prefix: '', suffix: '%'};
    case 'mi':
    case 'km':
      return {prefix: '', suffix: distanceUnit};
    case 'kwh':
      return {prefix: '', suffix: 'kWh'};
    case 'wh':
      return {prefix: '', suffix: 'Wh'};
    case 'wh_per_mi':
      return {prefix: '', suffix: efficiencyUnit};
    case 'h':
      return {prefix: '', suffix: 'h'};
    case 'min':
      return {prefix: '', suffix: 'min'};
    case 'mph':
    case 'kph':
      return {prefix: '', suffix: speedUnit};
    case 'c':
    case 'f':
      return {prefix: '', suffix: tempUnit};
    case 'bar':
      return {prefix: '', suffix: pressureUnit};
    case 'count':
    default:
      return {prefix: '', suffix: ''};
  }
}

function formatAbsolute(
  value: number,
  labels: ResolvedUnitLabels,
  precision: number | undefined,
): string {
  const num = fmtNumber(value, precision);
  if (labels.prefix && labels.suffix) {
    return `${labels.prefix}${num} ${labels.suffix}`;
  }
  if (labels.prefix) {
    return `${labels.prefix}${num}`;
  }
  if (labels.suffix === '%') {
    return `${num}%`;
  }
  if (labels.suffix) {
    return `${num} ${labels.suffix}`;
  }
  return num;
}

function colorForDelta(direction: Direction, signedDelta: number): string {
  if (signedDelta === 0) {
    return colors.textMuted;
  }
  if (direction === 'neutral') {
    return colors.textSecondary;
  }
  const positiveOutcome =
    (direction === 'higher_better' && signedDelta > 0) ||
    (direction === 'lower_better' && signedDelta < 0);
  return positiveOutcome ? colors.success : colors.danger;
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, values) =>
      values ? interpolate(fallback, values) : fallback,
    [],
  );
}

function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

// ---- Component --------------------------------------------------------------

type ArrowGlyph = '↑' | '↓' | '→';

export interface DeltaProps {
  /** Either a registered metric id, a `MetricSemantic`, or an inline `{direction, unit?}`. */
  metric: MetricId | MetricSemantic | {direction: Direction; unit?: MetricUnit};
  /** Current period value, in the metric's display units (caller-converted). */
  current: number | null | undefined;
  /** Previous period value. `null`/`undefined` renders "—" with no colour. */
  previous: number | null | undefined;
  /** Which form to render. Defaults to `percent`. */
  display?: 'percent' | 'absolute' | 'both';
  /** Trailing label, e.g. "vs last week". */
  comparedTo?: string;
  size?: 'sm' | 'md';
  /** If true, render in a tight chip; if false, a stat row. */
  inline?: boolean;
  /** Hide the directional arrow. */
  hideArrow?: boolean;
  /** Force the loading skeleton. */
  loading?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Override the default precision (defaults to 1 for percent, 2 for absolute). */
  precision?: number;
  /** Native-safe unit preference bridge. Defaults to the web no-settings prefs. */
  unitPrefs?: DeltaUnitPrefs;
  /** Currency symbol used for `currency` metrics. Defaults to "$". */
  currencySymbol?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

/**
 * `<Delta>` — direction-aware change indicator with a unified arrow and colour.
 *
 * Behaviour:
 *   - `previous == null`              → renders an em-dash with no colour.
 *   - `previous === 0` and percent    → percent omitted; em-dash shown.
 *   - `delta === 0`                   → "→" arrow + muted colour.
 *   - `direction === 'neutral'`       → never coloured good/bad.
 *
 * The arrow encodes the sign — the absolute value is always rendered as a
 * positive number ("↓ 5%" never "↑ -5%").
 */
export function Delta({
  metric,
  current,
  previous,
  display = 'percent',
  comparedTo,
  size = 'sm',
  inline = true,
  hideArrow = false,
  loading = false,
  className: _className,
  precision,
  unitPrefs = DEFAULT_UNIT_PREFS,
  currencySymbol = DEFAULT_CURRENCY_SYMBOL,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: DeltaProps) {
  const t = useNativeTranslationFallback();
  const semantic = resolveSemantic(metric);
  const labels = resolveUnitLabels(semantic.unit, unitPrefs, currencySymbol);

  const fontSize = size === 'md' ? 14 : 12;
  const rowStyle = inline ? styles.inlineRow : styles.statRow;

  if (loading) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.inlineRow, style]}
        testID={testID ?? dataTestID ?? 'delta-skeleton'}>
        <View style={[styles.skeleton, {height: size === 'md' ? 16 : 14}]} />
      </View>
    );
  }

  // Missing inputs — render em-dash, no colour.
  if (
    current == null ||
    !Number.isFinite(current) ||
    previous == null ||
    !Number.isFinite(previous)
  ) {
    return (
      <View
        accessibilityLabel={
          accessibilityLabel ?? t('delta.noComparison', 'No comparison data')
        }
        accessibilityRole="text"
        accessible
        style={[styles.inlineRow, style]}
        testID={testID ?? dataTestID ?? 'delta-empty'}>
        <AppText style={[styles.value, {color: colors.textMuted, fontSize}]}>
          —
        </AppText>
        {comparedTo ? (
          <AppText
            style={[styles.comparedTo, {color: colors.textMuted, fontSize}]}>
            {comparedTo}
          </AppText>
        ) : null}
      </View>
    );
  }

  const signedDelta = current - previous;
  // Percent only when previous is non-zero and finite.
  const canPercent = previous !== 0;
  const signedPct = canPercent ? (signedDelta / Math.abs(previous)) * 100 : null;

  const color = colorForDelta(semantic.direction, signedDelta);

  let arrow: ArrowGlyph;
  if (signedDelta > 0) {
    arrow = '↑';
  } else if (signedDelta < 0) {
    arrow = '↓';
  } else {
    arrow = '→';
  }

  const absDelta = Math.abs(signedDelta);
  const absPct = signedPct == null ? null : Math.abs(signedPct);

  const absText = formatAbsolute(absDelta, labels, precision);
  const pctText =
    absPct == null ? null : `${fmtNumber(absPct, precision ?? 1)}%`;

  let valueNode: ReactNode;
  let valueText: string;
  if (display === 'absolute') {
    valueNode = absText;
    valueText = absText;
  } else if (display === 'both') {
    // absolute with the percent rendered faded alongside it.
    valueNode = pctText ? (
      <AppText style={[styles.value, {color, fontSize}]}>
        {absText} <Text style={styles.both}>({pctText})</Text>
      </AppText>
    ) : (
      absText
    );
    valueText = pctText ? `${absText} (${pctText})` : absText;
  } else {
    // percent — when previous=0 the percent is undefined; fall back to em-dash
    // rather than fabricating Infinity% or showing the absolute (caller asked
    // for percent specifically).
    valueNode = pctText ?? '—';
    valueText = pctText ?? '—';
  }

  const composedValueLabel = comparedTo
    ? `${valueText} ${comparedTo}`
    : valueText;
  const wrapperAccessibilityLabel = accessibilityLabel ?? composedValueLabel;
  const wrapperAccessibilityHint = t(
    'delta.title',
    '{{current}} vs {{previous}}',
    {
      current: fmtNumber(current, precision ?? 2),
      previous: fmtNumber(previous, precision ?? 2),
    },
  );

  return (
    <View
      accessibilityHint={wrapperAccessibilityHint}
      accessibilityLabel={wrapperAccessibilityLabel}
      accessibilityRole="text"
      accessible
      style={[rowStyle, style]}
      testID={testID ?? dataTestID ?? 'delta'}>
      {!hideArrow ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.arrow, {color, fontSize}]}>
          {arrow}
        </AppText>
      ) : null}
      {typeof valueNode === 'string' ? (
        <AppText style={[styles.value, {color, fontSize}]}>{valueNode}</AppText>
      ) : (
        valueNode
      )}
      {comparedTo ? (
        <AppText
          style={[styles.comparedTo, {color: colors.textMuted, fontSize}]}>
          {comparedTo}
        </AppText>
      ) : null}
    </View>
  );
}

Delta.displayName = 'Delta';

const styles = StyleSheet.create({
  arrow: {
    fontWeight: '500',
  },
  both: {
    opacity: 0.7,
  },
  comparedTo: {
    fontWeight: '400',
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    width: 60,
  },
  statRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  value: {
    fontWeight: '500',
  },
});
