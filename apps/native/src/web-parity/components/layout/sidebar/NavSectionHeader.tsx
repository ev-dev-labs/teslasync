// Native parity port of web/src/components/layout/sidebar/NavSectionHeader.tsx.
//
// The web source is a quiet sidebar section header: a flex-row <div> wrapping a
// label <p> and an optional right-aligned action slot, composed with the cn()
// Tailwind class merger. Every web-only piece is adapted to React Native
// primitives (see the parity sidecar for the line-by-line mapping):
//   • <div> flex row            -> View (flexDirection row, space-between, gap)
//   • <p> label                 -> AppText (10px / 600 / uppercase / 0.14em (1.4px)
//                                  tracking / text-muted token)
//   • cn('flex...', className)   -> StyleSheet + a composable `style` prop
//   • id (aria-labelledby hook)  -> nativeID on the label so a sibling section can
//                                  reference it via accessibilityLabelledBy (the
//                                  native analog of aria-labelledby)
//   • className prop             -> style?: StyleProp<ViewStyle>
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

export interface NavSectionHeaderProps {
  /** Localized label text. */
  label: string;
  /** Optional right-aligned action slot (e.g. expand/collapse buttons). */
  action?: ReactNode;
  /**
   * When set, applied to the label (via nativeID) so consumers can pair section
   * content via accessibilityLabelledBy — the native analog of aria-labelledby.
   */
  id?: string;
  /** Native composition hook replacing the web `className`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Sidebar section header — a quiet, label-weight title used to group nav items.
 *
 * Visual rules (preserved from web):
 *   - 10px font, weight 600, uppercase, 0.14em (1.4px) tracking
 *   - text color: the muted text token (web text-[var(--text-muted)])
 *   - padding: px-3 py-1 (12 / 4), no extra margin — the parent container handles
 *     vertical rhythm
 *   - When `action` is provided, uses a flex row with the action shrunk to its
 *     intrinsic size; the label retains the same metrics so all sidebar headers
 *     read as one row, not as a button bar.
 */
export function NavSectionHeader({
  label,
  action,
  id,
  style,
  testID,
}: NavSectionHeaderProps) {
  return (
    <View style={[styles.row, style]} testID={testID}>
      <AppText nativeID={id} style={styles.label}>
        {label}
      </AppText>
      {action}
    </View>
  );
}

NavSectionHeader.displayName = 'NavSectionHeader';

export default NavSectionHeader;

const styles = StyleSheet.create({
  label: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.4,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
