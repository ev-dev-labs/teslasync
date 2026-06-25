// Native parity port of web/src/components/layout/PageHeaderSticky.tsx.
//
// The web component is an IntersectionObserver-driven sticky bar: it watches a
// hero element by DOM id (`document.getElementById(targetId)`), shows itself
// once that hero has scrolled ABOVE the viewport top, renders a compressed
// summary (`children`) + a lucide `ArrowUp`, and — when `scrollToTop` is on —
// turns the whole bar into a button that scrolls the app's real scroll
// container (`<main id="main-content">`, falling back to `window`) back to the
// top. React Native has NONE of those browser primitives — no
// IntersectionObserver, no `document`, no DOM scroll container, no CSS `sticky`
// / `backdrop-blur` — so (per conversion-contract rule 7) the browser-only
// plumbing is moved behind explicit host bridges while the visible/hidden state
// machine, the bar layout, the scroll-to-top affordance and the accessibility
// intent are preserved verbatim:
//   - `document.getElementById(targetId)` + `IntersectionObserver` (the boolean
//     "hero has scrolled past the top") -> the `scrolledPast` bridge prop. The
//     host scroll container computes the same boolean
//     (`!entry.isIntersecting && boundingClientRect.top < 0`) and supplies it.
//     When it is undefined the bar stays hidden — the same as the web default
//     before the hero scrolls past, and the explicit native unavailable state
//     for autonomous scroll detection.
//   - `window` / `#main-content` `.scrollTo({ top: 0, behavior: 'smooth' })` ->
//     the `onScrollToTop` bridge prop (the host owns the ScrollView ref). A
//     missing bridge is a no-op, mirroring the web no-op when the scroll
//     position is already 0.
//   - lucide `ArrowUp` (h-3.5 w-3.5 text-muted) -> a bare muted `↑` AppText
//     glyph (caption ~ h-3.5, tone muted ~ var(--text-muted)); no lucide / DOM
//     icon box (contract rule 4).
//   - CSS `sticky z-40 top:topOffset -mx-4 border-b bg-[var(--bg-1)]/95
//     backdrop-blur` -> a `View` with zIndex 40, position relative + top offset,
//     full-bleed negative margin, hairline bottom border and the translucent
//     `colors.surface` panel background (the closest token to bg-1/95 +
//     backdrop-blur; true sticky pinning + blur are host-owned).
//   - `cn(...)` class merging -> StyleSheet style arrays; `className` -> `style`.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// Web `px-4` / `gap-3` / `py-2`: Tailwind 16 / 12 / 8 px. spacing.md === 12
// (gap-3), spacing.sm === 8 (py-2); px-4 (16) has no token so it is a constant.
const BAR_PADDING_X = 16;

export interface PageHeaderStickyProps {
  /**
   * Conceptual `id` of the hero whose scroll-past drives visibility — the web
   * `targetId` the IntersectionObserver watched. React Native has no DOM lookup
   * by id, so this is retained for parity/labelling only; the actual visibility
   * boolean is supplied by the host via `scrolledPast`.
   */
  targetId: string;
  /**
   * Host-computed replacement for the web IntersectionObserver result: `true`
   * once the hero (`targetId`) has scrolled ABOVE the viewport top
   * (web: `!entry.isIntersecting && entry.boundingClientRect.top < 0`). When
   * undefined the bar stays hidden — the web pre-scroll default and the
   * explicit native unavailable state for autonomous scroll detection.
   */
  scrolledPast?: boolean;
  /** Content rendered inside the bar — usually a compressed summary. */
  children: ReactNode;
  /**
   * When true (default) the whole bar becomes a scroll-to-top button (with a
   * trailing `↑` glyph) that calls `onScrollToTop`. Pass `false` to render a
   * plain, non-interactive bar.
   */
  scrollToTop?: boolean;
  /**
   * Host scroll-to-top bridge. Replaces the web `#main-content` / `window`
   * `.scrollTo({ top: 0, behavior: 'smooth' })`; the host owns the ScrollView
   * ref. A missing bridge is a no-op (matches the web no-op at scroll 0).
   */
  onScrollToTop?: () => void;
  /** Offset from the top of the scroll viewport. Default 0. */
  topOffset?: number;
  /** Accessibility label for the sticky region (web `aria-label`). Localise per page. */
  accessibilityLabel: string;
  /** Test hook on the outer node (web `testId` / `data-testid`). */
  testID?: string;
  /** Extra style on the outer node (web `className`). */
  style?: StyleProp<ViewStyle>;
}

/**
 * PageHeaderSticky — a sticky summary bar that appears once the page hero has
 * scrolled out of view and optionally doubles as a scroll-to-top affordance.
 *
 * On native the scroll detection (web IntersectionObserver) and the scroll
 * action (web DOM `scrollTo`) are browser-only, so both are delegated to the
 * host via the `scrolledPast` and `onScrollToTop` props; without a `scrolledPast`
 * signal the bar simply stays hidden, exactly as the web bar does before the
 * hero scrolls past. The compressed-summary content, the optional `↑` button
 * and the region accessibility label are preserved.
 */
export function PageHeaderSticky({
  targetId,
  scrolledPast,
  children,
  scrollToTop = true,
  onScrollToTop,
  topOffset = 0,
  accessibilityLabel,
  testID,
  style,
}: PageHeaderStickyProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Native replacement for the web IntersectionObserver(targetId) effect. The
    // web observer set `visible` when the hero had scrolled ABOVE the viewport
    // top, using a top rootMargin of `-topOffset`. React Native has no
    // IntersectionObserver/DOM, so the host computes that same boolean and
    // supplies it via `scrolledPast`. `targetId`/`topOffset` stay in the
    // dependency list to mirror the web effect's deps exactly.
    setVisible(scrolledPast ?? false);
  }, [scrolledPast, targetId, topOffset]);

  const handleScrollTop = useCallback(() => {
    // The web component scrolled the app's real scroll container
    // (`<main id="main-content">`, falling back to `window`). React Native has
    // no DOM scroll container of its own here — the host owns the ScrollView
    // ref — so the scroll-to-top is delegated to the `onScrollToTop` bridge.
    // No bridge === no-op (the bar still shows; it simply is not a scroll
    // affordance), matching the web no-op when the scroll position is 0.
    onScrollToTop?.();
  }, [onScrollToTop]);

  if (!visible) {
    return null;
  }

  const content = (
    <>
      <AppText
        numberOfLines={1}
        style={styles.summary}
        tone="secondary"
        variant="caption">
        {children}
      </AppText>
      {scrollToTop ? (
        <AppText style={styles.arrow} tone="muted" variant="caption">
          {'\u2191'}
        </AppText>
      ) : null}
    </>
  );

  const barStyle: StyleProp<ViewStyle> = [styles.bar, {top: topOffset}, style];

  return (
    <View style={barStyle} testID={testID}>
      {scrollToTop ? (
        <Pressable
          accessibilityLabel={`${accessibilityLabel} \u2014 scroll to top`}
          accessibilityRole="button"
          onPress={handleScrollTop}
          style={({pressed}) => [
            styles.inner,
            styles.innerInteractive,
            pressed && styles.innerPressed,
          ]}>
          {content}
        </Pressable>
      ) : (
        <View accessibilityLabel={accessibilityLabel} accessible style={styles.inner}>
          {content}
        </View>
      )}
    </View>
  );
}

PageHeaderSticky.displayName = 'PageHeaderSticky';

const styles = StyleSheet.create({
  // Web `sticky z-40 -mx-4 border-b border-white/[0.06] bg-[var(--bg-1)]/95
  // backdrop-blur`: position relative + zIndex (RN has no CSS `sticky` — true
  // pinning is host-owned), full-bleed negative horizontal margin, hairline
  // bottom border and the translucent panel background (closest token to
  // bg-1/95 + backdrop-blur; `top` is applied dynamically from `topOffset`).
  bar: {
    position: 'relative',
    zIndex: 40,
    marginHorizontal: -BAR_PADDING_X,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: colors.surface,
  },
  // Web `flex items-center gap-3 px-4 py-2 text-xs`.
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: BAR_PADDING_X,
    paddingVertical: spacing.sm,
  },
  // Web button `w-full text-left`.
  innerInteractive: {
    width: '100%',
  },
  // Web `hover:text-cyan-200` + `focus-visible:ring-2 ring-cyan-400/60`: there
  // is no hover/focus ring on native, so the press state gets a subtle raised
  // surface highlight as the equivalent interaction affordance.
  innerPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  // Web `flex-1 min-w-0 ... text-[var(--text-secondary)] truncate` (tone +
  // single-line truncation come from `numberOfLines` + the secondary tone).
  summary: {
    flex: 1,
  },
  // Web `ArrowUp h-3.5 w-3.5 text-[var(--text-muted)] shrink-0`: a bare muted
  // glyph; RN flex items do not shrink by default so no explicit shrink-0.
  arrow: {
    fontWeight: '600',
  },
});
