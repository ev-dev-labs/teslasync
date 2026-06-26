// Native parity port of web/src/components/ui/PinButton.tsx.
//
// Shared "pin" affordance — a focusable icon-only (or icon + label) button that
// toggles the current user's pin state for a single item. The vendor-agnostic
// half is ported verbatim: the PinButtonProps contract (itemType, itemId,
// context, size, showLabel — the web `className` escape hatch is re-expressed as
// `style`), the usePinned(itemType, context) + useTogglePin(itemType)
// composition, the `idStr = String(itemId)` coercion, the
// `isPinned = pinned.some(p => String(p.item_id) === idStr)` membership test, the
// `toggle.isPending` guard, and the `toggle.mutate({ itemId, context, pin:
// !isPinned })` flip. Only the DOM / icon / i18n layer is re-expressed with
// React Native primitives:
//
//   - react-i18next `useTranslation` (web L1) -> inlined
//     `useNativeTranslationFallback()` returning the literal fallback string (the
//     native parity tree has no i18n runtime), matching the ContextMenu /
//     QueryError ports. Every key + default is preserved verbatim:
//     'pin.unpin'/'Unpin', 'pin.pin'/'Pin', 'pin.pinned'/'Pinned'.
//   - lucide-react `Pin` / `PinOff` (web L2): no native icon module. The web
//     swaps Pin<->PinOff AND flips the tint muted->amber to signal the pinned
//     state. The established native vocabulary for this pin/favorite affordance
//     is the tintable `★` glyph (cf. the LinearSidebar port's pin control + its
//     "Favorites" group), so both icons map to a single `★` AppText glyph whose
//     COLOUR carries the state — `--text-muted` when unpinned, amber-300 when
//     pinned — the exact `text-[var(--text-muted)]` -> `text-amber-300` flip the
//     web encoded (web L90-91). No monochrome pushpin glyph renders
//     reliably/tintably across iOS/Android/Windows/macOS, and the gold-star
//     idiom reads unambiguously as "pinned" both icon-only and beside the
//     "Pin"/"Pinned" label. The web `aria-hidden` on the icon (web L95) ->
//     `importantForAccessibility="no"` so the Pressable's accessibilityLabel
//     stays the accessible name.
//   - `./Tooltip` (web L7, L76, L104): the native ./Tooltip sibling is not ported
//     yet, and touch surfaces have no hover/focus tooltip. The wrapper only
//     surfaced the action label (identical to the button's own aria-label) and
//     wired `aria-describedby`; both are already covered by the Pressable's
//     `accessibilityLabel={tooltipLabel}`, so the wrapper is dropped rather than
//     importing an unported web UI module (per the conversion contract).
//   - `@/lib/cn` className composition (web L4, L84-93) -> RN `StyleSheet` style
//     arrays + a per-state colour computation. The web `className` prop (web L32,
//     L92) becomes `style?: StyleProp<ViewStyle>` merged onto the Pressable at
//     the same last position cn() appended it (the Drawer-port convention).
//   - The web click handler's `e.stopPropagation()` / `e.preventDefault()` (web
//     L69-70, stopping the enclosing row's onClick) have no DOM-bubbling
//     analogue: React Native's gesture-responder system grants a touch to the
//     innermost Pressable, so a parent row's onPress does not also fire — the
//     native isolation the web achieved via stopPropagation. Both calls are
//     dropped (documented), matching the ContextMenu port.
//   - `transition-colors`, the `focus:outline-none` / `focus-visible:ring` focus
//     ring (web L85-86), and `disabled:cursor-not-allowed` (web L87) have no RN
//     analogue and are dropped; `disabled:opacity-60` -> a 0.6-opacity disabled
//     style and the `disabled` Pressable prop. The web hover refinements
//     (`hover:bg-amber-500/10` / `hover:bg-[var(--surface-2)]`) become the
//     Pressable `pressed` background highlight; the secondary hover text-lighten
//     (`hover:text-amber-200` / `hover:text-[var(--text-primary)]`) is folded
//     into that pressed highlight so the resting state colour — the meaningful
//     pinned/unpinned signal — is preserved without a render-prop child.

import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { colors } from '../../../theme/tokens';
import { usePinned, useTogglePin } from '../../api/hooks/usePinned';
import type { PinnedItemType } from '../../api/types';

/**
 * Shared "pin" affordance.
 *
 * Renders a focusable icon-only button that toggles the user's pin state for a
 * single item. It composes the unified `usePinned` query so any open surface
 * (vehicle picker, alerts list, dashboard widgets, …) re-orders pinned-first the
 * moment a pin is added or removed.
 *
 * Backed by `pinned_items` (migration 000162) — survives a fresh app install,
 * syncs across devices, and replaces ad-hoc per-device stores.
 */
export interface PinButtonProps {
  /** Domain bucket — drives both the API call and the cache key. */
  itemType: PinnedItemType;
  /** Stable identifier for the row being pinned. Coerced to string. */
  itemId: string | number;
  /** Optional sub-surface scope (e.g. dashboardId for widget pins). */
  context?: string;
  /** Icon size. `sm` = compact list/table cell, `md` = card header. */
  size?: 'sm' | 'md';
  /** When true, render "Pin"/"Pinned" next to the icon. */
  showLabel?: boolean;
  /** Native analogue of the web `className` escape hatch — extra style merged
   *  onto the trigger Pressable at the same last position cn() appended it. */
  style?: StyleProp<ViewStyle>;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Exact web amber shades. No amber-300/200 token exists in the native theme, so
// the hex-literal convention used across the parity tree maps each Tailwind
// shade verbatim (cf. data-display/_tokens.ts, LiveIndicator, UsageCard).
const AMBER_PINNED = '#fcd34d'; // text-amber-300 — pinned resting tint
const AMBER_PRESSED_BG = 'rgba(245, 158, 11, 0.1)'; // hover:bg-amber-500/10

/** Shared icon-toggle button that pins / unpins a single item. */
export function PinButton({
  itemType,
  itemId,
  context,
  size = 'sm',
  showLabel = false,
  style,
}: PinButtonProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const { data: pinned = [] } = usePinned(itemType, context);
  const toggle = useTogglePin(itemType);

  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);

  const tooltipLabel = isPinned ? t('pin.unpin', 'Unpin') : t('pin.pin', 'Pin');
  const labelText = isPinned ? t('pin.pinned', 'Pinned') : t('pin.pin', 'Pin');
  const textColor = isPinned ? AMBER_PINNED : colors.textMuted;

  const handlePress = () => {
    // Pin buttons are routinely placed inside row cards / list items that
    // navigate on press. React Native's gesture-responder system grants the
    // touch to this innermost Pressable, so the row's own onPress does not also
    // fire — the native analogue of the web stopPropagation/preventDefault.
    if (toggle.isPending) {
      return;
    }
    toggle.mutate({ itemId: idStr, context, pin: !isPinned });
  };

  const boxStyle = size === 'sm' ? styles.boxSm : styles.boxMd;
  const containerSize = showLabel ? styles.withLabel : boxStyle;
  const iconSizeStyle = size === 'sm' ? styles.iconSm : styles.iconMd;

  return (
    <Pressable
      accessibilityLabel={tooltipLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: toggle.isPending, selected: isPinned }}
      disabled={toggle.isPending}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        containerSize,
        pressed && (isPinned ? styles.pinnedPressed : styles.defaultPressed),
        toggle.isPending && styles.disabled,
        style,
      ]}
      testID="pin-button"
    >
      <AppText
        importantForAccessibility="no"
        style={[styles.icon, iconSizeStyle, { color: textColor }]}
      >
        ★
      </AppText>
      {showLabel ? (
        <AppText
          importantForAccessibility="no"
          style={[styles.label, { color: textColor }]}
        >
          {labelText}
        </AppText>
      ) : null}
    </Pressable>
  );
}
PinButton.displayName = 'PinButton';

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 6, // rounded-md
    flexDirection: 'row',
    gap: 6, // gap-1.5
    justifyContent: 'center',
  },
  boxMd: {
    height: 32, // h-8
    width: 32, // w-8
  },
  boxSm: {
    height: 28, // h-7
    width: 28, // w-7
  },
  defaultPressed: {
    backgroundColor: colors.surfaceRaised, // hover:bg-[var(--surface-2)]
  },
  disabled: {
    opacity: 0.6, // disabled:opacity-60
  },
  icon: {
    textAlign: 'center',
  },
  iconMd: {
    fontSize: 16, // h-4 w-4
    lineHeight: 18,
  },
  iconSm: {
    fontSize: 14, // h-3.5 w-3.5
    lineHeight: 16,
  },
  label: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
  },
  pinnedPressed: {
    backgroundColor: AMBER_PRESSED_BG,
  },
  withLabel: {
    paddingHorizontal: 8, // px-2
    paddingVertical: 4,
  },
});
