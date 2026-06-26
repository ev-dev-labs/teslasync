// Native parity port of web/src/components/ui/Logo.tsx.
//
// The web module is the TeslaSync brand mark: a rounded-square badge filled
// with the theme gradient (--theme-primary -> --theme-accent) containing a
// white lightning bolt, plus an optional "TeslaSync" wordmark. It is rendered
// with an inline <svg> (<defs><linearGradient> + <rect> + bolt <path>) — none
// of which exist on React Native, and react-native-svg is NOT a dependency of
// this app. The mark is therefore reproduced with React Native primitives:
//
//   - the wrapper <div className="flex items-center gap-2.5"> (L10) -> a row
//     <View> with alignItems center and gap 10 (Tailwind gap-2.5 = 10px).
//   - the <svg width/height={size} viewBox="0 0 200 200" className="shrink-0">
//     (L11-18) -> a square badge <View> sized to `size` with flexShrink 0.
//   - the <defs><linearGradient> primary->accent stops (L19-24) + the
//     gradient-filled <rect x8 y8 w184 h184 rx40 ...> (L25-26) -> the badge's
//     backgroundColor + borderRadius = size * 0.2 (rx 40 / viewBox 200 = 0.2).
//     React Native core has no linear-gradient primitive and no gradient
//     package (react-native-svg / expo-linear-gradient) is installed, so the
//     diagonal fill is approximated by a solid fill of the gradient's start
//     stop (THEME_PRIMARY #00f0ff). The accent stop (#10b981) cannot be
//     rendered without a gradient layer; both literals are pinned from the web
//     CSS-var fallbacks because native has no CSS custom-property theming.
//   - the white bolt <path ... fill="currentColor"> (L27-28) -> a white
//     high-voltage glyph ("\u26A1" + U+FE0E text-presentation selector so it
//     paints as colorable text instead of a yellow system emoji). currentColor
//     inheritance has no RN analog; the documented "White bolt" intent is
//     pinned to #ffffff.
//   - the per-instance random gradient id (L8 `lg-${Math.random()...}`) existed
//     only to namespace the SVG <linearGradient> / url(#...) reference so
//     multiple logos on one page would not collide; there is no <defs>/url() on
//     native, so it is intentionally dropped.
//   - the wordmark <span className="font-bold text-sm tracking-tight
//     text-[var(--text-primary)]"> (L30-34) -> an <AppText> at 14px / 700 /
//     -0.3 letter-spacing / textPrimary, gated on `showWordmark` exactly as the
//     web `{showWordmark && (...)}`.
//   - `className` is accepted-but-ignored for source compatibility (no Tailwind
//     on native); `style` / `testID` are added for native call-sites. See the
//     .parity.json sidecar for the line-by-line map.

import React from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

// Web --theme-primary gradient start, pinned from the source CSS-var fallback
// (`var(--theme-primary, #00f0ff)`). Native has no CSS-var theming layer, and
// without a gradient package the --theme-accent (#10b981) end stop cannot be
// painted, so the badge uses this single brand color as a solid fill.
const THEME_PRIMARY = '#00f0ff';
const BOLT_COLOR = '#ffffff';

// High-voltage sign (U+26A1) + VS15 text-presentation selector (U+FE0E) so the
// bolt renders as a color-controllable glyph rather than a system emoji.
const BOLT_GLYPH = '\u26A1\uFE0E';

export interface LogoProps {
  /** Pixel size of the square badge. Defaults to 32 (web default). */
  size?: number;
  /** Render the "TeslaSync" wordmark beside the badge. Defaults to false. */
  showWordmark?: boolean;
  /** Web Tailwind className. Retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `<Logo>` — TeslaSync brand mark (native parity).
 *
 * A rounded-square badge holding a white lightning bolt, with an optional
 * "TeslaSync" wordmark. The web inline SVG (gradient rect + bolt path) is
 * approximated with React Native primitives because react-native-svg is not a
 * dependency; see the file header and .parity.json sidecar for the per-line
 * map.
 */
export function Logo({
  size = 32,
  showWordmark = false,
  className: _className,
  style,
  testID,
}: LogoProps) {
  return (
    <View style={[styles.root, style]} testID={testID}>
      <View
        style={[
          styles.badge,
          {borderRadius: size * 0.2, height: size, width: size},
        ]}>
        <AppText
          accessible={false}
          style={[styles.bolt, {fontSize: size * 0.6, lineHeight: size}]}>
          {BOLT_GLYPH}
        </AppText>
      </View>
      {showWordmark ? (
        <AppText tone="primary" style={styles.wordmark}>
          TeslaSync
        </AppText>
      ) : null}
    </View>
  );
}

Logo.displayName = 'Logo';

export default Logo;

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: THEME_PRIMARY, // solid --theme-primary (gradient not renderable without a gradient lib)
    flexShrink: 0, // shrink-0
    justifyContent: 'center',
  },
  bolt: {
    color: BOLT_COLOR, // "White bolt" / fill="currentColor"
    fontWeight: '700',
    textAlign: 'center',
  },
  root: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex (row)
    gap: 10, // gap-2.5
  },
  wordmark: {
    fontSize: 14, // text-sm
    fontWeight: '700', // font-bold
    letterSpacing: -0.3, // tracking-tight
    lineHeight: 20,
  },
});
