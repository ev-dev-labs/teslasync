import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { RouteDefinition } from '../../navigation/routes';
import { colors, spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';

interface NavItemProps {
  compact?: boolean;
  route: RouteDefinition;
  selected: boolean;
  onPress: () => void;
}

export function NavItem({
  compact = false,
  route,
  selected,
  onPress,
}: NavItemProps) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityHint={`Switches to the ${route.label} native route.`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={route.label}
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        compact && styles.compactRoot,
        selected && styles.selected,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
      testID={`nav-item-${route.id}`}
    >
      <View style={[styles.icon, selected && styles.selectedIcon]}>
        <AppText
          weight="bold"
          style={selected ? styles.selectedIconText : styles.iconText}
        >
          {route.icon}
        </AppText>
      </View>
      <View style={styles.copy}>
        <AppText weight="semibold">{route.label}</AppText>
        {!compact ? (
          <AppText variant="caption" tone="muted">
            {route.shortDescription}
          </AppText>
        ) : null}
        <AppText
          variant="caption"
          tone={route.parity.pending === 0 ? 'accent' : 'muted'}
        >
          {route.parity.implemented}/{route.parity.total} implemented
          {route.parity.pending > 0 ? `, ${route.parity.pending} unresolved` : ''}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  compactRoot: {
    minWidth: 188,
  },
  selected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  focused: {
    borderColor: colors.accent,
  },
  pressed: {
    opacity: 0.82,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  selectedIcon: {
    backgroundColor: colors.accent,
  },
  iconText: {
    color: colors.textSecondary,
  },
  selectedIconText: {
    color: colors.background,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
