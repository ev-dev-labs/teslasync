// Native parity port of web/src/components/status/StickyCompactHero.tsx.
//
// StickyCompactHero — collapsed-on-scroll hero bar.
//
// Web behaviour: watches a target element (the full hero) via
// IntersectionObserver and only renders the compact bar once that target has
// scrolled out of view. Tapping the bar smooth-scrolls the page back to the top.
//
// Native adaptations (each documented in the .parity.json sidecar):
//   - IntersectionObserver + document.getElementById(targetId): React Native has
//     no DOM, no document.getElementById and no IntersectionObserver. The
//     "has the hero scrolled out of view?" decision (web: !entry.isIntersecting)
//     is delegated to the host, which computes it from its ScrollView offset vs
//     the hero's layout and `topOffset`, then drives the bar through the
//     controlled `visible` prop. `targetId` + `topOffset` are retained on the
//     props so the host call-site contract matches the web component; `topOffset`
//     is additionally applied as a top inset, mirroring the web sticky `top`.
//   - window.scrollTo({ top: 0, behavior: 'smooth' }): there is no window scroll
//     in RN. Tapping the bar invokes the optional `onScrollToTop` callback so the
//     host can scroll its own ScrollView/FlatList ref back to the top.
//   - lucide-react CheckCircle/AlertTriangle/XCircle/HelpCircle/Wrench/ArrowUp/
//     RefreshCw: no SVG icon library in native, so each renders as a monochrome
//     decorative glyph (importantForAccessibility="no", mirroring the web icons
//     which carry no label and lean on the text headline for meaning). The
//     spinning RefreshCw (animate-spin) maps to a native ActivityIndicator while
//     refreshing and a static ↻ glyph when idle.
//   - Tailwind sticky/z-40/-mx-4/backdrop-blur and text-*-400 utility colours
//     have no RN equivalent; the bar renders in normal flow (the host places it)
//     on a solid surface and the status colours map to the nearest theme tokens.
//   - cn(): replaced by StyleSheet composition + style arrays.

import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// Inlined from the web `./StatusHero` import. The native StatusHero parity port
// does not exist yet, so this union is reproduced verbatim from the web
// HeroStatus and re-exported; a future native StatusHero can consume it (or
// re-export its own and this file can switch to importing from there).
export type HeroStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'maintenance';

// Web ICON_FOR_STATUS (lucide components) -> monochrome unicode glyphs:
//   CheckCircle ✓, AlertTriangle ⚠, XCircle ✕, HelpCircle ?, Wrench ⚙.
const ICON_GLYPH_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: '\u2713',
  degraded: '\u26A0',
  unhealthy: '\u2715',
  unknown: '?',
  maintenance: '\u2699',
};

// Web TEXT_FOR_STATUS (tailwind text-*-400) -> nearest theme token colours:
//   green-400 -> success, amber-400 -> warning, red-400 -> danger,
//   zinc-400 -> textMuted, blue-400 -> glowCyan.
const COLOR_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: colors.success,
  degraded: colors.warning,
  unhealthy: colors.danger,
  unknown: colors.textMuted,
  maintenance: colors.glowCyan,
};

const SHORT_HEADLINE: Record<HeroStatus, string> = {
  healthy: 'All operational',
  degraded: 'Degraded',
  unhealthy: 'Outage',
  unknown: 'Status unknown',
  maintenance: 'Maintenance',
};

export interface StickyCompactHeroProps {
  /** ID of the full hero element to observe. Retained for host scroll-spy parity. */
  targetId: string;
  status: HeroStatus;
  /** Last-checked relative label, e.g. "12s ago". */
  lastCheckedLabel?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pixel offset from the top of the viewport when stuck. */
  topOffset?: number;
  /**
   * Native scroll-spy replacement for IntersectionObserver: the host passes the
   * web `!entry.isIntersecting` boolean (true once the hero has scrolled out of
   * view). Left undefined the bar stays in its initial hidden state.
   */
  visible?: boolean;
  /** Native replacement for window.scrollTo: host scrolls its list to the top. */
  onScrollToTop?: () => void;
  testID?: string;
}

export function StickyCompactHero({
  targetId: _targetId,
  status,
  lastCheckedLabel,
  onRefresh,
  refreshing = false,
  topOffset = 0,
  visible: visibleProp,
  onScrollToTop,
  testID,
}: StickyCompactHeroProps) {
  const [visible, setVisible] = useState(false);

  // IntersectionObserver replacement: mirror the host-computed visibility (the
  // web `setVisible(!entry.isIntersecting)`) into the same `visible` state the
  // web component used to gate rendering.
  useEffect(() => {
    if (visibleProp !== undefined) {
      setVisible(visibleProp);
    }
  }, [visibleProp]);

  const handleScrollTop = useCallback(() => {
    onScrollToTop?.();
  }, [onScrollToTop]);

  if (!visible) {
    return null;
  }

  const glyph = ICON_GLYPH_FOR_STATUS[status];
  const color = COLOR_FOR_STATUS[status];
  const headline = SHORT_HEADLINE[status];

  return (
    <View
      accessibilityLabel="Status summary"
      style={[styles.container, {paddingTop: topOffset}]}
      testID={testID}>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel="Scroll to top of page"
          accessibilityRole="button"
          onPress={handleScrollTop}
          style={styles.summaryButton}>
          <AppText
            importantForAccessibility="no"
            style={[styles.icon, {color}]}
            weight="semibold">
            {glyph}
          </AppText>
          <AppText style={[styles.headline, {color}]} weight="semibold">
            {headline}
          </AppText>
          {lastCheckedLabel ? (
            <AppText style={styles.lastChecked} tone="muted" variant="caption">
              {`\u00B7 ${lastCheckedLabel}`}
            </AppText>
          ) : null}
          <AppText
            importantForAccessibility="no"
            style={styles.arrow}
            tone="muted">
            {'\u2191'}
          </AppText>
        </Pressable>

        {onRefresh ? (
          <Pressable
            accessibilityLabel="Refresh status"
            accessibilityRole="button"
            accessibilityState={{busy: refreshing}}
            disabled={refreshing}
            onPress={onRefresh}
            style={({pressed}) => [
              styles.refreshButton,
              pressed && styles.refreshPressed,
              refreshing && styles.refreshDisabled,
            ]}>
            {refreshing ? (
              <ActivityIndicator color={colors.textSecondary} size="small" />
            ) : (
              <AppText
                importantForAccessibility="no"
                style={styles.refreshIcon}
                weight="semibold">
                {'\u21BB'}
              </AppText>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: {
    fontSize: 13,
    lineHeight: 16,
    marginLeft: 'auto',
  },
  container: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headline: {
    fontSize: 14,
    lineHeight: 18,
  },
  icon: {
    fontSize: 16,
    lineHeight: 18,
  },
  lastChecked: {
    lineHeight: 16,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  refreshDisabled: {
    opacity: 0.6,
  },
  refreshIcon: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 18,
  },
  refreshPressed: {
    backgroundColor: colors.surfaceHover,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  summaryButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

export default StickyCompactHero;
