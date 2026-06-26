// Native parity port of web/src/components/ui/IconBox.tsx.
//
// The web component (source L19-31) is a colored icon container with a
// translucent neon background + ring border, used to replace the repeated
// `h-10 w-10 rounded-xl` icon-chip pattern across the app. It renders a single
// <div> that:
//   - is a flex box centring its child (`flex items-center justify-center`),
//   - never shrinks in a flex row (`shrink-0`),
//   - has one of three square sizes with a rounded corner (`iconBoxSize`,
//     source L12-16), and
//   - applies the neon colour's background, ring, and text colour from
//     `neonColorMap[color]` (source L20, L25) so the lucide icon child inherits
//     the tint via CSS `currentColor`.
//
// Native-safe translation of every browser-only dependency (documented in the
// .parity.json sidecar):
//   - react `ReactNode` (source L1): preserved verbatim via the same `react`
//     import.
//   - @/lib/cn `cn()` (source L2): Tailwind class merging is meaningless on
//     React Native. The class strings become a `View` + StyleSheet array, with
//     dynamic per-colour/per-size values supplied inline. The optional
//     `className` escape hatch (source L9, L26) becomes the idiomatic RN
//     `style?: StyleProp<ViewStyle>` override, applied last so callers can still
//     tweak the box exactly like the web `className` did.
//   - @/lib/tokens `NeonColor` + `neonColorMap` (source L3, L20): the web map
//     holds Tailwind class strings (`text-cyan-300`, `bg-neon-cyan/10`,
//     `ring-neon-cyan/20`); here it is resolved to concrete RN colour values —
//     the same toned-down 300-level text shade, the neon hue at 10% alpha for
//     the background, and the neon hue at 20% alpha for the ring/border. The
//     `NeonColor` union and the `neonColorMap` export name are preserved so
//     native callers/types line up with the web ones.
//   - Tailwind size classes `iconBoxSize` (source L12-16): `h-8 w-8 rounded-lg`
//     -> 32px / radius 8; `h-10 w-10 rounded-xl` -> 40px / radius 12;
//     `h-12 w-12 rounded-xl` -> 48px / radius 12. The map keeps the same
//     `sm`/`md`/`lg` keys and `md` default.
//   - CSS `text` colour cascade to the icon glyph: React Native does NOT
//     propagate a `View`'s colour to descendant `Text`, so the web's
//     `currentColor` inheritance is reproduced with an `IconBoxTintContext`
//     provider carrying the resolved tint. Native icon-glyph children read it
//     via `useIconBoxTint()` (the RN analog of `currentColor`); plain string /
//     number children are auto-wrapped in a tinted `AppText` so the common
//     "single glyph" usage still renders coloured out of the box.

import React, {createContext, useContext, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

/**
 * Neon colour variants, ported verbatim from web/src/lib/tokens.ts so native
 * callers and shared types match the web `NeonColor` union.
 */
export type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue';

/** Square size + corner-radius variants for the icon box. */
export type IconBoxSize = 'sm' | 'md' | 'lg';

interface NeonColorTokens {
  /** Tint inherited by the icon glyph child (web `text-*-300`). */
  text: string;
  /** Translucent box background (web `bg-neon-*\/10`). */
  bg: string;
  /** Ring / border colour (web `ring-neon-*\/20`). */
  ring: string;
}

// Resolved native analog of web/src/lib/tokens.ts `neonColorMap`. The web map's
// Tailwind class strings become concrete colours:
//   - `text`  -> the toned-down Tailwind 300-level shade used by the web.
//   - `bg`    -> the neon hue (tailwind.config.js theme.colors.neon) at 10% alpha.
//   - `ring`  -> the same neon hue at 20% alpha.
export const neonColorMap: Record<NeonColor, NeonColorTokens> = {
  cyan: {text: '#67e8f9', bg: 'rgba(0, 240, 255, 0.1)', ring: 'rgba(0, 240, 255, 0.2)'},
  green: {text: '#6ee7b7', bg: 'rgba(16, 185, 129, 0.1)', ring: 'rgba(16, 185, 129, 0.2)'},
  red: {text: '#fda4af', bg: 'rgba(239, 68, 68, 0.1)', ring: 'rgba(239, 68, 68, 0.2)'},
  purple: {text: '#d8b4fe', bg: 'rgba(168, 85, 247, 0.1)', ring: 'rgba(168, 85, 247, 0.2)'},
  amber: {text: '#fcd34d', bg: 'rgba(245, 158, 11, 0.1)', ring: 'rgba(245, 158, 11, 0.2)'},
  blue: {text: '#a5b4fc', bg: 'rgba(79, 70, 229, 0.1)', ring: 'rgba(79, 70, 229, 0.2)'},
};

// Native analog of the web `iconBoxSize` Tailwind class map (source L12-16).
// `rounded-lg` -> 8px, `rounded-xl` -> 12px; `h-N w-N` -> N * 4 px.
const iconBoxSize: Record<IconBoxSize, {size: number; radius: number}> = {
  sm: {size: 32, radius: 8},
  md: {size: 40, radius: 12},
  lg: {size: 48, radius: 12},
};

/**
 * React Native has no CSS `currentColor`, so a `View`'s colour does not cascade
 * to descendant `Text`. This context carries the resolved tint down to icon
 * children, reproducing the web's `text-*` -> lucide `currentColor` inheritance.
 * Defaults to the `cyan` tint, matching the `color = 'cyan'` default below.
 */
export const IconBoxTintContext = createContext<string>(neonColorMap.cyan.text);

/**
 * Read the tint provided by the nearest {@link IconBox}. Native icon-glyph
 * components should pass this as their colour to mirror how web lucide icons
 * inherit `currentColor` from the box.
 */
export function useIconBoxTint(): string {
  return useContext(IconBoxTintContext);
}

interface IconBoxProps {
  children: ReactNode;
  color?: NeonColor;
  size?: IconBoxSize;
  /** Native escape hatch replacing the web `className` override (source L9). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Colored icon container with background ring. Native parity port of the web
 * IconBox — replaces the repeated `h-10 w-10 rounded-xl` icon-chip pattern.
 */
export function IconBox({
  children,
  color = 'cyan',
  size = 'md',
  style,
  testID,
}: IconBoxProps) {
  const c = neonColorMap[color];
  const dims = iconBoxSize[size];

  // Plain string/number children carry no colour of their own; tint them so the
  // common single-glyph usage matches the web (icon children inherit via the
  // IconBoxTintContext / useIconBoxTint instead).
  const content =
    typeof children === 'string' || typeof children === 'number' ? (
      <AppText style={[styles.glyph, {color: c.text}] as StyleProp<TextStyle>}>
        {children}
      </AppText>
    ) : (
      children
    );

  return (
    <IconBoxTintContext.Provider value={c.text}>
      <View
        testID={testID}
        style={[
          styles.base,
          {
            width: dims.size,
            height: dims.size,
            borderRadius: dims.radius,
            backgroundColor: c.bg,
            borderColor: c.ring,
          },
          style,
        ]}>
        {content}
      </View>
    </IconBoxTintContext.Provider>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
  },
  glyph: {
    textAlign: 'center',
  },
});
