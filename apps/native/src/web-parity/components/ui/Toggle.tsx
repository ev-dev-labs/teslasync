// Native parity port of web/src/components/ui/Toggle.tsx.
//
// `<Toggle>` is the shared switch primitive (WAI-ARIA `role="switch"`) with an
// optional inline label and two visual sizes (sm / md). It is fully controlled:
// the caller owns the boolean and `onChange(next)` reports the flipped value.
//
// The web version renders a neutral `<div>` wrapper around a real `<button
// role="switch" aria-checked>` whose Space/Enter natively toggle the value, a
// styled `<span>` thumb driven by Tailwind translate utilities, and an optional
// `<span>` label associated with the button via `aria-labelledby`. React Native
// has no DOM `<div>`/`<button>`/`<span>`, no Tailwind `peer-*`/`translate-x-*`
// utilities, no `:focus-visible` ring, no `forced-colors` high-contrast borders,
// and no `@/lib/cn` class merge, so this port reproduces the same contract with
// a single accessible <Pressable>:
//   - role="switch" semantics come from accessibilityRole="switch" and the
//     on/off state maps onto accessibilityState={{checked}} (the screen-reader
//     contract behind the web's aria-checked).
//   - The web's two interaction targets (clicking the label text via the wrapper
//     onClick, OR clicking the button itself) collapse into one Pressable, so a
//     tap anywhere on the row toggles — preserving "clicking the label toggles"
//     without the wrapper/button click-delegation dance (L48-53 / L61).
//   - The label, when supplied, becomes the Pressable's accessibilityLabel so a
//     screen reader announces both switch state and label (web aria-labelledby).
//   - The track is a rounded-full <View> whose tint flips cyan (on) / gray (off);
//     the thumb is a white rounded-full <View> shifted right by the size's
//     translate distance when checked (web translate-x-4/5 over the 3px inset).
//
// Native-safe adaptations (documented in the sidecar):
//   - Tailwind/CSS-var colors are resolved to literals for the app's dark theme:
//     the checked track uses dark:bg-cyan-600, the unchecked track dark:bg-gray-600,
//     and the label dark:text-[var(--text-secondary)]. Light-mode values
//     (cyan-500 / gray-300 / gray-700) are recorded in the sidecar.
//   - The web CSS `transition-colors` / `transition-transform` (duration-normal)
//     is visual-only; the native port flips position/tint instantly (no Animated
//     timers) to stay deterministic under --detectOpenHandles, mirroring the
//     sibling Checkbox port.
//   - The `focus-visible` ring and `forced-colors` (Windows High Contrast)
//     borders have no React Native analog and are intentionally dropped; native
//     focus is platform-driven.
//   - The DOM-only `...HTMLAttributes` passthrough is dropped (there is no
//     underlying <div>); the meaningful pieces are surfaced as explicit native
//     props (style, accessibilityLabel, testID, data-testid). The optional web
//     `className` is accepted-but-ignored for source compatibility and mirrored
//     by a native `style` override on the row container.

import React, {forwardRef} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

// Tailwind size tokens resolved to dp. trackSize sm h-5 w-9 -> 20x36,
// md h-6 w-11 -> 24x44; thumbSize sm h-3.5 -> 14, md h-5 -> 20; thumbTranslate
// sm translate-x-4 -> 16, md translate-x-5 -> 20.
const sizes = {
  sm: {trackW: 36, trackH: 20, thumb: 14, translate: 16},
  md: {trackW: 44, trackH: 24, thumb: 20, translate: 20},
} as const;

export type ToggleSize = keyof typeof sizes;

// The web thumb sits at translate-x-[3px] translate-y-[3px] inside the track,
// then shifts right by the size's translate distance when checked.
const THUMB_INSET = 3;

// Literal resolutions of the web Tailwind palette for the app's dark theme so
// the on/off visual intent survives without Tailwind:
//   checked  -> bg-cyan-500 dark:bg-cyan-600 -> #0891b2 (cyan-600)
//   unchecked-> bg-gray-300 dark:bg-gray-600 -> #4b5563 (gray-600)
//   thumb    -> bg-white                     -> #ffffff
const TRACK_ON = '#0891b2'; // dark:bg-cyan-600
const TRACK_OFF = '#4b5563'; // dark:bg-gray-600
const THUMB_COLOR = '#ffffff'; // bg-white

export interface ToggleProps {
  /** Optional inline label rendered to the right of the switch. */
  label?: string;
  /** Controlled on/off state. */
  checked: boolean;
  /** Reports the flipped boolean when the switch is toggled. */
  onChange: (checked: boolean) => void;
  /** Visual size of the track/thumb. Defaults to `md`. */
  size?: ToggleSize;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the row container (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  /** Accessible label; falls back to the string `label` when omitted. */
  accessibilityLabel?: string;
  testID?: string;
  'data-testid'?: string;
}

/**
 * Switch toggle (accessibilityRole="switch").
 *
 * Mirrors the web shared `<Toggle>` API (label / checked / onChange / size) on a
 * single accessible <Pressable>. Feature screens should import this component
 * instead of building their own switch.
 */
export const Toggle = forwardRef<View, ToggleProps>(
  (
    {
      label,
      checked,
      onChange,
      size = 'md',
      className: _className,
      style,
      accessibilityLabel,
      testID,
      'data-testid': dataTestID,
    },
    forwardedRef,
  ) => {
    const dims = sizes[size];

    const resolvedAccessibilityLabel = accessibilityLabel ?? label;

    const track = (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.track,
          {
            width: dims.trackW,
            height: dims.trackH,
            borderRadius: dims.trackH / 2,
            backgroundColor: checked ? TRACK_ON : TRACK_OFF,
          },
        ]}>
        <View
          style={[
            styles.thumb,
            {
              width: dims.thumb,
              height: dims.thumb,
              borderRadius: dims.thumb / 2,
              top: THUMB_INSET,
              left: THUMB_INSET + (checked ? dims.translate : 0),
            },
          ]}
        />
      </View>
    );

    return (
      <Pressable
        ref={forwardedRef}
        accessibilityLabel={resolvedAccessibilityLabel}
        accessibilityRole="switch"
        accessibilityState={{checked}}
        hitSlop={8}
        onPress={() => onChange(!checked)}
        style={[styles.row, style]}
        testID={testID ?? dataTestID}>
        {track}
        {label ? <AppText style={styles.label}>{label}</AppText> : null}
      </Pressable>
    );
  },
);

Toggle.displayName = 'Toggle';

const styles = StyleSheet.create({
  // inline-flex items-center gap-2 select-none
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  // relative inline-flex shrink-0 rounded-full transition-colors
  track: {
    flexShrink: 0,
    position: 'relative',
  },
  // pointer-events-none inline-block rounded-full bg-white shadow-sm
  thumb: {
    backgroundColor: THUMB_COLOR,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.18,
    shadowRadius: 1,
    elevation: 1,
  },
  // text-sm font-medium dark:text-[var(--text-secondary)]
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});

export default Toggle;
