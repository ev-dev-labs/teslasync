// Native parity port of web/src/components/layout/BottomTabBar.tsx.
//
// The web source is a mobile bottom navigation bar: a fixed-overlay <nav> that
// renders the top-5 most-trafficked routes (Dashboard → Drives → Charging →
// Battery → Map) as react-router-dom <PrefetchLink> tabs, with the active tab
// derived from `useLocation().pathname`, lucide-react icons, the `cn()` Tailwind
// class composer, and react-i18next `t()` labels. Every browser-only piece is
// adapted to React Native primitives (see the parity sidecar for the full
// line-by-line mapping):
//   • <nav> / <span>            -> View / AppText
//   • PrefetchLink (router nav) -> Pressable + an `onNavigate(path)` callback;
//                                  the route-chunk prefetch is a web bundle
//                                  concern with no native analog and is dropped.
//   • useLocation().pathname    -> a `currentPath` prop (default '/'); the active
//                                  -tab logic is preserved verbatim.
//   • lucide-react icons        -> text glyphs (native ships no lucide/SVG icon
//                                  set), one per tab, carrying the same meaning.
//   • cn() Tailwind classes     -> StyleSheet + dynamic style arrays; the active
//                                  color (var(--theme-primary)) maps to the
//                                  native accent token, muted -> textMuted, and
//                                  the active:press tone -> textSecondary.
//   • drop-shadow glow on icon  -> textShadow* on the glyph when active.
//   • react-i18next t()         -> an inline English-default t() (no i18next
//                                  provider ships in the native app).
//   • fixed bottom-0 + z-50     -> position:'absolute' bottom/left/right/zIndex.
//   • backdrop-blur-xl          -> approximated by the semi-opaque surface token
//                                  (React Native has no backdrop blur primitive).
//   • lg:hidden                 -> a native app is inherently the mobile target,
//                                  so the bar is always rendered; the responsive
//                                  desktop-hide has no native analog.
//   • safe-bottom               -> a `bottomInset` prop (paddingBottom) so the
//                                  host can pass the safe-area inset.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/** Native parity ships no react-i18next provider; return the English default. */
function t(_key: string, fallback: string): string {
  return fallback;
}

interface Tab {
  path: string;
  /** Text-glyph stand-in for the lucide icon (native ships no SVG icon set). */
  glyph: string;
  i18nKey: string;
  fallback: string;
}

/**
 * Top-5 most-trafficked routes per MOBILE_GUIDELINES.md. Mirrors the
 * navigation a Tesla owner reaches for from their phone:
 * Dashboard → Drives → Charging → Battery → Map.
 *
 * Glyphs stand in for the web lucide icons (Home, Car, BatteryCharging,
 * HeartPulse, MapPin) — the color + glyph together carry the affordance:
 *   ⌂ house (Home), 🚗 car (Drives), ⚡ bolt (Charging),
 *   ♥ heart-pulse (Battery health), 📍 pin (Map).
 */
const TABS: Tab[] = [
  {path: '/', glyph: '\u2302', i18nKey: 'nav.dashboard', fallback: 'Home'},
  {path: '/drives', glyph: '\uD83D\uDE97', i18nKey: 'nav.drives', fallback: 'Drives'},
  {path: '/charging', glyph: '\u26A1', i18nKey: 'nav.charging', fallback: 'Charging'},
  {path: '/battery', glyph: '\u2665', i18nKey: 'nav.battery', fallback: 'Battery'},
  {path: '/live', glyph: '\uD83D\uDCCD', i18nKey: 'nav.liveMap', fallback: 'Map'},
];

/** Paths shown in the bottom tab bar — used to de-emphasize sidebar duplicates on mobile */
export const BOTTOM_TAB_PATHS = new Set(TABS.map(tab => tab.path));

export interface BottomTabBarProps {
  /**
   * Native replacement for react-router's `useLocation().pathname`. Drives the
   * active-tab highlight. Defaults to '/' (the dashboard root).
   */
  currentPath?: string;
  /**
   * Native navigation hook replacing react-router-dom's <PrefetchLink>. Fires
   * with the tapped tab's `path`. No-op if unwired.
   */
  onNavigate?: (path: string) => void;
  /**
   * Safe-area bottom inset (the native analog of the web `safe-bottom` class).
   * Applied as extra paddingBottom so the bar clears the home indicator.
   */
  bottomInset?: number;
  /** Native composition hook replacing the web `className` / fixed positioning. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * BottomTabBar — fixed bottom navigation bar surfacing the five most-trafficked
 * routes. The active tab is highlighted in the accent color with a glow and an
 * underline indicator; tapping a tab calls `onNavigate(path)`.
 */
export function BottomTabBar({
  currentPath = '/',
  onNavigate,
  bottomInset = 0,
  style,
  testID,
}: BottomTabBarProps = {}) {
  return (
    <View
      accessibilityLabel={t('nav.quickNav', 'Quick navigation')}
      accessibilityRole="tablist"
      style={[styles.bar, bottomInset > 0 ? {paddingBottom: bottomInset} : null, style]}
      testID={testID ?? 'bottom-tab-bar'}>
      {TABS.map(tab => {
        const isActive =
          tab.path === '/'
            ? currentPath === '/'
            : currentPath === tab.path ||
              currentPath.startsWith(tab.path + '/');
        const label = t(tab.i18nKey, tab.fallback);

        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{selected: isActive}}
            key={tab.path}
            onPress={() => onNavigate?.(tab.path)}
            style={styles.tab}
            testID={`bottom-tab-${tab.path}`}>
            {({pressed}) => {
              const tint = isActive
                ? colors.accent
                : pressed
                ? colors.textSecondary
                : colors.textMuted;

              return (
                <>
                  <AppText
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.glyph,
                      {color: tint},
                      isActive ? styles.glyphActive : null,
                    ]}>
                    {tab.glyph}
                  </AppText>
                  <AppText style={[styles.label, {color: tint}]} weight="semibold">
                    {label}
                  </AppText>
                  {isActive ? <View style={styles.indicator} /> : null}
                </>
              );
            }}
          </Pressable>
        );
      })}
    </View>
  );
}

BottomTabBar.displayName = 'BottomTabBar';

export default BottomTabBar;

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    left: 0,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    position: 'absolute',
    right: 0,
    zIndex: 50,
  },
  glyph: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  glyphActive: {
    textShadowColor: colors.accentGlow,
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 6,
  },
  indicator: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    bottom: -2,
    height: 2,
    position: 'absolute',
    width: 16,
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    gap: 2,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    position: 'relative',
  },
});
