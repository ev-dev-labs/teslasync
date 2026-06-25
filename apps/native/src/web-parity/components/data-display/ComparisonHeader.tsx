// Native parity port of web/src/components/data-display/ComparisonHeader.tsx.
// Converts the DOM header and Delta chip to React Native primitives while
// preserving title, period labels, optional comparison text, actions, and
// direction-aware delta semantics.

import React, {type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

const MIDDLE_DOT = '\u00b7';
const ARROW_UP = '\u2191';
const ARROW_DOWN = '\u2193';
const ARROW_RIGHT = '\u2192';

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
  vampire_drain: {
    id: 'vampire_drain',
    direction: 'lower_better',
    unit: 'kwh',
  },
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

export interface DeltaProps {
  /** Either a registered metric id, a `MetricSemantic`, or an inline `{direction, unit?}`. */
  metric: MetricId | MetricSemantic | {direction: Direction; unit?: MetricUnit};
  /** Current period value, in the metric's display units (caller-converted). */
  current: number | null | undefined;
  /** Previous period value. `null`/`undefined` renders "-" with no colour. */
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
  className?: string;
  /** Override the default precision. */
  precision?: number;
}

export interface ComparisonHeaderProps {
  /** Section title, e.g. "Overview" or "Charging summary". */
  title: ReactNode;
  /**
   * Localised period descriptor -- what the current numbers represent
   * (e.g. "Last 30 days" or "Apr 13 - May 12").
   */
  currentLabel: string;
  /**
   * Localised label for the comparison period (e.g. "prior 30 days"
   * or "vs last week"). Pre-formatted by the caller so this component
   * stays free of date/i18n logic.
   */
  comparisonLabel?: string;
  /**
   * Optional headline delta indicator -- typically the most important
   * metric in the section. Renders to the right of the title row.
   */
  delta?: Omit<DeltaProps, 'comparedTo'>;
  /** Optional right-aligned actions (links, menus). */
  actions?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
  testID?: string;
  'data-testid'?: string;
}

export function ComparisonHeader({
  title,
  currentLabel,
  comparisonLabel,
  delta,
  actions,
  className: _className,
  style,
  testId,
  testID,
  'data-testid': dataTestID,
}: ComparisonHeaderProps) {
  const periodAccessibilityLabel = comparisonLabel
    ? `${currentLabel}, ${comparisonLabel}`
    : currentLabel;

  return (
    <View
      style={[styles.root, style]}
      testID={testId ?? testID ?? dataTestID ?? 'comparison-header'}>
      <View style={styles.copyColumn}>
        {renderTitle(title)}
        <View
          accessibilityLabel={periodAccessibilityLabel}
          accessible
          style={styles.periodRow}
          testID="comparison-header-period">
          <AppText
            numberOfLines={1}
            style={styles.periodText}
            variant="caption">
            {currentLabel}
          </AppText>
          {comparisonLabel ? (
            <>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.periodSeparator}
                variant="caption">
                {MIDDLE_DOT}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.periodText}
                variant="caption">
                {comparisonLabel}
              </AppText>
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.trailingRow}>
        {delta ? <Delta {...delta} size="sm" /> : null}
        {renderActionSlot(actions)}
      </View>
    </View>
  );
}

ComparisonHeader.displayName = 'ComparisonHeader';

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
  className: _className,
  precision,
}: DeltaProps) {
  const semantic = resolveSemantic(metric);
  const labels = unitLabelsFor(semantic.unit);
  const textSizeStyle = size === 'md' ? styles.deltaTextMd : styles.deltaTextSm;

  if (loading) {
    return (
      <View
        accessibilityLabel="Loading comparison delta"
        style={[styles.deltaSkeleton, size === 'md' && styles.deltaSkeletonMd]}
        testID="delta-skeleton"
      />
    );
  }

  if (
    current == null ||
    !Number.isFinite(current) ||
    previous == null ||
    !Number.isFinite(previous)
  ) {
    return (
      <View
        accessibilityLabel="No comparison data"
        style={[
          inline ? styles.deltaInlineRoot : styles.deltaBlockRoot,
          styles.deltaEmpty,
        ]}
        testID="delta-empty">
        <AppText style={[styles.deltaEmptyText, textSizeStyle]} variant="caption">
          -
        </AppText>
        {comparedTo ? (
          <AppText style={[styles.deltaComparedTo, textSizeStyle]} variant="caption">
            {comparedTo}
          </AppText>
        ) : null}
      </View>
    );
  }

  const signedDelta = current - previous;
  const signedPct =
    previous !== 0 ? (signedDelta / Math.abs(previous)) * 100 : null;
  const colorStyle = colorStyleForDelta(semantic.direction, signedDelta);
  const arrow =
    signedDelta > 0
      ? ARROW_UP
      : signedDelta < 0
        ? ARROW_DOWN
        : ARROW_RIGHT;
  const absDelta = Math.abs(signedDelta);
  const absPct = signedPct == null ? null : Math.abs(signedPct);
  const absText = formatAbsolute(absDelta, labels, precision);
  const pctText =
    absPct == null ? null : `${formatNumber(absPct, precision ?? 1)}%`;
  const valueParts = resolveDeltaValueParts(display, absText, pctText);
  const accessibilityLabel = `${formatNumber(
    current,
    precision ?? 2,
  )} vs ${formatNumber(previous, precision ?? 2)}`;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[inline ? styles.deltaInlineRoot : styles.deltaBlockRoot]}
      testID="delta">
      {!hideArrow ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.deltaArrow, textSizeStyle, colorStyle]}
          variant="caption"
          weight="semibold">
          {arrow}
        </AppText>
      ) : null}
      <AppText
        style={[styles.deltaValue, textSizeStyle, colorStyle]}
        variant="caption"
        weight="semibold">
        {valueParts.primary}
      </AppText>
      {valueParts.secondary ? (
        <AppText
          style={[styles.deltaSecondaryValue, textSizeStyle, colorStyle]}
          variant="caption"
          weight="semibold">
          {valueParts.secondary}
        </AppText>
      ) : null}
      {comparedTo ? (
        <AppText style={[styles.deltaComparedTo, textSizeStyle]} variant="caption">
          {comparedTo}
        </AppText>
      ) : null}
    </View>
  );
}

function resolveSemantic(
  metric: MetricId | MetricSemantic | {direction: Direction; unit?: MetricUnit},
): MetricSemantic {
  if (typeof metric === 'string') {
    return METRIC_SEMANTICS[metric] ?? {id: metric, direction: 'neutral'};
  }

  if ('id' in metric && typeof metric.id === 'string') {
    return metric;
  }

  return {id: 'inline', direction: metric.direction, unit: metric.unit};
}

interface ResolvedUnitLabels {
  prefix: string;
  suffix: string;
}

function unitLabelsFor(unit: MetricUnit | undefined): ResolvedUnitLabels {
  switch (unit) {
    case 'currency':
      return {prefix: '$', suffix: ''};
    case 'percent':
      return {prefix: '', suffix: '%'};
    case 'mi':
    case 'km':
      return {prefix: '', suffix: 'km'};
    case 'kwh':
      return {prefix: '', suffix: 'kWh'};
    case 'wh':
      return {prefix: '', suffix: 'Wh'};
    case 'wh_per_mi':
      return {prefix: '', suffix: 'Wh/km'};
    case 'h':
      return {prefix: '', suffix: 'h'};
    case 'min':
      return {prefix: '', suffix: 'min'};
    case 'mph':
    case 'kph':
      return {prefix: '', suffix: 'km/h'};
    case 'c':
    case 'f':
      return {prefix: '', suffix: '\u00b0C'};
    case 'bar':
      return {prefix: '', suffix: 'bar'};
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
  const num = formatNumber(value, precision);
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

function resolveDeltaValueParts(
  display: NonNullable<DeltaProps['display']>,
  absText: string,
  pctText: string | null,
): {primary: string; secondary?: string} {
  if (display === 'absolute') {
    return {primary: absText};
  }
  if (display === 'both') {
    return pctText ? {primary: absText, secondary: `(${pctText})`} : {primary: absText};
  }
  return {primary: pctText ?? '-'};
}

function colorStyleForDelta(direction: Direction, signedDelta: number): TextStyle {
  if (signedDelta === 0) {
    return styles.deltaMutedText;
  }
  if (direction === 'neutral') {
    return styles.deltaNeutralText;
  }

  const positiveOutcome =
    (direction === 'higher_better' && signedDelta > 0) ||
    (direction === 'lower_better' && signedDelta < 0);

  return positiveOutcome ? styles.deltaPositiveText : styles.deltaNegativeText;
}

function formatNumber(value: unknown, decimals = 2): string {
  const safeValue =
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));

  try {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(safeValue);
  } catch {
    return safeValue.toFixed(digits);
  }
}

function isTextLikeNode(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') {
    return true;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return true;
  }
  if (Array.isArray(node)) {
    return node.every(isTextLikeNode);
  }
  return false;
}

function renderTitle(title: ReactNode): ReactNode {
  if (title == null || typeof title === 'boolean') {
    return null;
  }

  if (isTextLikeNode(title)) {
    return (
      <AppText
        accessibilityRole="header"
        numberOfLines={2}
        style={styles.title}
        testID="comparison-header-title"
        variant="caption"
        weight="semibold">
        {title}
      </AppText>
    );
  }

  return (
    <View
      accessibilityRole="header"
      style={styles.titleSlot}
      testID="comparison-header-title">
      {title}
    </View>
  );
}

function renderActionSlot(actions: ReactNode): ReactNode {
  if (actions == null || typeof actions === 'boolean') {
    return null;
  }

  if (isTextLikeNode(actions)) {
    return (
      <AppText style={styles.actionText} variant="caption" weight="semibold">
        {actions}
      </AppText>
    );
  }

  return actions;
}

const styles = StyleSheet.create({
  actionText: {
    color: colors.textSecondary,
  },
  copyColumn: {
    flex: 1,
    minWidth: 0,
  },
  deltaArrow: {
    lineHeight: 18,
  },
  deltaBlockRoot: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  deltaComparedTo: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  deltaEmpty: {
    gap: spacing.xs,
  },
  deltaEmptyText: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  deltaInlineRoot: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  deltaMutedText: {
    color: colors.textMuted,
  },
  deltaNegativeText: {
    color: colors.danger,
  },
  deltaNeutralText: {
    color: colors.textSecondary,
  },
  deltaPositiveText: {
    color: colors.success,
  },
  deltaSecondaryValue: {
    opacity: 0.7,
  },
  deltaSkeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 14,
    width: 60,
  },
  deltaSkeletonMd: {
    height: 16,
  },
  deltaTextMd: {
    fontSize: typography.body,
    lineHeight: 20,
  },
  deltaTextSm: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  deltaValue: {
    lineHeight: 18,
  },
  periodRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
  },
  periodSeparator: {
    color: colors.textMuted,
    opacity: 0.6,
  },
  periodText: {
    color: colors.textMuted,
  },
  root: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  title: {
    color: colors.textPrimary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  titleSlot: {
    minWidth: 0,
  },
  trailingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
});
