// Native parity port of web/src/components/layout/status-bar/HelpSegment.tsx.
//
// HelpSegment — footer status-bar segment that consolidates the three
// "always available" help affordances that used to live at the bottom of the
// sidebar:
//
//   • Press `?` for shortcuts → opens the keyboard cheat sheet
//   • Take a tour              → opens the tour launcher
//   • Report bug               → opens the in-app feedback modal
//
// On web each action stays decoupled from the React tree by dispatching the
// same window events the sidebar previously used (`toggle-keyboard-shortcuts`,
// `dispatchTourLauncherOpen()` → `teslasync:tour:openLauncher`, and
// `open-feedback-modal`) so the Cmd+K palette and any other surface continue
// to work unchanged.
//
// Native adaptations (documented in the .parity.json sidecar):
//   - react-native has no `window` / `CustomEvent`, so the three decoupled
//     window-event dispatches become optional callback props
//     (`onOpenShortcuts` / `onOpenTour` / `onOpenFeedback`) that a native host
//     bridges to its own shortcuts overlay, tour launcher, and feedback modal.
//     The three web event identifiers are preserved verbatim as exported
//     constants (SHORTCUTS_EVENT / TOUR_OPEN_LAUNCHER_EVENT /
//     FEEDBACK_MODAL_EVENT) so host wiring keeps the same contract; when a
//     callback is not wired the action is an explicit no-op.
//   - react-i18next `useTranslation` → a native-safe `t(key, fallback, params?)`
//     fallback that interpolates i18next-style `{{name}}` placeholders, keeping
//     every translation key + default string.
//   - lucide-react `Keyboard` / `HelpCircle` / `Bug` → the existing
//     `SemanticIcon` glyphs (`keyboard` / `helpCircle` / `bug`), decorative.
//     The web 12px inline icons become sm SemanticIcon glyphs, which also give
//     a comfortable touch target on native.
//   - `@/components/ui` `Tooltip` (hover/focus popover, `side="top"`) has no
//     native analog; its `content` becomes each button's `accessibilityHint`
//     and `side` is preserved as the documented TOOLTIP_SIDE constant.
//   - Tailwind class strings (`cn(...)`), the `<button>`/`<kbd>`/`<span>` DOM
//     elements, and the `hidden xl:inline` responsive utility become a
//     `StyleSheet` + `useWindowDimensions()` XL breakpoint so the three-tier
//     visibility (iconOnly → icon+`?` chip → icon+`?`+suffix) is preserved.

import React, {useCallback} from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next) ──────────
type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, params?: NativeTParams) =>
      interpolate(fallback, params),
    [],
  );
}

/**
 * The three window-event identifiers the web component dispatches. Preserved
 * verbatim so a native host can bridge each callback to the same conceptual
 * surface (and to any cross-surface listeners) without changing the contract.
 */
export const SHORTCUTS_EVENT = 'toggle-keyboard-shortcuts';
export const TOUR_OPEN_LAUNCHER_EVENT = 'teslasync:tour:openLauncher';
export const FEEDBACK_MODAL_EVENT = 'open-feedback-modal';

/** Web `<Tooltip side="top">` placement — no native analog, kept for parity. */
export const TOOLTIP_SIDE = 'top' as const;

/**
 * Tailwind `xl` breakpoint (min-width: 1280px). The web `hidden xl:inline`
 * suffix/label spans only render at or above this width.
 */
const XL_BREAKPOINT = 1280;

export interface HelpSegmentProps {
  /**
   * Icon-only with accessibility hints when the bar is compact / on narrow
   * screens; full label + icon when expanded. Mirrors the web prop.
   */
  iconOnly?: boolean;
  /** Bridges the web `toggle-keyboard-shortcuts` event to the native host. */
  onOpenShortcuts?: () => void;
  /** Bridges the web `teslasync:tour:openLauncher` event to the native host. */
  onOpenTour?: () => void;
  /** Bridges the web `open-feedback-modal` event to the native host. */
  onOpenFeedback?: () => void;
  testID?: string;
}

export function HelpSegment({
  iconOnly = false,
  onOpenShortcuts,
  onOpenTour,
  onOpenFeedback,
  testID = 'help-segment',
}: HelpSegmentProps) {
  const t = useNativeTranslationFallback();
  const {width} = useWindowDimensions();
  const showSuffix = !iconOnly && width >= XL_BREAKPOINT;

  // Native analogs of the web `window.dispatchEvent(...)` / dispatchTourLauncherOpen()
  // calls — each delegates to the host-wired callback (no-op when unwired).
  const openShortcuts = useCallback(() => onOpenShortcuts?.(), [onOpenShortcuts]);
  const openTour = useCallback(() => onOpenTour?.(), [onOpenTour]);
  const openFeedback = useCallback(() => onOpenFeedback?.(), [onOpenFeedback]);

  return (
    <View style={styles.root} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('shortcuts.openAria', 'Open keyboard shortcuts')}
        accessibilityHint={t('shortcuts.tooltip', 'Keyboard shortcuts')}
        hitSlop={6}
        onPress={openShortcuts}
        style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}
        testID={`${testID}-shortcuts-trigger`}>
        <SemanticIcon decorative name="keyboard" size="sm" />
        {!iconOnly ? (
          <>
            <View style={styles.kbd} testID={`${testID}-shortcut-key`}>
              <AppText style={styles.kbdText} weight="semibold">
                ?
              </AppText>
            </View>
            {showSuffix ? (
              <AppText
                numberOfLines={1}
                style={styles.suffix}
                testID={`${testID}-shortcuts-suffix`}>
                {t('shortcuts.hintSuffix', 'for shortcuts')}
              </AppText>
            ) : null}
          </>
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tour.launcher.openAria', 'Open tour launcher')}
        accessibilityHint={t('tour.launcher.openShort', 'Take a tour')}
        hitSlop={6}
        onPress={openTour}
        style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}
        testID={`${testID}-tour-trigger`}>
        <SemanticIcon decorative name="helpCircle" size="sm" />
        {showSuffix ? (
          <AppText
            numberOfLines={1}
            style={styles.suffix}
            testID={`${testID}-tour-suffix`}>
            {t('tour.launcher.openShort', 'Take a tour')}
          </AppText>
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          'feedback.openAria',
          'Open feedback / bug report form',
        )}
        accessibilityHint={t('feedback.openShort', 'Report bug')}
        hitSlop={6}
        onPress={openFeedback}
        style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}
        testID="status-bar-feedback-trigger">
        <SemanticIcon decorative name="bug" size="sm" />
        {showSuffix ? (
          <AppText
            numberOfLines={1}
            style={styles.suffix}
            testID={`${testID}-feedback-suffix`}>
            {t('feedback.openShort', 'Report bug')}
          </AppText>
        ) : null}
      </Pressable>
    </View>
  );
}

HelpSegment.displayName = 'HelpSegment';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  buttonPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  kbd: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  kbdText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
  },
  suffix: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
});
