// Native parity port of web/src/components/ui/Button.tsx.
//
// The web `Button` is a `forwardRef` DOM <button> styled with Tailwind variant
// (primary|secondary|outline|danger|ghost) and size (sm|md|lg|auto) class maps,
// merging caller `className` last via cn(), with a `loading` spinner (inline
// SVG) that also disables the control and sets `aria-busy`, plus an optional
// leading `icon` slot. It is reproduced here with React Native primitives:
//
//   - The DOM <button> becomes a `Pressable` (RN's accessible button); the web
//     `forwardRef<HTMLButtonElement>` becomes `forwardRef<View>` (Pressable's
//     host ref is a View) so callers can still attach a ref.
//   - `ButtonHTMLAttributes<HTMLButtonElement>` becomes `PressableProps` (minus
//     the re-typed style/children/disabled), so `onPress`, `testID`,
//     accessibility props, hitSlop, etc. still flow through via `...props`. The
//     web DOM `onClick` is expressed by RN callers as `onPress`.
//   - Tailwind variant/size class maps become StyleSheet record maps. The exact
//     Tailwind color intent is preserved as literal hex (blue-600/700 primary,
//     red-600/700 danger, gray-700/600 secondary, gray-600 outline border,
//     gray-800 ghost hover) — the same "keep the web's explicit color" approach
//     the ProgressRing port took with #3b82f6. Dark-mode (`dark:`) classes are
//     honored since the native app renders on the dark token background.
//   - `hover:` backgrounds have no native analog, so they become the Pressable
//     `pressed` state. The `focus-visible:ring*` classes are browser focus
//     affordances with no RN equivalent and are dropped.
//   - The inline SVG spinner becomes a native `ActivityIndicator` tinted with
//     the variant's text color; it occupies the same leading slot as `icon`
//     ({loading ? spinner : icon}) and, like the web, also disables the button.
//   - `disabled:opacity-50` -> a 0.5-opacity style; `disabled:pointer-events-none`
//     is implicit in Pressable's `disabled`. `aria-busy` -> accessibilityState
//     `busy`; `disabled` -> accessibilityState `disabled` + the disabled prop.
//   - The web `className` styling channel is retained on props for source
//     compatibility (ignored on native) and replaced by a native `style` prop
//     merged LAST so caller styles win — the precedence cn() gives its trailing
//     className argument. String/number children are wrapped in AppText so the
//     variant text color + size text scale + font-medium weight apply; element
//     children (e.g. a custom node) are rendered as-is.

import React, {forwardRef, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'danger'
  | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'auto';

export interface ButtonProps
  extends Omit<PressableProps, 'style' | 'children' | 'disabled'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Native replacement for the web `className`; merged last so callers win. */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  disabled?: boolean;
}

// Literal Tailwind palette the variant classes reference, preserved as hex so
// the web's explicit color intent carries over verbatim on native.
const PALETTE = {
  blue600: '#2563eb',
  blue700: '#1d4ed8',
  red600: '#dc2626',
  red700: '#b91c1c',
  gray700: '#374151',
  gray600: '#4b5563',
  gray800: '#1f2937',
  gray100: '#f3f4f6',
  white: '#ffffff',
} as const;

// Per-variant text color, shared by the AppText label and the spinner tint.
const TEXT_COLOR: Record<ButtonVariant, string> = {
  primary: PALETTE.white,
  secondary: PALETTE.gray100,
  outline: colors.textPrimary,
  danger: PALETTE.white,
  ghost: colors.textPrimary,
};

export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    icon,
    className: _className,
    style,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  const labelStyle: StyleProp<TextStyle> = [
    styles.label,
    sizeTextStyles[size],
    textColorStyles[variant],
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{busy: Boolean(loading), disabled: isDisabled}}
      disabled={isDisabled}
      ref={ref}
      style={({pressed}) => [
        styles.base,
        containerStyles[variant],
        sizeContainerStyles[size],
        pressed && !isDisabled ? pressedStyles[variant] : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...props}>
      {loading ? (
        <ActivityIndicator color={TEXT_COLOR[variant]} size="small" />
      ) : (
        icon
      )}
      {typeof children === 'string' || typeof children === 'number' ? (
        <AppText style={labelStyle}>{children}</AppText>
      ) : (
        children
      )}
    </Pressable>
  );
});

Button.displayName = 'Button';

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '500',
  },
});

const containerStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: PALETTE.blue600,
  },
  secondary: {
    backgroundColor: PALETTE.gray700,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: PALETTE.gray600,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: PALETTE.red600,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

// hover:* backgrounds -> the Pressable `pressed` state.
const pressedStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: PALETTE.blue700,
  },
  secondary: {
    backgroundColor: PALETTE.gray600,
  },
  outline: {
    backgroundColor: colors.surfaceRaised,
  },
  danger: {
    backgroundColor: PALETTE.red700,
  },
  ghost: {
    backgroundColor: PALETTE.gray800,
  },
});

const textColorStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {
    color: TEXT_COLOR.primary,
  },
  secondary: {
    color: TEXT_COLOR.secondary,
  },
  outline: {
    color: TEXT_COLOR.outline,
  },
  danger: {
    color: TEXT_COLOR.danger,
  },
  ghost: {
    color: TEXT_COLOR.ghost,
  },
});

// h-* -> fixed height; px-* -> paddingHorizontal. `auto` follows the web's
// density-aware sizing, mapped to a touch-friendly 44px minimum target.
const sizeContainerStyles = StyleSheet.create<Record<ButtonSize, ViewStyle>>({
  sm: {
    height: 32,
    paddingHorizontal: 12,
  },
  md: {
    height: 40,
    paddingHorizontal: 16,
  },
  lg: {
    height: 48,
    paddingHorizontal: 24,
  },
  auto: {
    minHeight: 44,
    paddingHorizontal: 16,
  },
});

const sizeTextStyles = StyleSheet.create<Record<ButtonSize, TextStyle>>({
  sm: {
    fontSize: 12,
  },
  md: {
    fontSize: 14,
  },
  lg: {
    fontSize: 16,
  },
  auto: {
    fontSize: 15,
  },
});
