// Native parity port of web/src/components/ui/Icon.tsx.
//
// The web source is a generic, standardized icon renderer. It takes ANY icon
// component (a `LucideIcon` from `@/lib/icons`), renders it as an `<svg>`, sizes
// it with a Tailwind size token (`h-4 w-4`, ...), pins `shrink-0` so it is not
// squeezed inside flex rows, and applies accessibility: decorative by default
// (`aria-hidden`) unless an `aria-label` is supplied, in which case it becomes a
// meaningful image (`role="img"`).
//
// This port keeps exactly that generic contract with React Native primitives:
//   * `icon` stays a component reference, typed as `IconComponentType` -- the RN
//     analog of `LucideIcon`: a component driven by a numeric `size`, a `color`,
//     and a `style`, which is how every native icon (vector-icon glyphs, the
//     SemanticIcon-style badges already in this app, react-native-svg icons)
//     is rendered. No lucide-react / DOM `<svg>` is imported.
//   * The Tailwind `SIZE_CLASSES` map becomes a `SIZE_PX` map carrying the same
//     pixel intent (h-3=12, h-3.5=14, h-4=16, h-5=20, h-6=24), passed to the icon
//     as its numeric `size` prop instead of as a `h-/w-` class.
//   * `cn(SIZE_CLASSES[size], 'shrink-0', className)` -> a numeric `size` prop +
//     a `flexShrink: 0` style. There is no `cn`/Tailwind in RN, so the extra
//     `className` has no effect and is accepted only for source-call parity; an
//     RN `style` override is provided instead.
//   * The `aria-label ? {aria-label, role:'img'} : {aria-hidden}` branch maps to
//     RN accessibility: a label exposes the icon as an `image` to assistive tech,
//     otherwise it is hidden as decorative (the RN equivalent of `aria-hidden`),
//     defaulting to decorative just like the web `ariaHidden ?? true`.
//
// No DOM elements, no Recharts/Leaflet, no framer-motion, and no web UI imports.

import {type ComponentType} from 'react';
import {
  StyleSheet,
  type AccessibilityRole,
  type StyleProp,
  type TextStyle,
  type ViewProps,
} from 'react-native';

/** Tailwind size token -- preserved verbatim from the web source. */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Props an icon component must accept to be renderable by {@link Icon}. This is
 * the React Native analog of the web `LucideIcon` contract: lucide rendered an
 * `<svg>` sized by a class and coloured via CSS `currentColor`; native icons are
 * sized by a numeric `size`, coloured by an explicit `color`, and positioned via
 * `style`. The accessibility fields are forwarded so the renderer can mark the
 * glyph decorative or meaningful without wrapping it in an extra host view.
 */
export interface IconRenderProps {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  accessible?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: ViewProps['importantForAccessibility'];
}

/** The RN analog of `LucideIcon`: any component honouring {@link IconRenderProps}. */
export type IconComponentType = ComponentType<IconRenderProps>;

export interface IconProps {
  /** The icon component to render (the native analog of `Icons.<concept>`). */
  icon: IconComponentType;
  /** Size token. Default `md` = 16px (web `h-4 w-4`). */
  size?: IconSize;
  /** Glyph colour. Omitted -> the icon keeps its own default (web `currentColor`). */
  color?: string;
  /**
   * Pass true (default) for decorative icons; the RN equivalent of the web
   * `aria-hidden` default. Set `accessibilityLabel` for meaningful ones.
   */
  decorative?: boolean;
  /**
   * Accessible label -- when set, the icon is treated as meaningful and exposed
   * to assistive tech as an `image` (web `aria-label` + `role="img"`).
   */
  accessibilityLabel?: string;
  /**
   * Web-parity only: Tailwind classes do not apply in React Native. Accepted so
   * ported call sites keep compiling; use `style` for native overrides.
   */
  className?: string;
  /** Extra style forwarded to the icon (replaces the web extra `className`). */
  style?: StyleProp<TextStyle>;
}

/**
 * Pixel sizes mirroring the web Tailwind `SIZE_CLASSES`:
 *  - xs `h-3 w-3`  = 12px
 *  - sm `h-3.5`    = 14px
 *  - md `h-4 w-4`  = 16px (default)
 *  - lg `h-5 w-5`  = 20px
 *  - xl `h-6 w-6`  = 24px
 */
const SIZE_PX: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

// web `aria-label ? {aria-label, role:'img'} : {aria-hidden: ariaHidden ?? true}`.
// Label -> meaningful image; otherwise decorative (hidden) unless explicitly
// opted out via `decorative={false}` (mirrors an explicit `aria-hidden={false}`).
function resolveAccessibility(
  label: string | undefined,
  decorative: boolean,
): IconRenderProps {
  if (label) {
    return {
      accessible: true,
      accessibilityRole: 'image',
      accessibilityLabel: label,
    };
  }
  if (decorative) {
    return {
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    };
  }
  return {};
}

/**
 * Standardized icon renderer. Use this with a native icon component instead of
 * importing icons directly, mirroring the web `Icon` + `@/lib/icons` pairing.
 *
 * Defaults:
 *  - size = `md` (16px)
 *  - decorative unless an `accessibilityLabel` is provided
 *  - `flexShrink: 0` so icons are not squeezed inside flex rows (web `shrink-0`)
 *
 * @example
 *   import {Icon} from '../ui/Icon';
 *   import {BatteryIcon} from '...';
 *   <Icon icon={BatteryIcon} size="lg" />
 */
export function Icon({
  icon: IconComponent,
  size = 'md',
  color,
  decorative,
  accessibilityLabel,
  className: _className,
  style,
}: IconProps) {
  const a11y = resolveAccessibility(accessibilityLabel, decorative ?? true);

  return (
    <IconComponent
      size={SIZE_PX[size]}
      color={color}
      style={[styles.icon, style]}
      {...a11y}
    />
  );
}

const styles = StyleSheet.create({
  // web `shrink-0`: keep the icon from being squeezed inside flex rows.
  icon: {
    flexShrink: 0,
  },
});
