// Native parity port of web/src/components/feedback/GotoIndicator.tsx.
//
// Transient "Go to..." hint pill the web Layout renders (fixed, bottom-center)
// while the keyboard "g" shortcut chord is armed (shortcutMode === 'goto'),
// prompting the user to follow up with "?". The web source was a single
// react-i18next-driven <div> overlay holding a muted prompt <span>, two <kbd>
// key-caps, and a "+" separator, styled with Tailwind CSS variables, a
// backdrop blur, and a fade/slide-in entrance animation.
//
// This port reproduces the same behaviour and visual intent with React Native
// View/AppText primitives, mirroring the web's dark-theme CSS-variable colours
// exactly (web/src/index.css), the panel shadow token, and a self-contained
// i18n fallback -- no DOM, no react-i18next runtime, no Tailwind. The same
// `visible` prop gates rendering (returns null when false), preserving the
// parent-driven shortcut-mode contract. Keyboard chords are a web-only input
// concept; on native this is ported as the equivalent visual indicator driven
// by the identical prop. RN has no `position: fixed`, no CSS backdrop blur, and
// no CSS keyframe entrance, so the overlay uses bottom-anchored `position:
// absolute`, the translucent overlay fill stands in for the blur, and the
// fade/slide entrance is omitted (final resting state preserved) -- documented
// in the sidecar.

import React, {useCallback} from 'react';
import {Platform, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {shadows, spacing} from '../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

// Dark-theme CSS-variable values from web/src/index.css mirrored verbatim so
// the pill keeps its exact web look. The shared token set exposes adjacent
// hues (colors.surface / colors.border / colors.surfaceRaised / textMuted /
// textSecondary) but not these precise stops, so they are recreated here the
// same way _ErrorState/DraftRecoveryBanner recreate web-exact colours:
//   --surface-overlay: rgba(0, 0, 0, 0.6)   (pill background)
//   --border-subtle:   rgba(255,255,255,0.06) (pill hairline border)
//   --surface-2:       #151621               (key-cap background)
//   --text-secondary:  #9ca3af               (key-cap glyph)
//   --text-muted:      #8a95a6               (prompt + "+" separator)
// The container's inherited `text-[var(--text-primary)]` is never directly
// visible -- every child text node overrides it with muted/secondary -- so it
// is intentionally not applied to a node here.
const SURFACE_OVERLAY = 'rgba(0, 0, 0, 0.6)';
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';
const SURFACE_2 = '#151621';
const TEXT_SECONDARY = '#9ca3af';
const TEXT_MUTED = '#8a95a6';

// Tailwind type scale used by the source: the pill/prompt/"+" are `text-sm`
// (0.875rem = 14px); the <kbd> key-caps are `text-xs` (0.75rem = 12px).
const FONT_SIZE_SM = 14;
const FONT_SIZE_XS = 12;

const monoFontFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export interface GotoIndicatorProps {
  /**
   * Whether the "go to" shortcut chord is armed. Mirrors the web prop: the
   * parent (Layout) passes `shortcutMode === 'goto'`. Renders nothing when
   * false.
   */
  visible: boolean;
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, preserving
 * the i18n key/fallback intent (`t('shortcuts.goto', 'Go to...')`).
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * GotoIndicator -- transient hint pill telling the user the "g" shortcut chord
 * is armed and to press "?" next. Driven entirely by the `visible` prop.
 */
export function GotoIndicator({visible}: GotoIndicatorProps) {
  const t = useNativeTranslationFallback();

  if (!visible) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
      style={styles.overlay}
      testID="goto-indicator">
      <View
        accessible
        accessibilityLabel={`${t('shortcuts.goto', 'Go to...')} g + ?`}
        accessibilityRole="text"
        pointerEvents="none"
        style={styles.pill}>
        <AppText style={styles.prompt}>{t('shortcuts.goto', 'Go to...')}</AppText>
        <View style={styles.kbd}>
          <AppText style={styles.kbdText}>g</AppText>
        </View>
        <AppText style={styles.plus}>+</AppText>
        <View style={styles.kbd}>
          <AppText style={styles.kbdText}>?</AppText>
        </View>
      </View>
    </View>
  );
}

GotoIndicator.displayName = 'GotoIndicator';

const styles = StyleSheet.create({
  kbd: {
    backgroundColor: SURFACE_2,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kbdText: {
    color: TEXT_SECONDARY,
    fontFamily: monoFontFamily,
    fontSize: FONT_SIZE_XS,
    lineHeight: 16,
  },
  overlay: {
    alignItems: 'center',
    bottom: 80,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 9999,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: SURFACE_OVERLAY,
    borderColor: BORDER_SUBTLE,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.panel,
  },
  plus: {
    color: TEXT_MUTED,
    fontSize: FONT_SIZE_SM,
    marginHorizontal: spacing.xs,
  },
  prompt: {
    color: TEXT_MUTED,
    fontSize: FONT_SIZE_SM,
    marginRight: spacing.sm,
  },
});
