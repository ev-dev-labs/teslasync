// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx.
//
// The web card lists comparison metrics: each row shows a label, the formatted
// current value (with an optional unit suffix), and a `<Delta>` change chip on
// the right. The web `<Delta>` (lucide-react ArrowUp/ArrowDown/ArrowRight icons
// + the useUnits/useFormatting/metricSemantics hooks + i18n + Skeleton) is
// browser-only and not available in native parity, so its `display="percent"`,
// `size="sm"` behaviour is inlined here as a native-safe `MetricDelta` (a
// directional glyph + locale-formatted percent) using React Native primitives,
// AppText, and theme tokens. The `cn`/Tailwind/DOM `<div>`/`<span>` stack is
// replaced with View/AppText + StyleSheet. See the parity sidecar for the
// line-by-line coverage map.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

/** Direction the comparison metric "improves" in. */
type MetricDirection = 'higher_better' | 'lower_better';

export interface ComparisonMetric {
  label: string;
  current: number;
  previous: number;
  formattedCurrent: string;
  unit?: string;
  higherIsBetter?: boolean;
}

interface WidgetComparisonCardProps {
  metrics: ComparisonMetric[];
  /** When true, only the first two metrics are shown (mirrors the web tile). */
  compact?: boolean;
}

const ROW_BORDER_COLOR = 'rgba(255, 255, 255, 0.06)';
const EM_DASH = '\u2014';
const THIN_SPACE = '\u2009';

/** Single comparison row: label + current value (+ unit) on the left, delta on the right. */
function MetricRow({metric, isLast}: {metric: ComparisonMetric; isLast: boolean}) {
  const higherIsBetter = metric.higherIsBetter ?? true;
  const direction: MetricDirection = higherIsBetter
    ? 'higher_better'
    : 'lower_better';

  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <View style={styles.metricInfo}>
        <AppText numberOfLines={1} tone="muted" variant="caption">
          {metric.label}
        </AppText>
        <AppText numberOfLines={1} style={styles.value} weight="semibold">
          {metric.formattedCurrent}
          {metric.unit ? (
            <AppText style={styles.unit} tone="muted">
              {`${THIN_SPACE}${metric.unit}`}
            </AppText>
          ) : null}
        </AppText>
      </View>
      <MetricDelta
        current={metric.current}
        direction={direction}
        previous={metric.previous}
      />
    </View>
  );
}

/**
 * Native-safe inline of the web `<Delta display="percent" size="sm">`.
 *
 *   - `previous`/`current` non-finite      -> em-dash, muted, no arrow.
 *   - `previous === 0`                      -> percent undefined -> em-dash.
 *   - `delta === 0`                         -> "->" glyph + muted colour.
 *   - colour follows the metric direction (emerald = good outcome, rose = bad).
 *
 * The arrow encodes the sign; the percent is always rendered as a positive
 * magnitude ("v 5%" never "^ -5%").
 */
function MetricDelta({
  current,
  previous,
  direction,
}: {
  current: number;
  previous: number;
  direction: MetricDirection;
}) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return (
      <View style={styles.delta}>
        <AppText
          accessibilityLabel="No comparison data"
          style={styles.deltaText}
          tone="muted">
          {EM_DASH}
        </AppText>
      </View>
    );
  }

  const signedDelta = current - previous;
  const signedPct = previous !== 0 ? (signedDelta / Math.abs(previous)) * 100 : null;
  const pctText =
    signedPct == null ? null : `${formatDecimal(Math.abs(signedPct), 1)}%`;
  const valueText = pctText ?? EM_DASH;
  const color = deltaColor(direction, signedDelta);
  const arrow =
    signedDelta > 0 ? '\u2191' : signedDelta < 0 ? '\u2193' : '\u2192';

  return (
    <View
      accessibilityLabel={`${formatDecimal(current, 2)} vs ${formatDecimal(
        previous,
        2,
      )}`}
      style={styles.delta}>
      <AppText style={[styles.deltaText, {color}]}>{arrow}</AppText>
      <AppText style={[styles.deltaText, {color}]}>{valueText}</AppText>
    </View>
  );
}

export function WidgetComparisonCard({
  metrics,
  compact,
}: WidgetComparisonCardProps) {
  const visible = compact ? metrics.slice(0, 2) : metrics;

  if (visible.length === 0) {
    return (
      <AppText style={styles.empty} tone="muted">
        No comparison data
      </AppText>
    );
  }

  return (
    <View style={styles.container}>
      {visible.map((m, index) => (
        <MetricRow
          isLast={index === visible.length - 1}
          key={m.label}
          metric={m}
        />
      ))}
    </View>
  );
}

WidgetComparisonCard.displayName = 'WidgetComparisonCard';

/** Mirrors the web `colorForDelta` for the two directions this card can pass. */
function deltaColor(direction: MetricDirection, signedDelta: number): string {
  if (signedDelta === 0) {
    return colors.textMuted;
  }
  const positiveOutcome =
    (direction === 'higher_better' && signedDelta > 0) ||
    (direction === 'lower_better' && signedDelta < 0);
  return positiveOutcome ? colors.success : colors.danger;
}

/** Locale-aware fixed-precision formatter (native analogue of `fmtNumber`). */
function formatDecimal(value: number, fractionDigits: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
  },
  delta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
  },
  deltaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  empty: {
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  metricInfo: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: ROW_BORDER_COLOR,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  unit: {
    fontSize: 12,
    fontWeight: '400',
  },
  value: {
    color: colors.textPrimary,
    fontSize: 16,
  },
});
