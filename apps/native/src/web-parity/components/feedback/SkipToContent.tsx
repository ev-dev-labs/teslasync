// Native parity port of web/src/components/feedback/SkipToContent.tsx.
//
// `SkipToContent` is the WCAG 2.4.1 (Bypass Blocks, Level A) "skip link":
// visually hidden until focused, it lets keyboard users jump straight to the
// page's `<main id="main-content">` landmark instead of tabbing through the
// entire 50+ item sidebar on every page load.
//
// The web source leans entirely on browser-only behaviour with no universal
// native parity surface (rules 4/7), so a native-safe implementation is built
// and the unavailable bits are documented here and in the sidecar:
//   - react-i18next `useTranslation` is absent from the native deps; a local
//     fallback resolver returns the inline English copy while still referencing
//     the `a11y.skipToContent` i18n key (same approach as the sibling
//     OfflineBanner / EmptyStateThreshold / BrowserCompatBanner ports).
//   - `<VisuallyHidden as="a" focusable>` composes the Tailwind `sr-only`
//     utility, which has no native analog. The off-screen-but-accessible intent
//     is reproduced with an absolutely-positioned 1x1 container that screen
//     readers still announce; the `focus:not-sr-only` reveal is reproduced via
//     onFocus/onBlur (keyboard focus only fires on the macOS/Windows desktop
//     runtimes -- on touch there is no separate keyboard focus, so the link
//     stays AT-only, which matches the web behaviour on a touch device).
//   - `document.getElementById('main-content').focus()` has no DOM to query.
//     The native analog is a module-level main-content registry
//     (`registerMainContent` / `unregisterMainContent`) -- the RN equivalent of
//     the `id="main-content"` landmark -- whose registered node is given
//     accessibility focus via `AccessibilityInfo.setAccessibilityFocus`
//     (the RN analog of `HTMLElement.focus()`).
//   - `scrollIntoView({ block: 'start' })` has no general native analog (the
//     registered node is not assumed to be a scrollable handle); moving
//     accessibility focus is the meaningful behaviour and is preserved. The
//     `href="#main-content"` anchor target is kept as the `MAIN_CONTENT_ID`
//     constant so the landmark contract survives.
//
// Visual-intent mapping for the focus-visible chip (Tailwind -> tokens):
// focus:left-4/top-4 -> left/top 16; focus:z-[200] -> zIndex 200; rounded-lg ->
// borderRadius 8; bg-[var(--surface-1)] -> colors.surface; px-4/py-2 ->
// paddingHorizontal 16 / paddingVertical spacing.sm; text-sm font-medium ->
// fontSize 14 / fontWeight '500'; text-[var(--text-primary)] ->
// colors.textPrimary; shadow-lg -> shadows.panel; ring-2 ring-[var(--theme-primary)]
// -> borderWidth 2 / borderColor colors.accent (the app theme-primary). The
// `data-testid="skip-to-content"` hook maps to `testID`; `as="a"` maps to
// accessibilityRole="link".

import React, {useCallback, useState} from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Pressable,
  StyleSheet,
  type NativeSyntheticEvent,
  type StyleProp,
  type TargetedEvent,
  type View,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

/**
 * Anchor target the web link points at (`href="#main-content"`). Retained so
 * the landmark contract is documented even though native focus is routed
 * through the registry rather than a DOM id lookup.
 */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * Node the skip link should hand accessibility focus to. Accepts a host
 * component ref (e.g. `useRef<React.ComponentRef<typeof View>>`) or an already
 * resolved reactTag -- the RN analog of the `<main id="main-content">` element.
 */
export type MainContentTarget =
  | number
  | React.ComponentRef<typeof View>
  | null;

// Module-level registry -- the native stand-in for `id="main-content"`. The
// app shell registers its main content node so the skip link can focus it; the
// web source resolves the same landmark via `document.getElementById`.
let registeredMainContent: MainContentTarget = null;

/** Register the main-content node the skip link focuses on activation. */
export function registerMainContent(target: MainContentTarget): void {
  registeredMainContent = target;
}

/** Clear the registered main-content node (mirror of unmounting the landmark). */
export function unregisterMainContent(): void {
  registeredMainContent = null;
}

// Test seam -- lets specs drive the registry without mounting a real layout.
export function __setMainContentTargetForTests(
  target: MainContentTarget,
): void {
  registeredMainContent = target;
}

function resolveMainContentTag(target: MainContentTarget): number | null {
  if (target == null) {
    return null;
  }
  if (typeof target === 'number') {
    return target;
  }
  return findNodeHandle(target);
}

type NativeTFunction = (key: string, fallback: string) => string;

// React Native ships no react-i18next runtime; resolve to the inline English
// fallback while keeping the i18n key referenced at the call site.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * `SkipToContent` -- WCAG 2.4.1 skip link. Off-screen and AT-only by default;
 * on desktop keyboard focus it surfaces as a fixed top-left chip. Activating it
 * moves accessibility focus to the registered main-content node so screen-reader
 * and keyboard users bypass the sidebar. MUST be mounted as the very first
 * interactive element in the shell so it is reached before any sidebar control.
 */
export function SkipToContent() {
  const t = useNativeTranslationFallback();
  const [focused, setFocused] = useState(false);

  const label = t('a11y.skipToContent', 'Skip to main content');

  const handlePress = useCallback(() => {
    const tag = resolveMainContentTag(registeredMainContent);
    if (tag != null) {
      // RN analog of `main.focus()`. `scrollIntoView` has no general native
      // equivalent, so moving accessibility focus is the preserved behaviour.
      AccessibilityInfo.setAccessibilityFocus(tag);
    }
  }, []);

  const handleFocus = useCallback(
    (_event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(true);
    },
    [],
  );

  const handleBlur = useCallback(
    (_event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(false);
    },
    [],
  );

  const containerStyle: StyleProp<ViewStyle> = focused
    ? styles.focusedChip
    : styles.visuallyHidden;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      accessible
      onBlur={handleBlur}
      onFocus={handleFocus}
      onPress={handlePress}
      style={containerStyle}
      testID="skip-to-content">
      <AppText
        numberOfLines={1}
        style={focused ? styles.visibleLabel : styles.hiddenLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

SkipToContent.displayName = 'SkipToContent';

const styles = StyleSheet.create({
  focusedChip: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderRadius: 8,
    borderWidth: 2,
    left: 16,
    paddingHorizontal: 16,
    paddingVertical: spacing.sm,
    position: 'absolute',
    top: 16,
    zIndex: 200,
    ...shadows.panel,
  },
  hiddenLabel: {
    fontSize: 1,
    lineHeight: 1,
  },
  visibleLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  visuallyHidden: {
    height: 1,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    width: 1,
  },
});

export default SkipToContent;
