// Native parity port of web/src/components/ui/Tabs.tsx.
//
// The web component implements the WAI-ARIA Tabs pattern on the DOM: a
// `<div role="tablist">` whose children are `<button role="tab">` controls with
// `aria-selected`, a roving `tabindex` (only the active tab is in the document
// tab order), `aria-controls` pointing at the consumer-owned panels, and a
// `useId()`-derived id scheme (`{tablistId}-tab-{key}`). Left/Right arrows move
// focus AND activation between enabled tabs (Home/End jump to first/last,
// disabled tabs are skipped), with the focus deferred one frame via
// requestAnimationFrame so React commits the `aria-selected` change first. None
// of the DOM pieces exist in this React Native parity workspace, so the port
// rebuilds the contract with RN primitives while preserving the public API and
// the selection behaviour (see the parity sidecar for the line-by-line mapping):
//
//   • <div role="tablist">          -> View accessibilityRole="tablist" +
//                                      accessibilityLabel (the web `ariaLabel`).
//   • <button role="tab">           -> Pressable accessibilityRole="tab".
//   • aria-selected={selected}      -> accessibilityState={{selected}}.
//   • disabled tab                  -> Pressable `disabled` + accessibilityState
//                                      {{disabled}}; cursor-not-allowed/opacity-50
//                                      become an opacity:0.5 dim (RN has no cursor).
//   • onClick -> onChange(key)      -> onPress -> onChange(key) (unchanged).
//   • useId() + `{id}-tab-{key}`    -> useId() + nativeID `{id}-tab-{key}` (kept so
//                                      consumer panels can still link back).
//   • aria-controls `{id}-panel-..` -> no RN cross-element control association;
//                                      the component still "does not own the tab
//                                      panels", so this is dropped (documented).
//   • roving tabindex + Arrow/Home/  -> physical-key roving navigation is a
//     End onKeyDown + rAF focus         desktop/web keyboard affordance with no
//                                       touch analog: native instead exposes each
//                                       tab as an independent accessibility element
//                                       (swipe + double-tap to activate). The exact
//                                       navigation arithmetic (Arrow wrap-around,
//                                       Home/End, skip-disabled) is preserved
//                                       verbatim in the exported, unit-tested
//                                       `getNextEnabledTabKey` helper for hosts on
//                                       keyboard-capable platforms.
//   • focus-visible:ring / transition-colors -> no RN analog (dropped); the active
//                                      tab is still distinguished by colour + a 2px
//                                      bottom border.
//   • cn() Tailwind + CSS vars      -> StyleSheet + theme tokens (blue-600 active
//                                      -> colors.accent, --text-muted -> textMuted,
//                                      gray border -> a subtle white hairline).
//   • DOM-only `className`          -> `style` (StyleProp<ViewStyle>); a native
//                                      `testID` is added for composition.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useId} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export interface TabItem {
  key: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (key: string) => void;
  /** Native composition hook replacing the DOM-only `className`. */
  style?: StyleProp<ViewStyle>;
  /** Optional accessible label for the tablist (web `ariaLabel`). */
  ariaLabel?: string;
  testID?: string;
}

/** The arrow/Home/End keys the web tablist responds to. */
export type TabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/**
 * Pure port of the web tablist's roving keyboard navigation arithmetic.
 *
 * Given the list of currently-enabled tab keys (disabled tabs already filtered
 * out, mirroring the web `enabledKeys`), the focused key, and the pressed
 * navigation key, returns the next key to activate — or `null` when navigation
 * is a no-op. ArrowRight/ArrowLeft step forward/back with wrap-around, Home/End
 * jump to the first/last enabled tab, and an unknown current key is ignored for
 * the arrows (exactly like the web `idx === -1` guard).
 *
 * On native touch surfaces there is no physical-key navigation, so this is not
 * wired to a rendered key event; it is exported so keyboard-capable hosts
 * (react-native-web / -windows / -macos) and the unit tests can drive the same
 * behaviour the web component provides. Activation is immediate (the caller
 * should fire `onChange` with the returned key), matching the web's automatic
 * activation.
 */
export function getNextEnabledTabKey(
  enabledKeys: string[],
  currentKey: string,
  key: TabNavigationKey,
): string | null {
  if (enabledKeys.length === 0) {
    return null;
  }
  if (key === 'Home') {
    return enabledKeys[0];
  }
  if (key === 'End') {
    return enabledKeys[enabledKeys.length - 1];
  }
  const idx = enabledKeys.indexOf(currentKey);
  if (idx === -1) {
    return null;
  }
  const delta = key === 'ArrowRight' ? 1 : -1;
  const nextIdx = (idx + delta + enabledKeys.length) % enabledKeys.length;
  return enabledKeys[nextIdx];
}

/**
 * Accessible tab strip (native parity of the web WAI-ARIA Tabs widget). Renders
 * a `tablist` of `tab` controls; tapping an enabled tab fires `onChange(key)`.
 * The component does not own the tab panels — consumers render them and may link
 * back to a tab's generated `nativeID` (`{tablistId}-tab-{key}`).
 */
export function Tabs({
  tabs,
  activeTab,
  onChange,
  style,
  ariaLabel,
  testID,
}: TabsProps) {
  const tablistId = useId();

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={ariaLabel}
      style={[styles.tablist, style]}
      testID={testID}>
      {tabs.map(tab => {
        const selected = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            nativeID={`${tablistId}-tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{selected, disabled: !!tab.disabled}}
            disabled={tab.disabled}
            onPress={() => onChange(tab.key)}
            testID={testID ? `${testID}-tab-${tab.key}` : undefined}
            style={({pressed}) => [
              styles.tab,
              selected ? styles.tabSelected : null,
              tab.disabled ? styles.tabDisabled : null,
              pressed && !tab.disabled ? styles.tabPressed : null,
            ]}>
            <AppText
              numberOfLines={1}
              style={[
                styles.tabLabel,
                selected ? styles.tabLabelSelected : null,
              ]}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

Tabs.displayName = 'Tabs';

const styles = StyleSheet.create({
  tablist: {
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tab: {
    // A transparent 2px bottom border on every tab reserves the space so the
    // selected accent border (below) never shifts the row's height.
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabSelected: {
    borderBottomColor: colors.accent,
  },
  tabDisabled: {
    opacity: 0.5,
  },
  tabPressed: {
    opacity: 0.7,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  tabLabelSelected: {
    color: colors.accent,
  },
});
