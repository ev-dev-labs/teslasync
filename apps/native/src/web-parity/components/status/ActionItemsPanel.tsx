// Native parity port of web/src/components/status/ActionItemsPanel.tsx.
//
// Replaces the DOM <div>/<h3>, the lucide-react <CheckCircle /> empty-state
// icon, the `cn()` Tailwind class composer, and the shared web GlassPanel with
// React Native primitives (View/AppText), the native GlassPanel, and native
// theme tokens. The native app ships no lucide-react / SVG icon set, so the
// canonical "\u2713" check glyph stands in for the Lucide CheckCircle, matching
// the SeverityBadge / NotificationBellPopover text-glyph approach already used
// across the parity layer.
//
// Behavior preserved verbatim: the panel NEVER hides — when there are no
// children (or `forceEmpty` is set) it renders an explicit "Nothing right now"
// empty state so the operator can distinguish "healthy" from "broken".
// `Children.toArray(children).filter(Boolean)` is a React (not DOM) API and is
// carried through unchanged to count the rendered action items.
//
// The DOM-only `id` / `className` props have no native analog; `id` is mapped
// to the GlassPanel `testID` (closest current-state identity hook) and
// `className` is replaced by a native `style` composition prop. Both are
// documented in the parity sidecar.

import React, {Children, type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';

export interface ActionItemsPanelProps {
  /** Title shown at the top. Defaults to "Needs your attention". */
  title?: string;
  /** Action items rendered as children. Empty array / no children → empty state. */
  children: ReactNode;
  /** Force the empty state regardless of children. Useful for storybook / tests. */
  forceEmpty?: boolean;
  /** Override empty-state text. */
  emptyText?: string;
  /** Native identity hook replacing the web DOM `id` (mapped to GlassPanel testID). */
  id?: string;
  /** Native composition hook replacing the web `className`. */
  style?: StyleProp<ViewStyle>;
}

/**
 * ActionItemsPanel — operator task list.
 * NEVER hides — when no actions exist renders an explicit
 * "Nothing right now ✅" empty state so the operator can
 * distinguish "healthy" from "broken".
 */
export function ActionItemsPanel({
  title = 'Needs your attention',
  children,
  forceEmpty = false,
  emptyText = 'Nothing right now',
  id,
  style,
}: ActionItemsPanelProps) {
  const childArray = Children.toArray(children).filter(Boolean);
  const hasChildren = !forceEmpty && childArray.length > 0;

  return (
    <GlassPanel style={[styles.panel, style]} testID={id}>
      <View style={styles.header}>
        <AppText style={styles.title} weight="semibold">
          {title}
        </AppText>
      </View>

      {hasChildren ? (
        <View style={styles.items}>{children}</View>
      ) : (
        <View style={styles.empty}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.emptyIcon}>
            {'\u2713'}
          </AppText>
          <AppText style={styles.emptyText}>{emptyText}</AppText>
        </View>
      )}
    </GlassPanel>
  );
}

ActionItemsPanel.displayName = 'ActionItemsPanel';

const styles = StyleSheet.create({
  panel: {
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  items: {
    gap: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.successBorder,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 12,
  },
  emptyIcon: {
    color: colors.success,
    fontSize: 20,
    lineHeight: 20,
  },
  emptyText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
});
