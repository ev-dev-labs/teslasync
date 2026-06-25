// Native parity port of web/src/components/feedback/PageLoader.tsx.
//
// Full-page centered loading mark, suitable as a React Suspense fallback —
// the same role the web component fills. The web version centers a large
// brand Spinner inside a flex box with tall vertical padding
// (`flex items-center justify-center py-32`).
//
// Native-safe adaptation (documented in the sidecar):
//   - The web `Spinner` is an SVG lightning-bolt that draws itself via CSS
//     keyframes + a `drop-shadow` glow and reads `prefers-reduced-motion`.
//     SVG path animation, CSS classes, and that media query are browser-only
//     and the web Spinner has not been ported to native, so this file uses
//     React Native's built-in `ActivityIndicator` (size "large") in the
//     accent color — the same loading primitive the ported ChartContainer
//     uses. The web Spinner's role="status" / aria-label="Loading" semantics
//     are preserved via accessibilityRole + accessibilityLabel.
//   - The `div` + Tailwind classes become a React Native `View` with a
//     centered StyleSheet: alignItems/justifyContent center and tall vertical
//     padding mirroring `py-32` (8rem = 128px).

import React from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';

import {colors} from '../../../theme/tokens';

// Tailwind `py-32` = 8rem = 128px of vertical padding on the centering box.
const FULL_PAGE_VERTICAL_PADDING = 128;

/** Full-page spinning loader, suitable as a React Suspense fallback. */
export function PageLoader() {
  return (
    <View style={styles.root}>
      <ActivityIndicator
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        color={colors.accent}
        size="large"
      />
    </View>
  );
}

PageLoader.displayName = 'PageLoader';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: FULL_PAGE_VERTICAL_PADDING,
  },
});

export default PageLoader;
