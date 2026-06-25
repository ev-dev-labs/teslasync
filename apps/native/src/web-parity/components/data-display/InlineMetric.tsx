// Native parity port of web/src/components/data-display/InlineMetric.tsx.
// Converts the web inline <span> icon+value pair to React Native View/AppText
// primitives while preserving the compact, muted, caption-sized stat-row intent.
// The web CSS `[&>svg]:h-3 [&>svg]:w-3` rule sizes SVG icon children to 12px,
// which cannot target arbitrary children in React Native; the caller-supplied
// icon node is instead rendered inside a non-shrinking wrapper and is expected
// to be pre-sized (documented in the parity sidecar).

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {spacing} from '../../../theme/tokens';

export interface InlineMetricProps {
  /** Leading glyph; rendered in a non-shrinking wrapper and expected pre-sized. */
  icon: ReactNode;
  /** Primary value, string or number. */
  value: string | number;
  /** Optional trailing label/unit. */
  label?: string;
  /** Accepted for web source parity; React Native has no CSS class names. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

/** Compact icon+value pair used in stat rows within cards. */
export function InlineMetric({
  icon,
  value,
  label,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: InlineMetricProps) {
  const valueText = typeof value === 'number' ? String(value) : value;
  const derivedLabel =
    accessibilityLabel ?? (label ? `${valueText} ${label}` : valueText);

  return (
    <View
      accessible
      accessibilityLabel={derivedLabel}
      style={[styles.root, style]}
      testID={testID ?? dataTestID ?? 'inline-metric'}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.iconWrap}>
        {icon}
      </View>
      <AppText numberOfLines={1} tone="muted" variant="caption">
        {valueText}
      </AppText>
      {label ? (
        <AppText numberOfLines={1} tone="muted" variant="caption">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

InlineMetric.displayName = 'InlineMetric';

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
  },
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
