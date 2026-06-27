import React, {Component, useMemo, useState, type ComponentType, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';
import {QueryClientProvider} from '@tanstack/react-query';

import {createQueryClient} from '../web-parity/api/queryClient';
import {ThemeProvider} from '../web-parity/components/ui/ThemeProvider';
import Layout from '../web-parity/components/layout/Layout';
import {ROUTE_REGISTRY, type RouteEntry} from '../web-parity/lib/routeRegistry';
import {AppText} from '../components/ui/AppText';
import {colors, spacing} from '../theme/tokens';
import {WEB_PARITY_PAGES} from './pages.generated';

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

function pageKeyForRoute(route: RouteEntry): string {
  return ROUTE_PAGE_OVERRIDES[route.name] ?? `${route.name}Page`;
}

// Resolve a sidebar nav path (may carry a #fragment or ?query) to a page component.
function resolvePageByPath(path: string): {
  Page: ComponentType<any> | null;
  route: RouteEntry | null;
} {
  const clean = (path || '/').split('#')[0].split('?')[0] || '/';
  let route = ROUTE_REGISTRY.find(r => r.path === clean) ?? null;
  if (!route) {
    // Longest static-prefix match for nested/param paths (e.g. /settings/safety).
    const candidates = ROUTE_REGISTRY.filter(
      r => !r.path.includes(':') && r.path !== '/' && clean.startsWith(r.path),
    ).sort((a, b) => b.path.length - a.path.length);
    route = candidates[0] ?? null;
  }
  if (!route) {
    return {Page: null, route: null};
  }
  return {Page: WEB_PARITY_PAGES[pageKeyForRoute(route)] ?? null, route};
}

const queryClient = createQueryClient();

interface PageBoundaryProps {
  routeKey: string;
  children: ReactNode;
}
class PageErrorBoundary extends Component<PageBoundaryProps, {error: Error | null}> {
  state = {error: null as Error | null};
  static getDerivedStateFromError(error: Error) {
    return {error};
  }
  componentDidUpdate(prev: PageBoundaryProps) {
    if (prev.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({error: null});
    }
  }
  render() {
    if (this.state.error) {
      return (
        <View style={styles.placeholder}>
          <AppText variant="title">Render error</AppText>
          <AppText tone="secondary" style={styles.placeholderBody}>
            {this.props.routeKey}: {this.state.error.message}
          </AppText>
        </View>
      );
    }
    return this.props.children;
  }
}

export function WebParityShell(): React.ReactElement {
  const [activePath, setActivePath] = useState<string>('/');

  const {Page, route} = useMemo(() => resolvePageByPath(activePath), [activePath]);

  const handleNavigate = (to: string) => {
    setActivePath(to);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Layout currentPath={activePath} onNavigate={handleNavigate}>
          <PageErrorBoundary routeKey={activePath}>
            {Page ? (
              <Page />
            ) : (
              <View style={styles.placeholder}>
                <AppText variant="title">{route?.label ?? 'Not found'}</AppText>
                <AppText tone="secondary" style={styles.placeholderBody}>
                  No native page mapped for {activePath}
                  {route ? ` (${pageKeyForRoute(route)})` : ''}
                </AppText>
              </View>
            )}
          </PageErrorBoundary>
        </Layout>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  placeholderBody: {marginTop: spacing.xs},
});
