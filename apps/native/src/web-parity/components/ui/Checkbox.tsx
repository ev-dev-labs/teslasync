// Native parity port of web/src/components/ui/Checkbox.tsx.
//
// Accessible checkbox primitive supporting checked / unchecked / indeterminate
// (mixed) states plus an optional inline label and three visual sizes.
//
// The web version layers a visually-hidden native `<input type="checkbox">`
// (for keyboard, screen-reader, and form-association semantics) under a styled
// `<span>` indicator driven by Tailwind `peer-*` variants. React Native has no
// DOM `<input>`, `<label>`, `<span>`, the `peer-*` variant system, lucide SVGs,
// or the `@/lib/cn` class merge, so this port reproduces the same contract with
// a single accessible <Pressable>:
//   - role="checkbox" semantics come from accessibilityRole="checkbox".
//   - The input's checked / indeterminate state maps onto
//     accessibilityState={{checked: indeterminate ? 'mixed' : checked}},
//     which is a closer screen-reader contract than the web's imperative
//     `el.indeterminate = …` useEffect (so that effect is folded into render).
//   - disabled maps onto accessibilityState.disabled + the Pressable disabled
//     prop, and the web `peer-disabled:opacity-50` / outer `opacity-60` dimming
//     is reproduced by compounding container + box opacity.
//   - The lucide Check / Minus SVGs become centered text glyphs (U+2713 / U+2212)
//     that are transparent until the box is active, mirroring the web's
//     `text-transparent` default + `peer-checked/​indeterminate:text-cyan-300`.
//   - aria-hidden on the indicator -> the box/glyph are excluded from the
//     accessibility tree; the Pressable is the single focusable a11y node.
//
// Native-safe adaptations (documented in the sidecar):
//   - The DOM-only `...inputProps` passthrough (InputHTMLAttributes such as
//     name / value / id / aria-*) is dropped because there is no underlying
//     <input>; the meaningful pieces are surfaced as explicit native props
//     (accessibilityLabel, testID). The optional web `className` is
//     accepted-but-ignored for source compatibility and mirrored by a native
//     `style` override on the container.
//   - Controlled (`checked`) vs uncontrolled (`defaultChecked`) behavior is
//     preserved with internal state, matching the native <input> semantics.

import React, {forwardRef, useState, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

// Tailwind size tokens from the web `sizes` map resolved to dp:
//   box: h-3.5/h-4/h-5 -> 14/16/20; icon: h-2.5/h-3/h-3.5 -> 10/12/14.
const sizes = {
  sm: {box: 14, icon: 10},
  md: {box: 16, icon: 12},
  lg: {box: 20, icon: 14},
} as const;

export type CheckboxSize = keyof typeof sizes;

export interface CheckboxProps {
  /** Optional inline label rendered to the right of the box. */
  label?: ReactNode;
  /** Mixed-state checkbox (typically used by "select all" headers). */
  indeterminate?: boolean;
  /** Visual size of the box. Defaults to `md`. */
  size?: CheckboxSize;
  /** Standard React-style change handler reporting the new boolean. */
  onChange?: (checked: boolean) => void;
  /** Controlled checked state. */
  checked?: boolean;
  /** Uncontrolled initial checked state. */
  defaultChecked?: boolean;
  /** Disables interaction and dims the control. */
  disabled?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the row container. */
  style?: StyleProp<ViewStyle>;
  /** Accessible label; falls back to a string `label` when omitted. */
  accessibilityLabel?: string;
  testID?: string;
  'data-testid'?: string;
}

// lucide Check / Minus affordances rendered as centered text glyphs.
const CHECK_GLYPH = '\u2713'; // ✓
const MINUS_GLYPH = '\u2212'; // − (matches the indeterminate "select all" state)

// Literal resolutions of the web Tailwind / CSS-var palette so visual intent
// survives without Tailwind: cyan-500 border + cyan-500/20 fill, cyan-300 glyph,
// var(--border-strong) default border, bg-white/[0.04] default fill.
const ACTIVE_BORDER = '#06b6d4'; // border-cyan-500
const ACTIVE_FILL = 'rgba(6, 182, 212, 0.2)'; // bg-cyan-500/20
const ACTIVE_GLYPH = '#67e8f9'; // text-cyan-300
const IDLE_BORDER = 'rgba(255, 255, 255, 0.2)'; // var(--border-strong)
const IDLE_FILL = 'rgba(255, 255, 255, 0.04)'; // bg-white/[0.04]

/**
 * Accessible checkbox primitive.
 *
 * Mirrors the web shared `<Checkbox>` API (label / indeterminate / size /
 * onChange + controlled `checked` / uncontrolled `defaultChecked`) on a single
 * accessible <Pressable>. Feature screens should import this component instead
 * of building their own checkbox.
 */
export const Checkbox = forwardRef<View, CheckboxProps>(
  (
    {
      label,
      indeterminate = false,
      size = 'md',
      onChange,
      checked,
      defaultChecked,
      disabled = false,
      className: _className,
      style,
      accessibilityLabel,
      testID,
      'data-testid': dataTestID,
    },
    forwardedRef,
  ) => {
    const isControlled = checked !== undefined;
    const [internalChecked, setInternalChecked] = useState<boolean>(
      defaultChecked ?? false,
    );
    const currentChecked = isControlled ? Boolean(checked) : internalChecked;

    // The box adopts the cyan "active" treatment for both the checked and the
    // indeterminate states, matching peer-checked AND peer-indeterminate on web.
    const active = currentChecked || indeterminate;
    const dims = sizes[size];

    const handlePress = () => {
      if (disabled) {
        return;
      }
      const next = !currentChecked;
      if (!isControlled) {
        setInternalChecked(next);
      }
      onChange?.(next);
    };

    const labelIsText =
      typeof label === 'string' || typeof label === 'number';
    const resolvedAccessibilityLabel =
      accessibilityLabel ?? (typeof label === 'string' ? label : undefined);

    const indicator = (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.box,
          {
            width: dims.box,
            height: dims.box,
            borderColor: active ? ACTIVE_BORDER : IDLE_BORDER,
            backgroundColor: active ? ACTIVE_FILL : IDLE_FILL,
          },
          disabled && styles.boxDisabled,
        ]}>
        <Text
          accessible={false}
          allowFontScaling={false}
          style={[
            styles.glyph,
            {
              fontSize: dims.icon,
              lineHeight: dims.box,
              color: active ? ACTIVE_GLYPH : 'transparent',
            } as TextStyle,
          ]}>
          {indeterminate ? MINUS_GLYPH : CHECK_GLYPH}
        </Text>
      </View>
    );

    return (
      <Pressable
        ref={forwardedRef}
        accessibilityLabel={resolvedAccessibilityLabel}
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: indeterminate ? 'mixed' : currentChecked,
          disabled,
        }}
        disabled={disabled}
        hitSlop={8}
        onPress={handlePress}
        style={[styles.row, disabled && styles.rowDisabled, style]}
        testID={testID ?? dataTestID}>
        {indicator}
        {label != null &&
          (labelIsText ? (
            <AppText style={styles.label}>{label}</AppText>
          ) : (
            label
          ))}
      </Pressable>
    );
  },
);

Checkbox.displayName = 'Checkbox';

const styles = StyleSheet.create({
  // inline-flex items-center gap-2 select-none
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  // disabled && 'opacity-60'
  rowDisabled: {
    opacity: 0.6,
  },
  // inline-flex shrink-0 items-center justify-center rounded border
  box: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: 'center',
  },
  // peer-disabled:opacity-50 (compounds with rowDisabled like the web nesting)
  boxDisabled: {
    opacity: 0.5,
  },
  glyph: {
    fontWeight: '700',
    textAlign: 'center',
  },
  // text-sm text-[var(--text-primary)]
  label: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default Checkbox;
