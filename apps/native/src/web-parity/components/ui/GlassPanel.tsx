// Native parity port of web/src/components/ui/GlassPanel.tsx.
//
// The web `GlassPanel` is a `forwardRef` DOM <div> styled with Tailwind: a
// translucent `--surface-2` surface, a `--border-subtle` 1px border, a
// `rounded-xl` radius and `backdrop-blur-sm`, with three opt-in props —
// `glow` ('cyan'|'green'|'purple'|'none'), `hover` (boolean) and `padding`
// ('none'|'sm'|'md'|'lg'|'auto') — merging the caller `className` last via cn().
// It is reproduced here with React Native primitives:
//
//   - The DOM <div> becomes a `View`; the web `forwardRef<HTMLDivElement>`
//     becomes `forwardRef<View>` so callers can still attach a ref.
//   - `HTMLAttributes<HTMLDivElement>` becomes `Omit<ViewProps, 'style' |
//     'children'>`, so `testID`, accessibility props, `onLayout`, etc. still
//     flow through via `...props`.
//   - cn() (clsx + tailwind-merge, browser/Tailwind-only) is dropped; class
//     merging becomes a StyleSheet `style` array whose last element is the
//     caller `style` (same 'last wins' precedence cn gives the trailing
//     className).
//   - The web CSS-var colors are preserved verbatim as literals: the dark-theme
//     `--surface-2` (#151621) backgroundColor and `--border-subtle`
//     (rgba(255,255,255,0.06)) borderColor, with `rounded-xl` -> borderRadius 12
//     and a 1px border — the same "keep the web's explicit color" approach the
//     Button/DataTableBulkBar ports took.
//   - `backdrop-blur-sm` has no core-RN analog (no @react-native-community/blur
//     dependency here); since `--surface-2` is an opaque fill the blur is
//     visually moot, so the surface alone carries the glass intent.
//   - `padding` maps to a StyleSheet record: none 0, sm 12 (p-3), md 16 (p-4),
//     lg 24 (p-6). `auto` (density-aware `px-d-pad-x py-d-pad-y`) has no native
//     density utilities; it follows the web `:root`/comfortable defaults
//     (--density-pad-x 1rem -> 16, --density-pad-y 0.75rem -> 12). Like the web,
//     padding is only applied when the prop is supplied (`padding ? … : null`).
//   - `hover` + `glow` are CSS :hover affordances (`hover:border-*` +
//     `hover:shadow-[0_0_15px_…]`) with no pointer-hover analog on touch. To
//     preserve the designed visual intent, an opt-in `hover` panel applies the
//     `glow` border tint + soft glow shadow statically (the closest native
//     analog, mirroring how the Button port mapped `hover:` -> `pressed`); exact
//     web colors are kept (cyan-400 #22d3ee, green-400 #4ade80, purple-400
//     #c084fc). `transition-all duration-normal` and the `forced-colors:*`
//     Windows-High-Contrast border/bg overrides are browser-only and dropped.
//   - `data-print-card` is a web print-stylesheet hook with no native analog and
//     is dropped.
//   - The web `className` styling channel is retained on props for source
//     compatibility (ignored on native) and replaced by a native `style` prop
//     merged LAST so callers win.

import React, {forwardRef, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

export type GlassPanelGlow = 'cyan' | 'green' | 'purple' | 'none';
export type GlassPanelPadding = 'none' | 'sm' | 'md' | 'lg' | 'auto';

export interface GlassPanelProps extends Omit<ViewProps, 'style' | 'children'> {
  glow?: GlassPanelGlow;
  hover?: boolean;
  /**
   * Optional padding scale. Omitted by default (web callers usually pass a
   * `className="p-4"`; native callers pass `style`). Pass `'auto'` to follow the
   * web density-aware default (comfortable: 16px horizontal / 12px vertical).
   */
  padding?: GlassPanelPadding;
  children: ReactNode;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Native replacement for the web `className`; merged last so callers win. */
  style?: StyleProp<ViewStyle>;
}

// Dark-theme web CSS vars, preserved as literals.
const SURFACE_2 = '#151621'; // --surface-2
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)'; // --border-subtle

export const GlassPanel = forwardRef<View, GlassPanelProps>(function GlassPanel(
  {glow = 'none', hover = false, padding, className: _className, style, children, ...props},
  ref,
) {
  return (
    <View
      ref={ref}
      style={[
        styles.base,
        padding ? paddingStyles[padding] : null,
        hover ? glowStyles[glow] : null,
        style,
      ]}
      {...props}>
      {children}
    </View>
  );
});

GlassPanel.displayName = 'GlassPanel';

const styles = StyleSheet.create({
  base: {
    backgroundColor: SURFACE_2,
    borderColor: BORDER_SUBTLE,
    borderRadius: 12,
    borderWidth: 1,
  },
});

const paddingStyles = StyleSheet.create<Record<GlassPanelPadding, ViewStyle>>({
  auto: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lg: {
    padding: 24,
  },
  md: {
    padding: 16,
  },
  none: {},
  sm: {
    padding: 12,
  },
});

// hover:border-*/hover:shadow-[0_0_15px_…] -> a static opt-in glow (no native
// pointer hover). Exact web tailwind-400 colors preserved as literals.
const glowStyles = StyleSheet.create<Record<GlassPanelGlow, ViewStyle>>({
  cyan: {
    borderColor: 'rgba(34, 211, 238, 0.3)',
    elevation: 6,
    shadowColor: '#22d3ee',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.1,
    shadowRadius: 15,
  },
  green: {
    borderColor: 'rgba(74, 222, 128, 0.3)',
    elevation: 6,
    shadowColor: '#4ade80',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.1,
    shadowRadius: 15,
  },
  none: {},
  purple: {
    borderColor: 'rgba(192, 132, 252, 0.3)',
    elevation: 6,
    shadowColor: '#c084fc',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.1,
    shadowRadius: 15,
  },
});
