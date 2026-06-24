import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  getRoutesForNativeTarget,
  routeGroupParitySummaries,
  routeGroupLabels,
  routeGroups,
  routeParitySummary,
  routes,
  type RouteDefinition,
  type RouteId,
  type WebRouteDefinition,
} from './navigation/routes';
import { usePlatformIntegrationStatus } from './platform/status';
import { AlertsScreen } from './screens/AlertsScreen';
import { AuthScreen } from './screens/AuthScreen';
import { ChargingScreen } from './screens/ChargingScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { DrivingScreen } from './screens/DrivingScreen';
import { EnergyScreen } from './screens/EnergyScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SystemScreen } from './screens/SystemScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';
import { colors, layout, shadows, spacing } from './theme/tokens';

export function AppRoot() {
  const scheme = useColorScheme();
  const [activeRoute, setActiveRoute] = useState<RouteId>('dashboard');
  const handledDeepLinkURL = useRef<string | null>(null);
  const platformStatus = usePlatformIntegrationStatus();
  const activeMeta =
    routes.find(route => route.id === activeRoute) ?? routes[0];
  const activeMappedRoutes = useMemo(
    () => getRoutesForNativeTarget(activeRoute),
    [activeRoute],
  );

  const screen = useMemo(() => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardScreen />;
      case 'vehicles':
        return <VehiclesScreen />;
      case 'charging':
        return <ChargingScreen />;
      case 'driving':
        return <DrivingScreen />;
      case 'energy':
        return <EnergyScreen />;
      case 'alerts':
        return <AlertsScreen />;
      case 'system':
        return <SystemScreen />;
      case 'auth':
        return <AuthScreen />;
      case 'settings':
        return <SettingsScreen platformStatus={platformStatus} />;
    }
  }, [activeRoute, platformStatus]);

  useEffect(() => {
    const deepLink =
      platformStatus.lastDeepLink ?? platformStatus.initialDeepLink;
    if (
      !deepLink?.matched ||
      !deepLink.routeId ||
      handledDeepLinkURL.current === deepLink.url
    ) {
      return;
    }
    handledDeepLinkURL.current = deepLink.url;
    setActiveRoute(deepLink.routeId);
  }, [platformStatus.initialDeepLink, platformStatus.lastDeepLink]);

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
            {routeGroups.map(group => (
              <View key={group} style={styles.navGroup}>
                <AppText variant="caption" tone="muted" weight="semibold">
                  {routeGroupLabels[group]}
                </AppText>
                {routes
                  .filter(route => route.group === group)
                  .map(route => (
                    <NavItem
                      key={route.id}
                      route={route}
                      selected={route.id === activeRoute}
                      onPress={() => setActiveRoute(route.id)}
                    />
                  ))}
              </View>
            ))}
          </View>

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
            <AppText variant="caption" tone="muted">
              lifecycle: {platformStatus.appState}
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
              <AppText variant="caption">Native route parity</AppText>
              <AppText weight="semibold" tone="accent">
                {routeParitySummary.implemented}/{routeParitySummary.total}{' '}
                implemented
              </AppText>
              <AppText variant="caption" tone="muted">
                {routeParitySummary.pending} unresolved routes
              </AppText>
              <View style={styles.groupSummaryList}>
                <AppText variant="caption" tone="muted">
                  Unresolved by group
                </AppText>
                {routeGroupParitySummaries.map(groupSummary => (
                  <View
                    key={groupSummary.group}
                    style={styles.groupSummaryRow}
                  >
                    <AppText variant="caption" tone="muted">
                      {groupSummary.label}
                    </AppText>
                    <AppText variant="caption" weight="semibold">
                      {groupSummary.pending}
                    </AppText>
                  </View>
                ))}
              </View>
            </GlassPanel>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {screen}
            <RouteParityPanel
              route={activeMeta}
              mappedRoutes={activeMappedRoutes}
            />
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

interface RouteParityPanelProps {
  route: RouteDefinition;
  mappedRoutes: WebRouteDefinition[];
}

function RouteParityPanel({ route, mappedRoutes }: RouteParityPanelProps) {
  return (
    <GlassPanel style={styles.routePanel}>
      <View style={styles.parityHeader}>
        <View style={styles.parityCopy}>
          <AppText variant="title" weight="bold">
            Route parity evidence
          </AppText>
          <AppText tone="secondary">
            {route.label} owns {route.parity.total} web routes from
            web/src/App.tsx and renders native evidence for each.
          </AppText>
        </View>
        <View style={styles.parityStats}>
          <View style={styles.parityStat}>
            <AppText variant="caption" tone="muted">
              Implemented
            </AppText>
            <AppText weight="bold" tone="accent">
              {route.parity.implemented}
            </AppText>
          </View>
          <View style={styles.parityStat}>
            <AppText variant="caption" tone="muted">
              Unresolved
            </AppText>
            <AppText
              weight="bold"
              tone={route.parity.pending === 0 ? 'accent' : 'danger'}
            >
              {route.parity.pending}
            </AppText>
          </View>
        </View>
      </View>

      {mappedRoutes.length === 0 ? (
        <AppText tone="secondary">
          No web routes are mapped to this native target.
        </AppText>
      ) : (
        <View style={styles.pendingList}>
          {mappedRoutes.map(mappedRoute => (
            <View key={mappedRoute.id} style={styles.pendingRoute}>
              <View style={styles.pendingRouteCopy}>
                <AppText weight="semibold">{mappedRoute.label}</AppText>
                <AppText variant="caption" tone="muted">
                  {mappedRoute.webPath}
                </AppText>
              </View>
              <AppText
                variant="caption"
                tone="muted"
                style={styles.pendingEvidence}
              >
                {mappedRoute.evidence}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </GlassPanel>
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
    gap: spacing.lg,
  },
  navGroup: {
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
    minWidth: 260,
    padding: spacing.md,
    gap: spacing.xs,
  },
  groupSummaryList: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  groupSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  routePanel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  parityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  parityCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  parityStats: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  parityStat: {
    minWidth: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  pendingList: {
    gap: spacing.sm,
  },
  pendingRoute: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  pendingRouteCopy: {
    minWidth: 180,
    gap: spacing.xs,
  },
  pendingEvidence: {
    flex: 1,
  },
});
