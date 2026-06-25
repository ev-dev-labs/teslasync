// Native parity port of web/src/components/data-display/MetricCard.tsx.
//
// The web card is a Tailwind `<div>` stack: a metric-label eyebrow (with an
// optional "?" HelpTooltip), a large value, an optional subtitle, an optional
// legacy change pill, an optional direction-aware <Delta>, and an optional neon
// icon chip in the top-right. This native version reproduces the same slot
// contract (label / value / icon / color / change / delta / subtitle / help)
// using React Native primitives, the existing native AppText + design tokens.
//
// Two sibling web dependencies are not browser features but are not yet present
// as their own native parity ports: `<Delta>` (web/src/components/data-display/
// Delta.tsx) and `<HelpTooltip>` (web/src/components/ui/HelpTooltip.tsx). To keep
// this file self-contained and type-checkable, both are reproduced here as
// native-safe local components that preserve the public prop shapes and visual
// intent. Their browser-only and app-context pieces are reduced explicitly:
//   - HelpTooltip: web reveals a hover/focus/tap Tooltip; native has no hover, so
//     the resolved help text is exposed through accessibility (label + hint)
//     instead of a positioned popover. `placement`/`className` are inert.
//   - Delta: web resolves the metric registry + user unit/currency prefs via
//     useUnits()/useFormatting(); native echoes the metric's declared unit, uses
//     a default "$" currency symbol, and treats unknown string metric ids as
//     `neutral` (no registry ported). Direction colour, arrow, percent/absolute
//     formatting, comparedTo, loading and empty states are all preserved.
// These reductions are documented in the parity sidecar.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// ── Neon colour palette (ported from web/src/lib/tokens.ts neonColorMap) ──
// Web maps each NeonColor to Tailwind classes; the icon chip only consumes
// `bg` (neon/10), `ring` (neon/20 → native border) and `text` (toned 300 tint).
export type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue';

// Saturated neon base hues (tailwind.config.js theme.extend.colors.neon).
const NEON_BASE: Record<NeonColor, string> = {
  cyan: '#00f0ff',
  green: '#10b981',
  red: '#ef4444',
  purple: '#a855f7',
  amber: '#f59e0b',
  blue: '#4f46e5',
};

// Toned-down 300-level text tints used for the icon glyph (cyan-300, emerald-300,
// rose-300, purple-300, amber-300, indigo-300) — matches web neonColorMap.text.
const NEON_TEXT: Record<NeonColor, string> = {
  cyan: '#67e8f9',
  green: '#6ee7b7',
  red: '#fda4af',
  purple: '#d8b4fe',
  amber: '#fcd34d',
  blue: '#a5b4fc',
};

// Change-pill shades — web uses text-emerald-300 / text-rose-300.
const EMERALD_300 = '#6ee7b7';
const ROSE_300 = '#fda4af';

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface NeonChipStyle {
  bg: string;
  ring: string;
  text: string;
}

export const neonColorMap: Record<NeonColor, NeonChipStyle> = {
  cyan: {bg: withAlpha(NEON_BASE.cyan, 0.1), ring: withAlpha(NEON_BASE.cyan, 0.2), text: NEON_TEXT.cyan},
  green: {bg: withAlpha(NEON_BASE.green, 0.1), ring: withAlpha(NEON_BASE.green, 0.2), text: NEON_TEXT.green},
  red: {bg: withAlpha(NEON_BASE.red, 0.1), ring: withAlpha(NEON_BASE.red, 0.2), text: NEON_TEXT.red},
  purple: {bg: withAlpha(NEON_BASE.purple, 0.1), ring: withAlpha(NEON_BASE.purple, 0.2), text: NEON_TEXT.purple},
  amber: {bg: withAlpha(NEON_BASE.amber, 0.1), ring: withAlpha(NEON_BASE.amber, 0.2), text: NEON_TEXT.amber},
  blue: {bg: withAlpha(NEON_BASE.blue, 0.1), ring: withAlpha(NEON_BASE.blue, 0.2), text: NEON_TEXT.blue},
};

// ── HelpTooltip (native-safe port of web/src/components/ui/HelpTooltip.tsx) ──
export interface HelpTooltipProps {
  /** Plain text content (use `i18nKey` instead when localising). */
  text?: string;
  /** i18n key to translate. Pair with `defaultValue` for the English fallback. */
  i18nKey?: string;
  /** Fallback used when `i18nKey` is missing from the translation bundle. */
  defaultValue?: string;
  /** Tooltip placement relative to the trigger. Inert on native (no popover). */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional "Learn more" link. Surfaced through the accessibility hint. */
  learnMore?: {url: string; label?: string};
  /** Trigger icon size. */
  size?: 'xs' | 'sm' | 'md';
  /** Override the trigger glyph (defaults to a "?" eyebrow). */
  children?: ReactNode;
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Accessibility label for the trigger. Defaults to a "More info" string. */
  ariaLabel?: string;
}

const HELP_SIZE_PX: Record<NonNullable<HelpTooltipProps['size']>, number> = {
  xs: 12,
  sm: 14,
  md: 16,
};

function HelpTooltip({
  text,
  i18nKey,
  defaultValue,
  learnMore,
  size = 'sm',
  children,
  ariaLabel,
}: HelpTooltipProps) {
  // Mirror web resolution: i18nKey → defaultValue fallback, else plain text.
  const resolved = i18nKey ? defaultValue ?? '' : text ?? '';

  // Render nothing when no content is supplied — keeps consumers from having to
  // gate the tooltip themselves (matches web behaviour).
  if (!resolved) {
    return null;
  }

  const label = ariaLabel ?? 'More info';
  const learnMoreLabel = learnMore?.label ?? 'Learn more';
  const hint = learnMore ? `${resolved} ${learnMoreLabel}: ${learnMore.url}` : resolved;
  const glyphSize = HELP_SIZE_PX[size];

  return (
    <View
      accessible
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="image"
      style={styles.helpTrigger}
      testID="metric-card-help">
      {children ?? (
        <AppText style={[styles.helpGlyph, {fontSize: glyphSize}]} tone="muted">
          ?
        </AppText>
      )}
    </View>
  );
}

// ── Delta (native-safe port of web/src/components/data-display/Delta.tsx) ──
export type Direction = 'higher_better' | 'lower_better' | 'neutral';

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

type DeltaMetricInput = string | MetricSemantic | {direction: Direction; unit?: MetricUnit};

export interface DeltaProps {
  /** Either a registered metric id, a `MetricSemantic`, or an inline `{direction, unit?}`. */
  metric: DeltaMetricInput;
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
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Override the default precision (defaults to 1). */
  precision?: number;
}

interface ResolvedUnitLabels {
  prefix: string;
  suffix: string;
}

// Native registry is not ported, so unknown string ids resolve to `neutral`
// (web looks them up in METRIC_SEMANTICS). Inline/semantic objects pass through.
function resolveSemantic(metric: DeltaMetricInput): MetricSemantic {
  if (typeof metric === 'string') {
    return {id: metric, direction: 'neutral'};
  }
  if ('id' in metric && typeof metric.id === 'string') {
    return metric;
  }
  return {id: 'inline', direction: metric.direction, unit: metric.unit};
}

// Static suffix map. Web resolves distance/speed/temp/pressure suffixes and the
// currency symbol from user prefs (useUnits/useFormatting); native echoes the
// metric's declared unit and defaults the currency symbol to "$".
function unitLabels(unit: MetricUnit | undefined): ResolvedUnitLabels {
  switch (unit) {
    case 'currency':
      return {prefix: '$', suffix: ''};
    case 'percent':
      return {prefix: '', suffix: '%'};
    case 'mi':
    case 'km':
      return {prefix: '', suffix: unit};
    case 'kwh':
      return {prefix: '', suffix: 'kWh'};
    case 'wh':
      return {prefix: '', suffix: 'Wh'};
    case 'wh_per_mi':
      return {prefix: '', suffix: 'Wh/mi'};
    case 'h':
      return {prefix: '', suffix: 'h'};
    case 'min':
      return {prefix: '', suffix: 'min'};
    case 'mph':
    case 'kph':
      return {prefix: '', suffix: unit};
    case 'c':
      return {prefix: '', suffix: '°C'};
    case 'f':
      return {prefix: '', suffix: '°F'};
    case 'bar':
      return {prefix: '', suffix: 'bar'};
    case 'count':
    default:
      return {prefix: '', suffix: ''};
  }
}

function fmtNumber(value: number, decimals: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

function formatAbsolute(value: number, labels: ResolvedUnitLabels, precision: number): string {
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
  // colors.success === emerald-400, colors.danger === rose-400 (matches web).
  return positiveOutcome ? colors.success : colors.danger;
}

/**
 * `<Delta>` — direction-aware change indicator with a unified arrow and colour.
 * The arrow encodes the sign; the value is always rendered as a positive number.
 */
function Delta({
  metric,
  current,
  previous,
  display = 'percent',
  comparedTo,
  size = 'sm',
  inline = true,
  hideArrow = false,
  loading = false,
  precision,
}: DeltaProps) {
  const semantic = resolveSemantic(metric);
  const labels = unitLabels(semantic.unit);
  const valueFontSize = size === 'md' ? 14 : 12;
  const valueStyle: TextStyle = {fontSize: valueFontSize};

  if (loading) {
    return (
      <View
        accessibilityRole="progressbar"
        style={[styles.deltaSkeleton, {height: size === 'md' ? 16 : 14}]}
        testID="delta-skeleton"
      />
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
      <View style={inline ? styles.deltaRowInline : styles.deltaRow} testID="delta-empty">
        <AppText style={[valueStyle, styles.deltaMutedText]}>—</AppText>
        {comparedTo ? (
          <AppText style={[valueStyle, styles.deltaMutedText]}>{comparedTo}</AppText>
        ) : null}
      </View>
    );
  }

  const signedDelta = current - previous;
  const canPercent = previous !== 0;
  const signedPct = canPercent ? (signedDelta / Math.abs(previous)) * 100 : null;
  const color = colorForDelta(semantic.direction, signedDelta);

  let arrow: string;
  if (signedDelta > 0) {
    arrow = '\u2191';
  } else if (signedDelta < 0) {
    arrow = '\u2193';
  } else {
    arrow = '\u2192';
  }

  const absDelta = Math.abs(signedDelta);
  const absPct = signedPct == null ? null : Math.abs(signedPct);
  const absText = formatAbsolute(absDelta, labels, precision ?? 1);
  const pctText = absPct == null ? null : `${fmtNumber(absPct, precision ?? 1)}%`;

  let valueText: string;
  if (display === 'absolute') {
    valueText = absText;
  } else if (display === 'both') {
    valueText = pctText ? `${absText} (${pctText})` : absText;
  } else {
    // percent — when previous=0 the percent is undefined; fall back to em-dash.
    valueText = pctText ?? '—';
  }

  return (
    <View style={inline ? styles.deltaRowInline : styles.deltaRow} testID="delta">
      {!hideArrow ? (
        <AppText style={[valueStyle, styles.deltaValue, {color}]}>{arrow}</AppText>
      ) : null}
      <AppText style={[valueStyle, styles.deltaValue, {color}]}>{valueText}</AppText>
      {comparedTo ? (
        <AppText style={[valueStyle, styles.deltaComparedTo]}>{comparedTo}</AppText>
      ) : null}
    </View>
  );
}

/**
 * Slim wrapper around `<Delta>` for the `MetricCard` footer slot.
 * Drops the `current` prop because the card already knows its own value.
 */
type MetricCardDelta = Omit<DeltaProps, 'current'> & {
  /** Override the current value if it isn't a plain number on the card. */
  current?: number | null;
};

export interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  color?: NeonColor;
  /** Legacy ad-hoc change pill. Prefer `delta` for new call sites. */
  change?: {value: string; positive: boolean};
  /** Direction-aware delta. Drives the standardised `<Delta>` indicator. */
  delta?: MetricCardDelta;
  subtitle?: string;
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Native style override applied to the card root (web maps className here). */
  style?: StyleProp<ViewStyle>;
  /** Optional contextual help rendered as a "?" next to the label. */
  help?: HelpTooltipProps;
  /** Test hook. */
  testID?: string;
}

/** Compact metric display card with icon, value, label, and optional trend. */
export function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
  change,
  delta,
  subtitle,
  style,
  help,
  testID,
}: MetricCardProps) {
  const c = neonColorMap[color];
  const numericValue = typeof value === 'number' ? value : Number(value);
  const deltaCurrent = delta?.current ?? (Number.isFinite(numericValue) ? numericValue : null);

  return (
    <View style={[styles.card, style]} testID={testID ?? 'metric-card'}>
      <View style={styles.row}>
        <View style={styles.main}>
          <View style={styles.labelRow}>
            <AppText numberOfLines={1} style={styles.label}>
              {label}
            </AppText>
            {help ? (
              <HelpTooltip
                size="xs"
                {...help}
                ariaLabel={help.ariaLabel ?? `More info about ${label}`}
              />
            ) : null}
          </View>

          <AppText numberOfLines={1} style={styles.value}>
            {value}
          </AppText>

          {subtitle ? (
            <AppText numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </AppText>
          ) : null}

          {change && !delta ? (
            <AppText
              style={[styles.change, {color: change.positive ? EMERALD_300 : ROSE_300}]}>
              {change.positive ? '\u2191' : '\u2193'} {change.value}
            </AppText>
          ) : null}

          {delta ? (
            <View style={styles.deltaSlot}>
              <Delta {...delta} current={deltaCurrent} />
            </View>
          ) : null}
        </View>

        {icon ? (
          <View style={[styles.iconChip, {backgroundColor: c.bg, borderColor: c.ring}]}>
            {typeof icon === 'string' ? (
              <AppText style={[styles.iconGlyph, {color: c.text}]}>{icon}</AppText>
            ) : (
              icon
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  change: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  deltaComparedTo: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  deltaMutedText: {
    color: colors.textMuted,
  },
  deltaRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  deltaRowInline: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  deltaSkeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    width: 60,
  },
  deltaSlot: {
    marginTop: spacing.xs,
  },
  deltaValue: {
    fontWeight: '500',
  },
  helpGlyph: {
    lineHeight: 14,
  },
  helpTrigger: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: 'center',
    padding: 6,
  },
  iconGlyph: {
    fontSize: 16,
    lineHeight: 18,
  },
  label: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  labelRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    alignItems: 'flex-start',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  value: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
