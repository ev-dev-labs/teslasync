// Native parity port of web/src/components/forms/PillFilterBar.tsx.
//
// PillFilterBar — accessible single-select filter row used for trend metric
// switchers, list-page collections (All / Anomalies / Notable / …), and similar
// "pick one" surfaces. Two render styles: `pills` (rounded chips with an active
// fill + leading dot) and `tabs` (flat row with a bottom-border underline). The
// component does not own panels; consumers render content for the active key.
//
// Web -> native mapping notes:
//   - The web `<div role="tablist">` row of `<button role="tab">` becomes a
//     React Native View (accessibilityRole="tablist") of Pressable tabs
//     (accessibilityRole="tab"), mirroring the inline PillFilterBar already
//     proven in the charts/MetricSwitcherChart parity port.
//   - The WAI-ARIA roving-tabindex keyboard model (useId tab ids, the refs Map,
//     enabledKeys/moveFocus, the ArrowLeft/ArrowRight/Home/End handleKeyDown and
//     requestAnimationFrame focus restore) is DOM/keyboard-only and has no touch
//     analogue, so it is intentionally omitted. The single-select semantics it
//     drove are preserved: press selects (onChange), `aria-selected`/`tabIndex`
//     map to each tab's accessibilityState `selected`, and `disabled` maps to
//     accessibilityState `disabled` + the Pressable `disabled` prop.
//   - Tailwind class tokens (cyan/emerald/amber/rose/purple/indigo 300/400/500
//     shades) are resolved to the native theme tokens used across the parity
//     tree, so the active fill, ring/border, leading dot, and selected-text
//     accent keep their visual intent without any web CSS.
//   - `scrollable` (default true) wraps the row in a horizontal ScrollView, the
//     native analogue of the web `overflow-x-auto` overflow affordance.
//   - The web `className` pass-through becomes a `style` (StyleProp<ViewStyle>)
//     on the tablist row and `testId` becomes `testID`, matching the
//     DatePresetChips / PlaybackControls parity convention.
//   - `icon?: ReactNode` is preserved verbatim; native consumers pass an RN node
//     (the web `[&>svg]` sizing is a CSS-only hook with no native equivalent, so
//     icon sizing is the caller's responsibility). Decorative dot + icon are
//     hidden from assistive tech, matching the web `aria-hidden`.
//   - `count` is rendered as the same muted `(n)` suffix via an inlined fmtInt
//     that faithfully reproduces web lib/numberFormat (locale separators, 0
//     decimals, nullish/NaN coerced to 0; web's global locale defaults to en-US).

import React, {type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

/**
 * Single pill descriptor for {@link PillFilterBar}.
 */
export interface PillItem {
  /** Stable identifier — written to URL state and used for `onChange`. */
  key: string;
  /** Visible label. */
  label: string;
  /** Optional left-aligned icon (native node). */
  icon?: ReactNode;
  /** Optional count rendered as a muted suffix, e.g. `(12)`. */
  count?: number;
  /**
   * Optional accent colour used by the dot/active border. Falls back to
   * cyan to match the rest of the app's neon palette.
   */
  accent?: 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';
  /** Disabled pills are skipped during selection. */
  disabled?: boolean;
}

export interface PillFilterBarProps {
  items: readonly PillItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Localised label announced to assistive tech. */
  ariaLabel: string;
  /**
   * Render style:
   *   - `pills` (default) — rounded chips with active fill
   *   - `tabs`            — flat row with bottom-border underline
   */
  variant?: 'pills' | 'tabs';
  /** Allow horizontal scroll on overflow (mobile). Default `true`. */
  scrollable?: boolean;
  /** Pass-through style for the outer tablist row (replaces the web className). */
  style?: StyleProp<ViewStyle>;
  /** Test hook for the outer tablist row. */
  testID?: string;
}

type PillAccent = NonNullable<PillItem['accent']>;

/**
 * Inlined faithful port of web `lib/numberFormat` fmtInt: locale separators, 0
 * decimals, nullish/NaN coerced to 0 (web safeNumber). Web's global locale
 * defaults to 'en-US', which is reproduced here.
 */
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(n));
  }
}

/**
 * `PillFilterBar` — accessible single-select filter row. Implements the
 * tablist/tab semantics of the web component (press selects, single selection,
 * disabled skipped) without the DOM-only roving-tabindex keyboard navigation,
 * which has no touch-native analogue.
 */
export function PillFilterBar({
  items,
  activeKey,
  onChange,
  ariaLabel,
  variant = 'pills',
  scrollable = true,
  style,
  testID,
}: PillFilterBarProps) {
  const isTabs = variant === 'tabs';

  const content = (
    <View
      accessibilityLabel={ariaLabel}
      accessibilityRole="tablist"
      style={[styles.row, isTabs && styles.rowTabs, style]}
      testID={testID}>
      {items.map((item) => {
        const selected = activeKey === item.key;
        const accent: PillAccent = item.accent ?? 'cyan';

        return (
          <Pressable
            key={item.key}
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{disabled: item.disabled, selected}}
            disabled={item.disabled}
            onPress={() => onChange(item.key)}
            style={({pressed}) => [
              isTabs ? styles.tab : styles.pill,
              selected &&
                (isTabs
                  ? [styles.tabSelected, tabBorderStyles[accent]]
                  : pillAccentStyles[accent]),
              item.disabled && styles.disabled,
              pressed && !item.disabled && styles.pressed,
            ]}
            testID={`pill-filter-${item.key}`}>
            {!isTabs && selected ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={[styles.pillDot, pillDotStyles[accent]]}
              />
            ) : null}
            {item.icon ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.icon}>
                {item.icon}
              </View>
            ) : null}
            <AppText
              numberOfLines={1}
              style={[
                isTabs ? styles.tabLabel : styles.pillLabel,
                selected && pillTextStyles[accent],
              ]}
              variant="caption"
              weight="semibold">
              {item.label}
            </AppText>
            {typeof item.count === 'number' ? (
              <AppText
                numberOfLines={1}
                style={[
                  styles.count,
                  selected ? styles.countSelected : styles.countIdle,
                  selected && pillTextStyles[accent],
                ]}
                variant="caption">
                ({fmtInt(item.count)})
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) {
    return content;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  rowTabs: {
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  tab: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabSelected: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.78,
  },
  pillDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: {
    color: colors.textMuted,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 18,
  },
  count: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
    marginLeft: 2,
  },
  countSelected: {
    opacity: 0.8,
  },
  countIdle: {
    opacity: 0.6,
  },
});

const pillAccentStyles = StyleSheet.create<Record<PillAccent, ViewStyle>>({
  amber: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  blue: {
    backgroundColor: 'rgba(99, 102, 241, 0.16)',
    borderColor: 'rgba(129, 140, 248, 0.4)',
  },
  cyan: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  green: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  purple: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
  },
  red: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
});

const pillDotStyles = StyleSheet.create<Record<PillAccent, ViewStyle>>({
  amber: {
    backgroundColor: colors.warning,
  },
  blue: {
    backgroundColor: '#818cf8',
  },
  cyan: {
    backgroundColor: colors.accent,
  },
  green: {
    backgroundColor: colors.success,
  },
  purple: {
    backgroundColor: colors.violet,
  },
  red: {
    backgroundColor: colors.danger,
  },
});

const pillTextStyles = StyleSheet.create<Record<PillAccent, TextStyle>>({
  amber: {
    color: colors.warning,
  },
  blue: {
    color: '#818cf8',
  },
  cyan: {
    color: colors.accent,
  },
  green: {
    color: colors.success,
  },
  purple: {
    color: colors.violet,
  },
  red: {
    color: colors.danger,
  },
});

const tabBorderStyles = StyleSheet.create<Record<PillAccent, ViewStyle>>({
  amber: {
    borderBottomColor: colors.warning,
  },
  blue: {
    borderBottomColor: '#818cf8',
  },
  cyan: {
    borderBottomColor: colors.accent,
  },
  green: {
    borderBottomColor: colors.success,
  },
  purple: {
    borderBottomColor: colors.violet,
  },
  red: {
    borderBottomColor: colors.danger,
  },
});

export default PillFilterBar;
