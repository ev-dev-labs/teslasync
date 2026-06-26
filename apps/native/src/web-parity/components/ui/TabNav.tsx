// Native parity port of web/src/components/ui/TabNav.tsx.
//
// Shared `<TabNav>` primitive — a horizontal, icon-capable tab strip. The
// vendor-agnostic contract is preserved verbatim: the
// `{ tabs, active, onChange }` prop surface (web L5) with `tabs` as an array of
// `{ key, label, icon? }` (web L5), the `tabs.map(t => …)` render keyed by
// `t.key` (web L8, L10), the `onChange(t.key)` activation (web L11), the
// `active === t.key` selected test (web L14), and the icon-then-label child
// order (web L19-20). Only the DOM / styling layer is re-expressed with React
// Native primitives:
//
//   - `clsx` className composition (web L2, L12-17) -> RN `StyleSheet` style
//     arrays + per-state style maps (the cn()/clsx -> StyleSheet convention used
//     across this parity tree, cf. the PinButton / ContextMenu ports).
//   - The container `<div>` (web L7) carried both the visible frame
//     (`rounded-xl bg-white/[0.02] p-1 border border-white/[0.06]`) AND
//     horizontal overflow scrolling (`overflow-x-auto scrollbar-thin`). The
//     faithful native analogue of an overflow-x-auto flex row is a horizontal
//     `ScrollView`: the frame (background, 1px border, rounded-xl) lives on its
//     outer `style`, while the inner row layout (`flex items-center gap-1` +
//     the `p-1` inset) lives on `contentContainerStyle` so the tabs sit inside
//     the border exactly as the web padding did. `scrollbar-thin` has no RN
//     analogue; the strip hides its scroll indicator
//     (`showsHorizontalScrollIndicator={false}`) for a clean tab bar, the
//     established native convention for a horizontally-scrolling chip/tab row.
//   - Each tab `<button>` (web L9-21) -> a `Pressable`; `onClick` (web L11) ->
//     `onPress`; `key={t.key}` (web L10) preserved. The button's responsive
//     `sm:` upscales (`sm:gap-2 sm:px-4 sm:py-2 sm:text-sm`, web L13) have no RN
//     viewport-breakpoint analogue, so the mobile-first BASE sizing is used
//     (`gap-1.5`=6, `px-2.5`=10, `py-1.5`=6, `text-xs`=12) — the value the web
//     renders below the `sm` breakpoint, i.e. on phone widths. `rounded-lg`=8,
//     `font-medium`=500, `shrink-0` -> `flexShrink: 0`, `whitespace-nowrap` ->
//     `numberOfLines={1}` on the label. `transition-all duration-normal` has no
//     RN analogue and is dropped.
//   - Active vs inactive styling (web L14-17): active
//     `bg-white/[0.08] text-[var(--text-primary)] shadow-sm` -> a filled pill
//     (`styles.tabActive` background rgba(255,255,255,0.08) + a small
//     `shadow-sm`-equivalent elevation/shadow) with the label tinted
//     `colors.textPrimary`; inactive `text-[var(--text-muted)]` -> the label
//     tinted `colors.textMuted` with a transparent background. The inactive
//     `hover:text-[var(--text-secondary)]` (web L16) is a hover-only TEXT
//     retint; on a touch surface its analogue is the pressed state, so an
//     inactive tab's label brightens to `colors.textSecondary` while pressed
//     (active tabs have no hover rule, so they stay primary while pressed).
//   - Text colour does not cascade from a `Pressable`/`View` to a child the way
//     the web button's `currentColor` did, so the active/inactive/pressed tint
//     is applied directly to the label `AppText`. The optional `icon` ReactNode
//     (web L19) is rendered verbatim before the label (the caller owns the
//     icon's own colour, matching the ContextMenu icon handling) — `t.icon`
//     being `undefined` renders nothing, exactly as on the web.
//   - Semantics: the generic `<button>` group is given the explicit
//     `accessibilityRole="tab"` (with `accessibilityState.selected`) inside an
//     `accessibilityRole="tablist"` strip, and `accessibilityLabel={t.label}`
//     keeps the label as each tab's accessible name.

import React, { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { colors } from '../../../theme/tokens';

/** A single tab entry. */
export interface TabNavItem {
  /** Stable identifier — used as the React key and passed to `onChange`. */
  key: string;
  /** Visible tab label. */
  label: string;
  /** Optional leading icon node, rendered verbatim before the label. */
  icon?: ReactNode;
}

export interface TabNavProps {
  /** Ordered list of tabs to render. */
  tabs: TabNavItem[];
  /** Key of the currently active tab. */
  active: string;
  /** Invoked with the pressed tab's key. */
  onChange: (key: string) => void;
}

// Exact web alpha-white shades. The native theme has no token for these literal
// rgba(255,255,255,…) overlays, so they are mapped verbatim following the
// hex/rgba-literal convention used across the parity tree (cf. PinButton).
const BAR_BG = 'rgba(255, 255, 255, 0.02)'; // bg-white/[0.02]
const BAR_BORDER = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]
const ACTIVE_BG = 'rgba(255, 255, 255, 0.08)'; // bg-white/[0.08]

/** Horizontal tab navigation bar with icon support. */
export function TabNav({
  tabs,
  active,
  onChange,
}: TabNavProps): React.ReactElement {
  return (
    <ScrollView
      accessibilityRole="tablist"
      contentContainerStyle={styles.barContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
    >
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <Pressable
            accessibilityLabel={t.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.tab, isActive && styles.tabActive]}
            testID={`tab-nav-${t.key}`}
          >
            {({ pressed }) => (
              <>
                {t.icon}
                <AppText
                  numberOfLines={1}
                  style={[
                    styles.label,
                    isActive
                      ? styles.labelActive
                      : pressed
                        ? styles.labelInactivePressed
                        : styles.labelInactive,
                  ]}
                >
                  {t.label}
                </AppText>
              </>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
TabNav.displayName = 'TabNav';

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BAR_BG,
    borderColor: BAR_BORDER,
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
  },
  barContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4, // gap-1
    padding: 4, // p-1
  },
  label: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  labelActive: {
    color: colors.textPrimary, // text-[var(--text-primary)]
  },
  labelInactive: {
    color: colors.textMuted, // text-[var(--text-muted)]
  },
  labelInactivePressed: {
    color: colors.textSecondary, // hover:text-[var(--text-secondary)]
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8, // rounded-lg
    flexDirection: 'row',
    flexShrink: 0, // shrink-0
    gap: 6, // gap-1.5
    paddingHorizontal: 10, // px-2.5
    paddingVertical: 6, // py-1.5
  },
  tabActive: {
    backgroundColor: ACTIVE_BG,
    elevation: 1, // shadow-sm
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
});
