// Native parity port of web/src/components/charts/ChartLegend.tsx.
// Recharts auto-generates legend payload entries on web; native chart shims
// must provide payload explicitly, otherwise the legend surfaces that gap.

import React, {useMemo} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {
  useChartHiddenSeries,
  type HiddenSeriesState,
} from './ChartHiddenSeriesContext';

/**
 * Recharts' Legend payload uses its `DataKey<any>` type (string | number |
 * function), but for our toggle UX we only care about the string/number forms
 * (function dataKeys are computed accessors and don't have a stable identity
 * for native in-memory persistence).
 */
export interface LegendPayloadEntry {
  value: string;
  type?: string;
  color?: string;
  dataKey?: unknown;
  payload?: {dataKey?: unknown};
}

function pickKey(entry: LegendPayloadEntry, fallback: string): string {
  const top = entry.dataKey;
  if (typeof top === 'string' || typeof top === 'number') {
    return String(top);
  }

  const inner = entry.payload?.dataKey;
  if (typeof inner === 'string' || typeof inner === 'number') {
    return String(inner);
  }

  return fallback;
}

/**
 * The minimum surface `<ChartLegend>` needs from a state container. Native
 * chart-key context and explicit state props both satisfy this, so the legend
 * works with either.
 */
export type ChartLegendToggleSource = Pick<
  HiddenSeriesState,
  'toggle' | 'isHidden'
>;

type LegendWrapperStyle = StyleProp<ViewStyle & TextStyle>;

export interface ChartLegendProps {
  /**
   * Optional toggle source. When omitted, the legend pulls state from the
   * surrounding `<ChartContainer chartKey="...">` via
   * {@link useChartHiddenSeries}. When neither a `state` prop nor a context
   * provider is present, the legend renders passively (no tap-to-hide UX, no
   * dimming).
   */
  state?: ChartLegendToggleSource;
  /** Recharts wrapper-style override (font size, margin, etc.). */
  wrapperStyle?: LegendWrapperStyle;
  /** Vertical alignment passed through to recharts on web and approximated in native. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Horizontal alignment passed through to recharts on web and approximated in native. */
  align?: 'left' | 'center' | 'right';
  /**
   * Native-only escape hatch for chart shims because React Native has no
   * Recharts parent that can inject legend payload entries automatically.
   */
  payload?: readonly LegendPayloadEntry[];
  testID?: string;
}

/**
 * React Native legend wrapper that toggles series visibility on press and
 * persists the hidden set via the supplied (or context-resolved) state.
 *
 * Hidden series render dimmed (40% opacity, line-through) so users can find
 * and re-enable them later.
 *
 * Note: this component does NOT hide the rendered series itself -- that's the
 * caller's responsibility via the native chart layer reading state.isHidden.
 */
export function ChartLegend({
  state,
  wrapperStyle,
  verticalAlign = 'bottom',
  align = 'center',
  payload,
  testID,
}: ChartLegendProps) {
  const contextState = useChartHiddenSeries();
  const resolved: ChartLegendToggleSource | null = state ?? contextState;
  const entries = useMemo(
    () => (Array.isArray(payload) ? payload.filter(hasLegendValue) : []),
    [payload],
  );
  const textStyle = useMemo(
    () => pickLegendTextStyle(wrapperStyle),
    [wrapperStyle],
  );

  if (entries.length === 0) {
    return (
      <View
        accessibilityRole="text"
        style={[
          styles.root,
          alignStyles[align],
          verticalAlignStyles[verticalAlign],
          wrapperStyle,
        ]}
        testID={testID ?? 'chart-legend'}>
        <AppText style={[styles.unavailableText, textStyle]} variant="caption">
          Legend unavailable in native chart parity until chart payload is
          provided.
        </AppText>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Chart legend"
      accessibilityRole="summary"
      style={[
        styles.root,
        alignStyles[align],
        verticalAlignStyles[verticalAlign],
        wrapperStyle,
      ]}
      testID={testID ?? 'chart-legend'}>
      {entries.map((entry, index) => {
        const value = entry.value;
        const key = pickKey(entry, value);
        const dimmed = resolved?.isHidden(key) ?? false;
        const label = String(value);
        const color = resolveLegendColor(entry.color, index);

        return (
          <Pressable
            key={`${key}-${index}`}
            accessibilityLabel={`${label} series`}
            accessibilityRole="button"
            accessibilityState={{checked: !dimmed, disabled: !resolved}}
            disabled={!resolved}
            onPress={() => {
              if (key) {
                resolved?.toggle(key);
              }
            }}
            style={({pressed}) => [
              styles.item,
              dimmed && styles.itemHidden,
              pressed && resolved && styles.itemPressed,
            ]}
            testID={`chart-legend-item-${key}`}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[styles.swatch, {backgroundColor: color}]}
            />
            <AppText
              numberOfLines={1}
              style={[
                styles.label,
                textStyle,
                dimmed && styles.labelHidden,
                resolved && styles.labelToggleable,
              ]}
              variant="caption">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

ChartLegend.displayName = 'ChartLegend';

function hasLegendValue(entry: LegendPayloadEntry): boolean {
  return typeof entry.value === 'string' && entry.value.length > 0;
}

function resolveLegendColor(color: string | undefined, index: number): string {
  if (!color || color.includes('var(') || color === 'currentColor') {
    return LEGEND_FALLBACK_COLORS[index % LEGEND_FALLBACK_COLORS.length];
  }
  return color;
}

function pickLegendTextStyle(
  wrapperStyle: LegendWrapperStyle | undefined,
): TextStyle | undefined {
  const flattened = StyleSheet.flatten(wrapperStyle);
  if (!flattened) {
    return undefined;
  }

  const textStyle: TextStyle = {};
  if (flattened.color != null) {
    textStyle.color = flattened.color;
  }
  if (flattened.fontFamily != null) {
    textStyle.fontFamily = flattened.fontFamily;
  }
  if (flattened.fontSize != null) {
    textStyle.fontSize = flattened.fontSize;
  }
  if (flattened.fontStyle != null) {
    textStyle.fontStyle = flattened.fontStyle;
  }
  if (flattened.fontWeight != null) {
    textStyle.fontWeight = flattened.fontWeight;
  }
  if (flattened.letterSpacing != null) {
    textStyle.letterSpacing = flattened.letterSpacing;
  }
  if (flattened.lineHeight != null) {
    textStyle.lineHeight = flattened.lineHeight;
  }

  return Object.keys(textStyle).length > 0 ? textStyle : undefined;
}

const LEGEND_FALLBACK_COLORS = [
  colors.accent,
  colors.violet,
  colors.success,
  colors.warning,
] as const;

const alignStyles = StyleSheet.create<
  Record<NonNullable<ChartLegendProps['align']>, ViewStyle>
>({
  center: {
    justifyContent: 'center',
  },
  left: {
    justifyContent: 'flex-start',
  },
  right: {
    justifyContent: 'flex-end',
  },
});

const verticalAlignStyles = StyleSheet.create<
  Record<NonNullable<ChartLegendProps['verticalAlign']>, ViewStyle>
>({
  bottom: {
    alignSelf: 'stretch',
  },
  middle: {
    alignSelf: 'center',
  },
  top: {
    alignSelf: 'stretch',
  },
});

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  itemHidden: {
    opacity: 0.4,
  },
  itemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  label: {
    color: colors.textSecondary,
    maxWidth: 144,
  },
  labelHidden: {
    textDecorationLine: 'line-through',
  },
  labelToggleable: {
    color: colors.textPrimary,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    width: '100%',
  },
  swatch: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  unavailableText: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
