// Native parity port of web/src/components/forms/DensityToggle.tsx.
//
// `DensityToggle` is the three-way Table / Compact / Comfortable list-density
// selector used by list pages. It is a controlled component — the caller owns
// the value (typically via a URL param so the preference survives a refresh).
//
// The web source pulls three browser/web-only modules with no native parity
// surface (rule 4/7), so a native-safe implementation is built:
//   - react-i18next `useTranslation` is absent from the native deps, so it
//     becomes a local fallback resolver returning the inline English string
//     (same approach as the SourceLayerBadge / InlineCallout ports). The i18n
//     keys (density.*) are still referenced so intent is preserved.
//   - lucide-react `Rows` / `Rows3` / `Table2` SVG icons have no native analog,
//     so each density renders a small, decorative View-drawn glyph that mirrors
//     the lucide silhouette: Table2 -> a 2x2 grid, Rows3 -> three dense bars,
//     Rows -> two roomy bars. They are flagged decorative (web `aria-hidden`).
//   - the `cn` Tailwind class merger has no native analog; `className` is kept
//     on props for source compatibility but ignored (destructured as
//     `_className`) and a `style` override is added for native consumers.
//
// Behavior preserved: the WAI-ARIA radiogroup is mapped to accessibilityRole
// "radiogroup" with "radio" children (aria-checked -> accessibilityState
// checked). The web ArrowLeft/ArrowRight keyboard cycling has no portable View
// key event on touch, so the identical wrap-around index logic is exposed
// through the native screen-reader `increment`/`decrement` adjustable actions
// (swipe up/down) — documented in the sidecar. Press-to-select (onClick ->
// onPress) is fully preserved. The web `hidden sm:inline` label is reproduced
// with useWindowDimensions against Tailwind's 640px `sm` breakpoint.
//
// The Tailwind tints / CSS theme vars map to native literals: the container
// border -> colors.border (--glass-border), --surface-1/40 -> a translucent
// dark fill, --surface-2 -> #151621, --text-primary -> colors.textPrimary,
// --text-secondary -> colors.textSecondary; the blue-500 focus ring collapses
// to the shared pressed-state opacity.

import React, {useCallback} from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export type Density = 'comfortable' | 'compact' | 'table';

export interface DensityToggleProps {
  value: Density;
  onChange: (next: Density) => void;
  /** Hide one or more options (e.g. some pages don't support 'table'). */
  options?: readonly Density[];
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Test hook. */
  testId?: string;
  /** Accessible name for the radio group. */
  ariaLabel?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_OPTIONS: readonly Density[] = ['table', 'compact', 'comfortable'];

/** Tailwind `sm:` breakpoint — below this the web hides the option label. */
const SM_BREAKPOINT = 640;

type TFunc = (key: string, fallback: string) => string;

// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

/**
 * `DensityToggle` — three-way Table / Compact / Comfortable selector
 * for list pages. Implements the WAI-ARIA radiogroup pattern: on native
 * the screen-reader increment/decrement (swipe) actions move + commit the
 * selection, mirroring the web arrow-key affordance.
 *
 * Controlled component — caller owns the value (typically via a URL
 * param so the user's preference survives a refresh).
 */
export function DensityToggle({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  className: _className,
  testId,
  ariaLabel,
  style,
}: DensityToggleProps) {
  const {t} = useTranslation();
  const {width} = useWindowDimensions();
  const showLabel = width >= SM_BREAKPOINT;

  const labelMap: Record<Density, string> = {
    table: t('density.table', 'Table'),
    compact: t('density.compact', 'Compact'),
    comfortable: t('density.comfortable', 'Comfortable'),
  };
  const groupLabel = ariaLabel ?? t('density.groupLabel', 'List density');

  // Native analog of the web ArrowLeft/ArrowRight handler: same wrap-around
  // index cycling, surfaced through the radiogroup's adjustable actions.
  const step = useCallback(
    (direction: 1 | -1) => {
      const idx = options.indexOf(value);
      if (idx < 0) {
        return;
      }
      const len = options.length;
      const next =
        direction === 1
          ? options[(idx + 1) % len]
          : options[(idx - 1 + len) % len];
      onChange(next);
    },
    [options, value, onChange],
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        step(1);
      } else if (event.nativeEvent.actionName === 'decrement') {
        step(-1);
      }
    },
    [step],
  );

  return (
    <View
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      accessibilityLabel={groupLabel}
      accessibilityRole="radiogroup"
      onAccessibilityAction={onAccessibilityAction}
      style={[styles.group, style]}
      testID={testId}>
      {options.map(opt => {
        const selected = opt === value;
        const tint = selected ? colors.textPrimary : colors.textSecondary;
        return (
          <Pressable
            accessibilityLabel={labelMap[opt]}
            accessibilityRole="radio"
            accessibilityState={{checked: selected, selected}}
            key={opt}
            onPress={() => onChange(opt)}
            style={({pressed}) => [
              styles.option,
              selected ? styles.optionSelected : styles.optionIdle,
              pressed && !selected && styles.optionPressed,
            ]}
            testID={testId ? `${testId}-${opt}` : undefined}>
            <DensityIcon color={tint} kind={opt} />
            {showLabel ? (
              <AppText
                style={[styles.optionLabel, {color: tint}]}
                variant="caption"
                weight="semibold">
                {labelMap[opt]}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

DensityToggle.displayName = 'DensityToggle';

const ACCESSIBILITY_ACTIONS = [
  {name: 'increment' as const},
  {name: 'decrement' as const},
];

// Decorative View-drawn stand-ins for the lucide-react glyphs. Each mirrors the
// silhouette of its source icon so the density intent reads at a glance.
function DensityIcon({color, kind}: {color: string; kind: Density}) {
  if (kind === 'table') {
    return (
      <View pointerEvents="none" style={styles.iconBox}>
        {[0, 1].map(row => (
          <View key={row} style={styles.iconGridRow}>
            <View style={[styles.gridCell, {backgroundColor: color}]} />
            <View style={[styles.gridCell, {backgroundColor: color}]} />
          </View>
        ))}
      </View>
    );
  }

  const bars = kind === 'compact' ? [0, 1, 2] : [0, 1];
  return (
    <View
      pointerEvents="none"
      style={[
        styles.iconBox,
        kind === 'compact' ? styles.iconBarsCompact : styles.iconBarsComfortable,
      ]}>
      {bars.map(bar => (
        <View
          key={bar}
          style={[
            styles.bar,
            kind === 'compact' ? styles.barCompact : styles.barComfortable,
            {backgroundColor: color},
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(14, 23, 39, 0.4)', // bg-[var(--surface-1)]/40
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2, // gap-0.5
    padding: 2, // p-0.5
  },
  option: {
    alignItems: 'center',
    borderRadius: 4, // rounded
    flexDirection: 'row',
    gap: 6, // gap-1.5
    paddingHorizontal: 8, // px-2
    paddingVertical: 4, // py-1
  },
  optionIdle: {
    backgroundColor: 'transparent',
  },
  optionPressed: {
    backgroundColor: 'rgba(21, 22, 33, 0.5)', // hover:bg-[var(--surface-2)]/50
  },
  optionSelected: {
    backgroundColor: '#151621', // bg-[var(--surface-2)]
  },
  optionLabel: {
    letterSpacing: 0.2,
  },
  iconBox: {
    height: 14, // h-3.5
    justifyContent: 'center',
    width: 14, // w-3.5
    gap: 2,
  },
  iconBarsCompact: {
    gap: 2,
  },
  iconBarsComfortable: {
    gap: 4,
  },
  iconGridRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
  },
  gridCell: {
    borderRadius: 1,
    flex: 1,
  },
  bar: {
    borderRadius: 1,
    width: '100%',
  },
  barCompact: {
    height: 2,
  },
  barComfortable: {
    height: 3,
  },
});
