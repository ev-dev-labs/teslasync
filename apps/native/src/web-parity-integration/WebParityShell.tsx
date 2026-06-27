import React, {Component, useMemo, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {QueryClientProvider} from '@tanstack/react-query';

import {createQueryClient} from '../web-parity/api/queryClient';
import {ThemeProvider} from '../web-parity/components/ui/ThemeProvider';
import {ROUTE_REGISTRY, type RouteEntry} from '../web-parity/lib/routeRegistry';
import {AppText} from '../components/ui/AppText';
import {colors, spacing} from '../theme/tokens';
import {WEB_PARITY_PAGES} from './pages.generated';

const COMPACT_SHELL_WIDTH = 760;

// Route `name` values whose page file does not follow the `${name}Page` convention.
const ROUTE_PAGE_OVERRIDES: Record<string, string> = {
  Automations: 'AutomationsListPage',
  Charging: 'ChargingListPage',
  ChargeDetail: 'ChargingDetailPage',
  Drives: 'DrivesListPage',
  Vehicles: 'VehicleListPage',
  Trips: 'TripListPage',
  TrueCostOwnership: 'TrueCostPage',
  DBHealthDashboard: 'DBHealthPage',
  LiveMap: 'MapOverviewPage',
  NotificationsAlerts: 'AlertsListPage',
  NotificationsArchived: 'ArchivedPage',
  NotificationsAudit: 'AuditLogPage',
  NotificationsBrowser: 'BrowserNotificationsPage',
  NotificationsChannels: 'ChannelsPage',
  NotificationsInbox: 'InboxPage',
  NotificationsQuietHours: 'QuietHoursPage',
  NotificationsRules: 'AlertRulesPage',
  NotificationsStudio: 'AlertStudioPage',
  NotificationsWebhooks: 'WebhooksPage',
  LegacyAlertsRedirect: 'AlertsListPage',
  LegacyAlertRulesRedirect: 'AlertRulesPage',
  LegacyAlertStudioRedirect: 'AlertStudioPage',
  LegacyNotificationsRedirect: 'InboxPage',
};

function resolvePageKey(route: RouteEntry): string {
  return ROUTE_PAGE_OVERRIDES[route.name] ?? `${route.name}Page`;
}

const queryClient = createQueryClient();

// Routes shown in the navigation rail (deep-link / parameterised routes hidden).
const NAV_ROUTES = ROUTE_REGISTRY.filter(r => !r.hidden);

interface PageBoundaryProps {
  routeName: string;
  children: ReactNode;
}
interface PageBoundaryState {
  error: Error | null;
}

class PageErrorBoundary extends Component<PageBoundaryProps, PageBoundaryState> {
  state: PageBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): PageBoundaryState {
    return {error};
  }

  componentDidUpdate(prev: PageBoundaryProps): void {
    if (prev.routeName !== this.props.routeName && this.state.error) {
      this.setState({error: null});
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.placeholder}>
          <AppText variant="title">Render error</AppText>
          <AppText tone="secondary" style={styles.placeholderBody}>
            {this.props.routeName}: {this.state.error.message}
          </AppText>
        </View>
      );
    }
    return this.props.children;
  }
}

export function WebParityShell(): React.ReactElement {
  const dimensions = useWindowDimensions();
  const compact = dimensions.width < COMPACT_SHELL_WIDTH;
  const [activePath, setActivePath] = useState<string>('/');

  const activeRoute =
    NAV_ROUTES.find(r => r.path === activePath) ?? NAV_ROUTES[0];

  const ActivePage = useMemo(() => {
    const key = resolvePageKey(activeRoute);
    return WEB_PARITY_PAGES[key] ?? null;
  }, [activeRoute]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.shell, compact && styles.compactShell]}>
            <ScrollView
              style={[styles.nav, compact && styles.compactNav]}
              contentContainerStyle={styles.navContent}
              horizontal={compact}>
              {NAV_ROUTES.map(route => {
                const active = route.path === activeRoute.path;
                return (
                  <Pressable
                    key={route.path}
                    onPress={() => setActivePath(route.path)}
                    style={[styles.navItem, active && styles.navItemActive]}>
                    <AppText
                      numberOfLines={1}
                      tone={active ? 'primary' : 'secondary'}
                      style={active ? styles.navLabelActive : undefined}>
                      {route.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.content}>
              <ScrollView contentContainerStyle={styles.pageScroll}>
                <PageErrorBoundary routeName={activeRoute.name}>
                  {ActivePage ? (
                    <ActivePage />
                  ) : (
                    <View style={styles.placeholder}>
                      <AppText variant="title">Not yet mapped</AppText>
                      <AppText tone="secondary" style={styles.placeholderBody}>
                        {activeRoute.label} ({resolvePageKey(activeRoute)})
                      </AppText>
                    </View>
                  )}
                </PageErrorBoundary>
              </ScrollView>
            </View>
          </View>
        </SafeAreaView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: colors.background},
  shell: {flex: 1, flexDirection: 'row'},
  compactShell: {flexDirection: 'column'},
  nav: {maxWidth: 260, borderRightWidth: 1, borderRightColor: colors.border},
  compactNav: {maxWidth: undefined, maxHeight: 64, borderRightWidth: 0},
  navContent: {padding: spacing.sm, gap: 2},
  navItem: {paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 10},
  navItemActive: {backgroundColor: colors.surfaceSelected},
  navLabelActive: {fontWeight: '600'},
  content: {flex: 1, minWidth: 0},
  pageScroll: {padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl},
  placeholder: {padding: spacing.xl, gap: spacing.sm},
  placeholderBody: {marginTop: spacing.xs},
});
