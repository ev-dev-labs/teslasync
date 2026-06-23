import React, { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from './components/ui/AppText';
import { GlassPanel } from './components/ui/GlassPanel';
import { NavItem } from './components/navigation/NavItem';
import { routes, type RouteId } from './navigation/routes';
import { DashboardScreen } from './screens/DashboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { colors, layout, shadows, spacing } from './theme/tokens';

export function AppRoot() {
  const scheme = useColorScheme();
  const [activeRoute, setActiveRoute] = useState<RouteId>('dashboard');
  const activeMeta = routes.find(route => route.id === activeRoute) ?? routes[0];

  const screen = useMemo(() => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardScreen />;
      case 'vehicles':
        return <VehiclesScreen />;
      case 'settings':
        return <SettingsScreen />;
    }
  }, [activeRoute]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={scheme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.background}
      />
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
      <View style={styles.shell}>
        <GlassPanel style={styles.sidebar}>
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

          <View style={styles.navList}>
            {routes.map(route => (
              <NavItem
                key={route.id}
                route={route}
                selected={route.id === activeRoute}
                onPress={() => setActiveRoute(route.id)}
              />
            ))}
          </View>

          <View style={styles.platformPill}>
            <AppText variant="caption">React Native</AppText>
            <AppText variant="caption" tone="muted">
              {Platform.OS}
            </AppText>
          </View>
        </GlassPanel>

        <View style={styles.content}>
          <View style={styles.header}>
            <View>
              <AppText variant="display">{activeMeta.label}</AppText>
              <AppText tone="secondary">{activeMeta.description}</AppText>
            </View>
            <GlassPanel style={styles.statusCard}>
              <AppText variant="caption">Native parity track</AppText>
              <AppText weight="semibold" tone="accent">
                Phase 0 foundation
              </AppText>
            </GlassPanel>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            {screen}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -160,
    right: -120,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: colors.glowCyan,
    opacity: 0.32,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -180,
    left: -140,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.glowViolet,
    opacity: 0.24,
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sidebar: {
    width: layout.sidebarWidth,
    padding: spacing.lg,
    justifyContent: 'space-between',
    ...shadows.panel,
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
  navList: {
    gap: spacing.sm,
  },
  platformPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  statusCard: {
    minWidth: 220,
    padding: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
});
