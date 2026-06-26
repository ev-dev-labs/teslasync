// Native parity port of web/src/components/ui/Badge.tsx.
//
// `Badge` is a small inline status chip: a coloured pill with a text label and
// an optional leading dot. The web source pulls one module with no native
// parity surface — the `cn` Tailwind class merger (L2) — and renders a DOM
// `<span>` (L29) with `forwardRef<HTMLSpanElement>` (L27). Native-safe mapping
// (rules 4/5/7):
//   - `cn` only merged Tailwind class strings; React Native has no className, so
//     the class-driven variant/size/base styling moves to StyleSheet + inline
//     colour literals. `className` is retained on props for source
//     compatibility but ignored (destructured as `_className`), matching the
//     sibling RadialGauge/HelixMark ports.
//   - The `<span>` host becomes a `<View>` chip; `forwardRef<HTMLSpanElement>`
//     becomes `forwardRef<View>` so the ref-forwarding API is preserved. The
//     `{...props}` HTMLAttributes spread becomes a `...rest` ViewProps spread.
//   - The label `{children}` (L44) inherits the span's text colour on web, so on
//     native it is wrapped in an `AppText` carrying the variant text colour +
//     size + `font-medium` weight (the same string→AppText approach used by the
//     StatusPill / SourceLayerBadge ports). Non-text children should be passed
//     as strings/text nodes (documented in the sidecar).
//   - The decorative `bg-current` dot (L43) maps to a 6×6 View tinted with the
//     variant text colour (web `bg-current` === the inherited text colour) and
//     is flagged decorative for a11y.
//
// Visual intent: the native app renders dark, so the variant tints use the web
// `dark:` class hex literals (dark:bg-*-900/700 + dark:text-*-200) rather than
// the light fallbacks. Tailwind spacing → px (1 unit = 4px): px-1.5/2/2.5 →
// 6/8/10, py-0.5/1 → 2/4, h-1.5/w-1.5 → 6, gap-1 → 4, text-xs → 12/16,
// text-sm → 14/20, rounded-full → 9999, font-medium → '500'.
//
// The `forced-colors:border forced-colors:border-[CanvasText]` outline (L36) is
// a CSS forced-colors (OS high-contrast) affordance with no React Native
// analog; it is unavailable on native and intentionally omitted (the badge has
// no border outside forced-colors mode). Documented in the sidecar.
//
// The `auto` size follows the web `ui_density` setting via CSS variables
// (px-d-pad-x/py-d-pad-y). Native has no CSS-variable density cascade, so it
// resolves statically to the default ("comfortable") density values
// (--density-pad-x 1rem = 16, --density-pad-y 0.75rem = 12). Documented below.

import React, {forwardRef, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

export type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type BadgeSize = 'sm' | 'md' | 'lg' | 'auto';

interface VariantStyle {
  /** Native background fill (web `dark:bg-*`). */
  bg: string;
  /** Native label colour (web `dark:text-*`, also drives the `bg-current` dot). */
  text: string;
}

// Exact Tailwind hex for the web `dark:` variant classes — the native app is a
// dark surface, so the dark tints are the canonical render.
const variants: Record<BadgeVariant, VariantStyle> = {
  info: {bg: '#1e3a8a', text: '#bfdbfe'}, // dark:bg-blue-900 dark:text-blue-200
  success: {bg: '#14532d', text: '#bbf7d0'}, // dark:bg-green-900 dark:text-green-200
  warning: {bg: '#713f12', text: '#fef08a'}, // dark:bg-yellow-900 dark:text-yellow-200
  danger: {bg: '#7f1d1d', text: '#fecaca'}, // dark:bg-red-900 dark:text-red-200
  neutral: {bg: '#374151', text: '#e5e7eb'}, // dark:bg-gray-700 dark:text-gray-200
};

interface SizeStyle {
  paddingHorizontal: number;
  paddingVertical: number;
  fontSize: number;
  lineHeight: number;
}

const badgeSizes: Record<BadgeSize, SizeStyle> = {
  // px-1.5 py-0.5 text-xs
  sm: {paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, lineHeight: 16},
  // px-2 py-0.5 text-xs
  md: {paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, lineHeight: 16},
  // px-2.5 py-1 text-sm
  lg: {paddingHorizontal: 10, paddingVertical: 4, fontSize: 14, lineHeight: 20},
  // Density-aware sizing follows the user's `ui_density` setting on web
  // (px-d-pad-x py-d-pad-y text-xs). Native has no CSS-variable density
  // cascade, so it resolves to the default "comfortable" density padding.
  auto: {paddingHorizontal: 16, paddingVertical: 12, fontSize: 12, lineHeight: 16},
};

export interface BadgeProps extends Omit<ViewProps, 'style'> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children?: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

export const Badge = forwardRef<View, BadgeProps>(function Badge(
  {
    variant = 'neutral',
    size = 'md',
    dot,
    className: _className,
    children,
    style,
    testID,
    'data-testid': dataTestID,
    ...rest
  },
  ref,
) {
  const tint = variants[variant] ?? variants.neutral;
  const sizing = badgeSizes[size] ?? badgeSizes.md;
  const labelStyle: StyleProp<TextStyle> = {
    color: tint.text,
    fontSize: sizing.fontSize,
    lineHeight: sizing.lineHeight,
  };

  return (
    <View
      {...rest}
      ref={ref}
      style={[
        styles.base,
        {
          backgroundColor: tint.bg,
          paddingHorizontal: sizing.paddingHorizontal,
          paddingVertical: sizing.paddingVertical,
        },
        style,
      ]}
      testID={testID ?? dataTestID}>
      {dot ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.dot, {backgroundColor: tint.text}]}
        />
      ) : null}
      {children != null ? (
        <AppText style={[styles.label, labelStyle]}>{children}</AppText>
      ) : null}
    </View>
  );
});

Badge.displayName = 'Badge';

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999, // rounded-full
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  dot: {
    borderRadius: 9999, // rounded-full
    height: 6, // h-1.5
    width: 6, // w-1.5
  },
  label: {
    fontWeight: '500', // font-medium
  },
});

export default Badge;
