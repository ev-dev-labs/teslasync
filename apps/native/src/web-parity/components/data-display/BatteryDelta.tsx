// Native parity port of web/src/components/data-display/BatteryDelta.tsx.
// Replaces lucide/Tailwind/DOM spans with React Native primitives while
// preserving labels, tone rules, compact/pair variants, and test hooks.

import React, {useCallback} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

type TranslationOptions = {
  defaultValue?: string;
  from?: number;
  to?: number;
};

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | TranslationOptions,
  options?: TranslationOptions,
) => string;

export interface BatteryDeltaProps {
  /** Starting state-of-charge percentage (0-100). */
  startPct: number | null | undefined;
  /** Ending state-of-charge percentage (0-100). */
  endPct: number | null | undefined;
  /** When true, render the battery icon to the left. Default `true`. */
  showIcon?: boolean;
  /**
   * Display variant:
   *   - `'compact'` (default): just the delta -- "-1%", "+12%", "-"
   *   - `'pair'`: "79% -> 78%" (legacy charging-card style)
   */
  variant?: 'compact' | 'pair';
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
  /** Native/Test Library alias. */
  testID?: string;
  /** DOM data-testid alias accepted by some parity callers. */
  'data-testid'?: string;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallbackOrOptions, options) => {
    const fallback =
      typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : fallbackOrOptions?.defaultValue ?? _key;

    const interpolationValues =
      options ?? (typeof fallbackOrOptions === 'string' ? undefined : fallbackOrOptions);

    if (!interpolationValues) {
      return fallback;
    }

    return interpolate(fallback, interpolationValues);
  }, []);
}

function interpolate(template: string, values: TranslationOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key as keyof TranslationOptions];
    return value === undefined ? '' : String(value);
  });
}

/**
 * `BatteryDelta` -- compact battery state-of-charge change.
 *
 * Examples (compact):
 *   start=79 end=78  -> "-1%"  amber
 *   start=20 end=80  -> "+60%" emerald
 *   start=80 end=80  -> "-"    muted
 *   start=null       -> "-"    muted
 *
 * The colour rules match the existing in-app convention:
 *   - drop in SoC during driving is normal, rendered amber
 *   - rise in SoC (charging) is rendered emerald
 *   - zero or missing renders muted
 *
 * Used by both Drives and Charging cards.
 */
export function BatteryDelta({
  startPct,
  endPct,
  showIcon = true,
  variant = 'compact',
  className: _className,
  style,
  testId,
  testID,
  'data-testid': dataTestID,
}: BatteryDeltaProps) {
  const t = useNativeTranslationFallback();
  const hasData =
    startPct != null &&
    endPct != null &&
    Number.isFinite(startPct) &&
    Number.isFinite(endPct);

  const dash = '—';
  const resolvedTestID = testID ?? dataTestID ?? testId;

  if (!hasData) {
    return (
      <View
        accessible
        accessibilityLabel={t(
          'battery.delta.unknown',
          'Battery delta unknown',
        )}
        accessibilityRole="text"
        style={[styles.root, style]}
        testID={resolvedTestID}>
        {showIcon ? <BatteryGlyph color={colors.textMuted} /> : null}
        <AppText style={styles.mutedText} variant="caption" weight="semibold">
          {dash}
        </AppText>
      </View>
    );
  }

  const delta = endPct - startPct;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const magnitude = Math.abs(delta);
  const toneStyle =
    delta > 0
      ? styles.positiveText
      : delta < 0
        ? styles.negativeText
        : styles.mutedText;

  const compactLabel = delta === 0 ? dash : `${sign}${magnitude}%`;
  const pairLabel = `${startPct}% → ${endPct}%`;
  const visible = variant === 'pair' ? pairLabel : compactLabel;
  const a11y = t('battery.delta.aria', 'Battery {{from}}% to {{to}}%', {
    from: startPct,
    to: endPct,
  });

  return (
    <View
      accessible
      accessibilityLabel={a11y}
      accessibilityRole="text"
      style={[styles.root, style]}
      testID={resolvedTestID}>
      {showIcon ? <BatteryGlyph color={colors.textSecondary} /> : null}
      <AppText
        style={[styles.valueText, toneStyle]}
        variant="caption"
        weight="semibold">
        {visible}
      </AppText>
    </View>
  );
}

function BatteryGlyph({color}: {color: string}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.iconRoot}
      testID="battery-delta-icon">
      <View style={[styles.iconBody, {borderColor: color}]}>
        <View style={[styles.iconFill, {backgroundColor: color}]} />
      </View>
      <View style={[styles.iconTerminal, {backgroundColor: color}]} />
    </View>
  );
}

BatteryDelta.displayName = 'BatteryDelta';

const styles = StyleSheet.create({
  iconBody: {
    borderRadius: 2,
    borderWidth: 1.4,
    height: 9,
    justifyContent: 'center',
    padding: 1.5,
    width: 15,
  },
  iconFill: {
    borderRadius: 1,
    flex: 1,
    opacity: 0.82,
  },
  iconRoot: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 14,
    justifyContent: 'center',
    width: 19,
  },
  iconTerminal: {
    borderRadius: 1,
    height: 5,
    marginLeft: 1,
    width: 2,
  },
  mutedText: {
    color: colors.textMuted,
  },
  negativeText: {
    color: colors.warning,
  },
  positiveText: {
    color: colors.success,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
  },
  valueText: {
    fontSize: typography.caption,
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
  },
});
