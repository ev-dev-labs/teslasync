import React from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import {
  routeGroupLabels,
  routeGroups,
  routeParitySummary,
  routes,
  type RouteId,
} from '../../navigation/routes';
import { colors, layout, shadows, spacing } from '../../theme/tokens';
import { AppText } from '../ui/AppText';
import { GlassPanel } from '../ui/GlassPanel';
import { NavItem } from './NavItem';
import { RouteSearchPanel } from './RouteSearchPanel';

interface ShellNavigationProps {
  activeRoute: RouteId;
  compact: boolean;
  onNavigate: (route: RouteId) => void;
}

export function ShellNavigation({
  activeRoute,
  compact,
  onNavigate,
}: ShellNavigationProps) {
  return (
    <GlassPanel
      style={[styles.root, compact ? styles.compactRoot : styles.sidebar]}
      testID={compact ? 'shell-navigation-compact' : 'shell-navigation-sidebar'}
    >
      <View style={[styles.top, compact && styles.compactTop]}>
        <View style={styles.brand}>
          <View style={styles.logoMark}>
            <AppText weight="bold" style={styles.logoText}>
              T
            </AppText>
          </View>
          <View>
            <AppText variant="title">TeslaSync</AppText>
            <AppText variant="caption">Fleet Intelligence</AppText>
          </View>
        </View>

        <RouteSearchPanel
          activeRoute={activeRoute}
          compact={compact}
          onNavigate={onNavigate}
          style={compact ? styles.compactSearch : undefined}
        />
      </View>

      <ScrollView
        horizontal={compact}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={!compact}
        contentContainerStyle={[
          styles.navList,
          compact && styles.compactNavList,
        ]}
      >
        {routeGroups.map(group => (
          <View
            key={group}
            style={[styles.navGroup, compact && styles.compactNavGroup]}
          >
            <AppText variant="caption" tone="muted" weight="semibold">
              {routeGroupLabels[group]}
            </AppText>
            {routes
              .filter(route => route.group === group)
              .map(route => (
                <NavItem
                  compact={compact}
                  key={route.id}
                  route={route}
                  selected={route.id === activeRoute}
                  onPress={() => onNavigate(route.id)}
                />
              ))}
          </View>
        ))}
      </ScrollView>

      {!compact ? (
        <View style={styles.platformPill}>
          <AppText variant="caption">React Native</AppText>
          <AppText variant="caption" tone="muted">
            {Platform.OS}
          </AppText>
          <AppText variant="caption" tone="muted">
            {routeParitySummary.total} web routes tracked
          </AppText>
          <AppText variant="caption" tone="muted">
            {routeParitySummary.implemented} implemented
          </AppText>
          <AppText variant="caption" tone="muted">
            {routeParitySummary.pending} unresolved
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.panel,
  },
  sidebar: {
    width: layout.sidebarWidth,
    justifyContent: 'space-between',
  },
  compactRoot: {
    padding: spacing.md,
  },
  top: {
    gap: spacing.lg,
  },
  compactTop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  logoText: {
    color: colors.background,
    fontSize: 22,
  },
  compactSearch: {
    flexGrow: 1,
  },
  navList: {
    gap: spacing.lg,
  },
  compactNavList: {
    gap: spacing.md,
    paddingRight: spacing.md,
  },
  navGroup: {
    gap: spacing.sm,
  },
  compactNavGroup: {
    minWidth: 216,
  },
  platformPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
