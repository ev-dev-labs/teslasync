import React from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  RouteDefinition,
  WebRouteDefinition,
} from '../../navigation/routes';
import { colors, spacing } from '../../theme/tokens';
import { EmptyState } from '../feedback/EmptyState';
import { AppText } from '../ui/AppText';
import { GlassPanel } from '../ui/GlassPanel';
import { StatusPill } from '../ui/StatusPill';

interface RouteParityPanelProps {
  compact: boolean;
  mappedRoutes: WebRouteDefinition[];
  route: RouteDefinition;
}

function routeStatusCopy(route: WebRouteDefinition) {
  switch (route.nativeImplementationStatus) {
    case 'implemented':
      return {label: 'Implemented', state: 'online' as const};
    case 'native-summary':
      return {label: 'Native summary', state: 'warning' as const};
    case 'pending':
      return {label: 'Pending', state: 'warning' as const};
  }
}

export function RouteParityPanel({
  compact,
  route,
  mappedRoutes,
}: RouteParityPanelProps) {
  const pendingRoutes = mappedRoutes.filter(
    mappedRoute => mappedRoute.nativeImplementationStatus !== 'implemented',
  );

  return (
    <GlassPanel style={styles.root} testID="route-parity-panel">
      <View style={[styles.parityHeader, compact && styles.compactColumn]}>
        <View style={styles.parityCopy}>
          <AppText variant="title" weight="bold">
            Route parity evidence
          </AppText>
          <AppText tone="secondary">
            {route.label} owns {route.parity.total} web routes from
            web/src/App.tsx. Each route renders native parity evidence without
            browser or Electron embedding, and old-web deletion stays blocked
            until the final parity gate.
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

      <View style={styles.pendingSummary}>
        <AppText variant="caption" tone="muted">
          Route implementation status
        </AppText>
        <AppText tone="secondary">
          {pendingRoutes.length === 0
            ? 'No unresolved web routes for this native target.'
            : `${pendingRoutes.length} mapped web routes still need dedicated native parity.`}
        </AppText>
      </View>

      {mappedRoutes.length === 0 ? (
        <EmptyState
          title="No mapped web routes"
          message="This native route is available, but no web routes are mapped to this target."
        />
      ) : (
        <View style={styles.routeList}>
          {mappedRoutes.map(mappedRoute => {
            const status = routeStatusCopy(mappedRoute);

            return (
              <View
                key={mappedRoute.id}
                style={[styles.mappedRoute, compact && styles.compactColumn]}
              >
                <View style={styles.mappedRouteCopy}>
                  <View style={styles.mappedRouteTitle}>
                    <AppText weight="semibold">{mappedRoute.label}</AppText>
                    <StatusPill label={status.label} state={status.state} />
                  </View>
                  <AppText variant="caption" tone="muted">
                    {mappedRoute.webPath}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Web {mappedRoute.webImplementationStatus}; native{' '}
                    {mappedRoute.nativeImplementationStatus}; deletion{' '}
                    {mappedRoute.deletionReadiness.status}
                  </AppText>
                </View>
                <View style={styles.routeEvidence}>
                  <AppText variant="caption" tone="muted">
                    {mappedRoute.evidence}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Deletion blocked: {mappedRoute.deletionReadiness.blocker}
                  </AppText>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  parityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  compactColumn: {
    flexDirection: 'column',
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
  pendingSummary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  routeList: {
    gap: spacing.sm,
  },
  mappedRoute: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  mappedRouteCopy: {
    minWidth: 180,
    gap: spacing.xs,
  },
  mappedRouteTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  routeEvidence: {
    flex: 1,
  },
});
