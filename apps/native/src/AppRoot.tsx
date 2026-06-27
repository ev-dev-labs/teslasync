import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from './components/ui/AppText';
import { RouteParityPanel } from './components/navigation/RouteParityPanel';
import { ShellNavigation } from './components/navigation/ShellNavigation';
import { ShellStatusPanel } from './components/navigation/ShellStatusPanel';
import {
  getRoutesForNativeTarget,
  routes,
  type RouteId,
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
import { colors, spacing } from './theme/tokens';
import { ShellVisualParityFrame } from './visual-parity/ShellVisualParityFrame';
import { isVisualParityShellEnabled } from './visual-parity/visualParityMode';
import {WebParityShell} from './web-parity-integration/WebParityShell';

const COMPACT_SHELL_WIDTH = 760;

// Render the full web-parity surface (all 100+ converted route pages) instead of
// the legacy thin-screen summary shell. Flip to false to fall back to the legacy
// 9-screen InteractiveAppRoot.
const USE_WEB_PARITY_SHELL = true;

export function AppRoot() {
  const scheme = useColorScheme();

  if (isVisualParityShellEnabled()) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar
          barStyle={scheme === 'light' ? 'dark-content' : 'light-content'}
          backgroundColor={colors.background}
        />
        <ShellVisualParityFrame />
      </SafeAreaView>
    );
  }

  if (USE_WEB_PARITY_SHELL) {
    return <WebParityShell />;
  }

  return <InteractiveAppRoot scheme={scheme} />;
}

function InteractiveAppRoot({ scheme }: { scheme: ReturnType<typeof useColorScheme> }) {
  const dimensions = useWindowDimensions();
  const [activeRoute, setActiveRoute] = useState<RouteId>('dashboard');
  const handledDeepLinkURL = useRef<string | null>(null);
  const platformStatus = usePlatformIntegrationStatus();
  const compact = dimensions.width < COMPACT_SHELL_WIDTH;
  const activeMeta =
    routes.find(route => route.id === activeRoute) ?? routes[0];
  const activeMappedRoutes = useMemo(
    () => getRoutesForNativeTarget(activeRoute),
    [activeRoute],
  );
  const navigateToRoute = useCallback((routeId: RouteId) => {
    setActiveRoute(routeId);
  }, []);

  const screen = useMemo(() => {
    switch (activeRoute) {
      case 'dashboard':
        return <DashboardScreen onNavigate={navigateToRoute} />;
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
  }, [activeRoute, navigateToRoute, platformStatus]);

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
    navigateToRoute(deepLink.routeId);
  }, [
    navigateToRoute,
    platformStatus.initialDeepLink,
    platformStatus.lastDeepLink,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={scheme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={colors.background}
      />
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
      <View
        style={[styles.shell, compact && styles.compactShell]}
        testID={compact ? 'shell-layout-compact' : 'shell-layout-desktop'}
      >
        <ShellNavigation
          activeRoute={activeRoute}
          compact={compact}
          onNavigate={navigateToRoute}
        />

        <View style={styles.content}>
          <View style={[styles.header, compact && styles.compactHeader]}>
            <View>
              <AppText
                variant="display"
                style={compact ? styles.compactDisplay : undefined}
              >
                {activeMeta.label}
              </AppText>
              <AppText tone="secondary">{activeMeta.description}</AppText>
            </View>
            <ShellStatusPanel compact={compact} platformStatus={platformStatus} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {screen}
            <RouteParityPanel
              compact={compact}
              route={activeMeta}
              mappedRoutes={activeMappedRoutes}
            />
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
  compactShell: {
    flexDirection: 'column',
    gap: spacing.md,
    padding: spacing.md,
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
  compactHeader: {
    flexDirection: 'column',
  },
  compactDisplay: {
    fontSize: 28,
    lineHeight: 34,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
});
