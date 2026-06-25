import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  routeGroupLabels,
  routeGroups,
  routeParitySummary,
  webRouteManifest,
  type RouteGroup,
  type RouteId,
  type RouteImplementationStatus,
} from '../navigation/routes';
import {colors, shadows, spacing} from '../theme/tokens';
import {AppText} from '../components/ui/AppText';
import {GlassPanel} from '../components/ui/GlassPanel';
import {StatusPill} from '../components/ui/StatusPill';

const RECENT_PAGES_RECORD_DELAY_MS = 250;
const TITLE_SUFFIX = ' — TeslaSync';
const DEFAULT_NATIVE_RETURN_ORIGIN = 'http://localhost';
const COMPACT_SHELL_WIDTH = 760;

const standaloneRoutePaths = new Set([
  'quick-stats',
  'glance',
  'year-review/:year',
  's/:token',
  'watch',
  'onboarding',
]);

const redirectTargets = {
  'analytics/lifetime': '/lifetime-stats',
  compare: '/period-compare',
  'analytics/compare': '/period-compare',
  admin: '/system-status',
} as const satisfies Partial<Record<string, string>>;

const browserOnlyAdaptations = [
  'React Router lazy route chunks are represented by the typed native route manifest and SafeRoute panel instead of DOM Suspense boundaries.',
  'ScrollRestoration, RouteAnnouncer, DensityApplier, and ContextMenuRoot are browser DOM concerns; native keeps the route shell visible and reports them as unavailable adaptations.',
  'sessionStorage re-auth return URLs are replaced by an explicit native return-url setter with same-origin validation.',
] as const;

type NativeRouteKind = 'standalone' | 'layout' | 'redirect' | 'catch-all';

export interface NativeRecentPageView {
  path: string;
  title: string;
  recordedAt: string;
}

export interface NativeAppRoute {
  index: number;
  id: string;
  sourcePath: string;
  webPath: string;
  label: string;
  group: RouteGroup;
  nativeTarget: RouteId;
  implementationStatus: RouteImplementationStatus;
  kind: NativeRouteKind;
  redirectTo: string | null;
  evidence: string;
}

interface AppProps {
  initialPath?: string;
  initialReturnUrl?: string | null;
  expectedReturnOrigin?: string;
  renderRouteContent?: (route: NativeAppRoute) => ReactNode;
  onRouteChange?: (route: NativeAppRoute) => void;
}

let pendingNativeReturnUrl: string | null = null;
let nativeRecentPageViews: NativeRecentPageView[] = [];

function routeKindFor(sourcePath: string): NativeRouteKind {
  if (sourcePath === '*') {
    return 'catch-all';
  }
  if (sourcePath in redirectTargets) {
    return 'redirect';
  }
  if (standaloneRoutePaths.has(sourcePath)) {
    return 'standalone';
  }
  return 'layout';
}

export const nativeAppRoutes: NativeAppRoute[] = webRouteManifest.map(
  (route, index) => ({
    index,
    id: route.id,
    sourcePath: route.sourcePath,
    webPath: route.webPath,
    label: route.label,
    group: route.group,
    nativeTarget: route.nativeTarget,
    implementationStatus: route.implementationStatus,
    kind: routeKindFor(route.sourcePath),
    redirectTo:
      route.sourcePath in redirectTargets
        ? redirectTargets[route.sourcePath as keyof typeof redirectTargets]
        : null,
    evidence: route.evidence,
  }),
);

function stripTitleSuffix(t: string): string {
  if (t.endsWith(TITLE_SUFFIX)) {
    return t.slice(0, -TITLE_SUFFIX.length);
  }
  return t;
}

export function setNativeReturnUrlForReauthentication(
  returnUrl: string | null,
): void {
  pendingNativeReturnUrl = returnUrl;
}

export function getNativeRecentPageViews(): NativeRecentPageView[] {
  return nativeRecentPageViews.slice();
}

export function clearNativeRecentPageViews(): void {
  nativeRecentPageViews = [];
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const [pathWithMaybeQuery, hash = ''] = trimmed.split('#', 2);
  const [pathOnly, query = ''] = pathWithMaybeQuery.split('?', 2);
  const normalizedPath = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const normalizedQuery = query ? `?${query}` : '';
  const normalizedHash = hash ? `#${hash}` : '';
  return `${normalizedPath}${normalizedQuery}${normalizedHash}`;
}

function pathWithoutQueryAndHash(pathname: string): string {
  return normalizePathname(pathname).replace(/[?#].*$/, '');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function routePatternMatches(route: NativeAppRoute, pathname: string): boolean {
  const pathOnly = pathWithoutQueryAndHash(pathname);
  if (route.sourcePath === '*') {
    return true;
  }
  if (route.webPath === pathOnly) {
    return true;
  }

  const routeSegments = trimSlashes(route.sourcePath).split('/');
  const pathSegments = trimSlashes(pathOnly).split('/');
  if (routeSegments.length !== pathSegments.length) {
    return false;
  }

  return routeSegments.every((segment, index) => {
    return segment.startsWith(':') || segment === pathSegments[index];
  });
}

function routeForPath(pathname: string): NativeAppRoute {
  const normalized = pathWithoutQueryAndHash(pathname);
  const exactRoute = nativeAppRoutes.find(route => route.webPath === normalized);
  if (exactRoute) {
    return exactRoute;
  }

  return (
    nativeAppRoutes.find(
      route => route.sourcePath !== '*' && routePatternMatches(route, normalized),
    ) ?? nativeAppRoutes[nativeAppRoutes.length - 1]
  );
}

function resolvePageLabel(pathname: string): string | null {
  const route = routeForPath(pathname);
  return route.sourcePath === '*' ? null : route.label;
}

function recordPageView(view: NativeRecentPageView): void {
  nativeRecentPageViews = [
    view,
    ...nativeRecentPageViews.filter(page => page.path !== view.path),
  ].slice(0, 20);
}

function pathFromSameOriginReturnUrl(
  returnUrl: string,
  expectedOrigin: string,
): string | null {
  const trimmed = returnUrl.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return normalizePathname(trimmed);
  }

  const origin = expectedOrigin.replace(/\/+$/, '');
  if (trimmed === origin) {
    return '/';
  }
  if (trimmed.startsWith(`${origin}/`)) {
    return normalizePathname(trimmed.slice(origin.length));
  }

  return null;
}

function resolveNativeReturnPath(
  returnUrl: string,
  currentPath: string,
  expectedOrigin: string,
): string | null {
  const nextPath = pathFromSameOriginReturnUrl(returnUrl, expectedOrigin);
  if (nextPath === null || nextPath === normalizePathname(currentPath)) {
    return null;
  }

  return nextPath;
}

function consumePendingReturnUrl(): string | null {
  const returnUrl = pendingNativeReturnUrl;
  pendingNativeReturnUrl = null;
  return returnUrl;
}

function RecentPagesRecorder({
  onRecord,
  pathname,
}: {
  onRecord: (views: NativeRecentPageView[]) => void;
  pathname: string;
}) {
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastPathRef.current === pathname) {
      return;
    }
    lastPathRef.current = pathname;

    const id = setTimeout(() => {
      const fromRegistry = resolvePageLabel(pathname);
      const title = stripTitleSuffix(fromRegistry ?? pathname);
      recordPageView({
        path: pathname,
        title,
        recordedAt: new Date().toISOString(),
      });
      onRecord(getNativeRecentPageViews());
    }, RECENT_PAGES_RECORD_DELAY_MS);

    return () => clearTimeout(id);
  }, [onRecord, pathname]);

  return null;
}

function SafeRoute({children, name}: {children: ReactNode; name: string}) {
  return (
    <GlassPanel style={styles.safeRoute}>
      <View style={styles.safeRouteHeader}>
        <AppText variant="title" weight="bold">
          {name}
        </AppText>
        <StatusPill label="Safe route" state="online" />
      </View>
      {children}
    </GlassPanel>
  );
}

function statusStateForRoute(
  status: RouteImplementationStatus,
): 'online' | 'warning' | 'offline' {
  if (status === 'implemented') {
    return 'online';
  }
  if (status === 'native-summary') {
    return 'warning';
  }
  return 'offline';
}

function RouteListItem({
  compact,
  onNavigate,
  route,
  selected,
}: {
  compact: boolean;
  onNavigate: (path: string) => void;
  route: NativeAppRoute;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`Open ${route.label}`}
      accessibilityRole="button"
      onPress={() => onNavigate(route.webPath)}
      style={({pressed}) => [
        styles.routeListItem,
        selected && styles.selectedRouteListItem,
        pressed && styles.pressedRouteListItem,
        compact && styles.compactRouteListItem,
      ]}>
      <View style={styles.routeListItemHeader}>
        <AppText weight="semibold">{route.label}</AppText>
        <StatusPill
          label={route.kind === 'redirect' ? 'Redirect' : route.kind}
          state={route.kind === 'catch-all' ? 'warning' : 'online'}
        />
      </View>
      <AppText variant="caption" tone="muted">
        {route.webPath}
      </AppText>
      <AppText variant="caption" tone="muted">
        Native target: {route.nativeTarget}
      </AppText>
    </Pressable>
  );
}

function RouteCatalog({
  activeRoute,
  compact,
  onNavigate,
}: {
  activeRoute: NativeAppRoute;
  compact: boolean;
  onNavigate: (path: string) => void;
}) {
  const groupedRoutes = useMemo(() => {
    return routeGroups.map(group => ({
      group,
      routes: nativeAppRoutes.filter(route => route.group === group),
    }));
  }, []);

  return (
    <GlassPanel style={[styles.catalog, compact && styles.compactCatalog]}>
      <AppText variant="title" weight="bold">
        Native route catalog
      </AppText>
      <AppText tone="secondary">
        {routeParitySummary.total} web routes from web/src/App.tsx are mapped to
        React Native targets without importing React Router, DOM portals, or web
        UI components.
      </AppText>

      <ScrollView
        contentContainerStyle={styles.routeGroups}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}>
        {groupedRoutes.map(group => (
          <View key={group.group} style={styles.routeGroup}>
            <AppText variant="caption" tone="muted" weight="semibold">
              {routeGroupLabels[group.group]}
            </AppText>
            {group.routes.map(route => (
              <RouteListItem
                compact={compact}
                key={`${route.id}-${route.index}`}
                route={route}
                selected={route.id === activeRoute.id}
                onNavigate={onNavigate}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </GlassPanel>
  );
}

function DefaultRouteContent({route}: {route: NativeAppRoute}) {
  return (
    <View style={styles.routeContent}>
      <View style={styles.routeMetaGrid}>
        <View style={styles.metricBox}>
          <AppText variant="caption" tone="muted">
            Source path
          </AppText>
          <AppText weight="semibold">{route.sourcePath}</AppText>
        </View>
        <View style={styles.metricBox}>
          <AppText variant="caption" tone="muted">
            Native target
          </AppText>
          <AppText weight="semibold">{route.nativeTarget}</AppText>
        </View>
        <View style={styles.metricBox}>
          <AppText variant="caption" tone="muted">
            Wrapper
          </AppText>
          <AppText weight="semibold">{route.kind}</AppText>
        </View>
        <View style={styles.metricBox}>
          <AppText variant="caption" tone="muted">
            Status
          </AppText>
          <StatusPill
            label={route.implementationStatus}
            state={statusStateForRoute(route.implementationStatus)}
          />
        </View>
      </View>

      {route.redirectTo ? (
        <GlassPanel style={styles.redirectPanel}>
          <AppText weight="semibold">Native redirect preserved</AppText>
          <AppText tone="secondary">
            Opening {route.webPath} resolves to {route.redirectTo}, matching the
            web Navigate replace behavior.
          </AppText>
        </GlassPanel>
      ) : null}

      <View style={styles.evidencePanel}>
        <AppText variant="caption" tone="muted" weight="semibold">
          Route parity evidence
        </AppText>
        <AppText tone="secondary">{route.evidence}</AppText>
      </View>
    </View>
  );
}

function BrowserOnlyAdaptationsPanel() {
  return (
    <GlassPanel style={styles.adaptationsPanel}>
      <View style={styles.safeRouteHeader}>
        <AppText variant="title" weight="bold">
          Browser-only adaptations
        </AppText>
        <StatusPill label="Native-safe" state="warning" />
      </View>
      {browserOnlyAdaptations.map(adaptation => (
        <View key={adaptation} style={styles.adaptationRow}>
          <View style={styles.bullet} />
          <AppText tone="secondary" style={styles.adaptationText}>
            {adaptation}
          </AppText>
        </View>
      ))}
    </GlassPanel>
  );
}

function RecentPagesPanel({views}: {views: readonly NativeRecentPageView[]}) {
  return (
    <GlassPanel style={styles.recentPanel}>
      <AppText variant="title" weight="bold">
        Recent pages recorder
      </AppText>
      {views.length === 0 ? (
        <AppText tone="muted">
          Waiting for the native-safe 250ms title capture delay.
        </AppText>
      ) : (
        views.slice(0, 5).map(view => (
          <View key={`${view.path}-${view.recordedAt}`} style={styles.recentRow}>
            <AppText weight="semibold">{view.title}</AppText>
            <AppText variant="caption" tone="muted">
              {view.path}
            </AppText>
          </View>
        ))
      )}
    </GlassPanel>
  );
}

export default function App({
  expectedReturnOrigin = DEFAULT_NATIVE_RETURN_ORIGIN,
  initialPath = '/',
  initialReturnUrl = null,
  onRouteChange,
  renderRouteContent,
}: AppProps) {
  const dimensions = useWindowDimensions();
  const compact = dimensions.width < COMPACT_SHELL_WIDTH;
  const [activePath, setActivePath] = useState(() =>
    normalizePathname(initialPath),
  );
  const [recentViews, setRecentViews] = useState<NativeRecentPageView[]>(() =>
    getNativeRecentPageViews(),
  );
  const selectedRoute = useMemo(() => routeForPath(activePath), [activePath]);

  const navigate = useCallback((path: string) => {
    setActivePath(normalizePathname(path));
  }, []);

  const handleRecentRecord = useCallback((views: NativeRecentPageView[]) => {
    setRecentViews(views);
  }, []);

  useEffect(() => {
    const returnUrl = initialReturnUrl ?? consumePendingReturnUrl();
    if (!returnUrl) {
      return;
    }

    const nextPath = resolveNativeReturnPath(
      returnUrl,
      activePath,
      expectedReturnOrigin,
    );
    if (nextPath) {
      setActivePath(nextPath);
    }
  }, [activePath, expectedReturnOrigin, initialReturnUrl]);

  useEffect(() => {
    if (selectedRoute.redirectTo && selectedRoute.redirectTo !== activePath) {
      setActivePath(selectedRoute.redirectTo);
    }
  }, [activePath, selectedRoute]);

  useEffect(() => {
    onRouteChange?.(selectedRoute);
  }, [onRouteChange, selectedRoute]);

  return (
    <View style={styles.root}>
      <RecentPagesRecorder
        pathname={activePath}
        onRecord={handleRecentRecord}
      />
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />

      <View style={[styles.shell, compact && styles.compactShell]}>
        <RouteCatalog
          activeRoute={selectedRoute}
          compact={compact}
          onNavigate={navigate}
        />

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <AppText variant="display" weight="bold">
                TeslaSync native App parity
              </AppText>
              <AppText tone="secondary">
                Native-safe conversion of web/src/App.tsx routing, safe-route
                isolation, redirect handling, re-auth return navigation, and
                recent-page capture.
              </AppText>
            </View>
            <View style={styles.summaryPills}>
              <StatusPill
                label={`${routeParitySummary.implemented} implemented`}
                state="online"
              />
              <StatusPill
                label={`${routeParitySummary.pending} pending`}
                state={routeParitySummary.pending === 0 ? 'online' : 'warning'}
              />
            </View>
          </View>

          <SafeRoute name={selectedRoute.label}>
            {renderRouteContent?.(selectedRoute) ?? (
              <DefaultRouteContent route={selectedRoute} />
            )}
          </SafeRoute>

          <BrowserOnlyAdaptationsPanel />
          <RecentPagesPanel views={recentViews} />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
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
    opacity: 0.28,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -180,
    left: -140,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.glowViolet,
    opacity: 0.2,
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  compactShell: {
    flexDirection: 'column',
    padding: spacing.md,
  },
  catalog: {
    width: 340,
    maxHeight: '100%',
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.panel,
  },
  compactCatalog: {
    width: '100%',
    maxHeight: 320,
  },
  routeGroups: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  routeGroup: {
    gap: spacing.sm,
  },
  routeListItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  compactRouteListItem: {
    minWidth: 220,
  },
  selectedRouteListItem: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  pressedRouteListItem: {
    opacity: 0.84,
  },
  routeListItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  headerCopy: {
    flex: 1,
    minWidth: 260,
    gap: spacing.xs,
  },
  summaryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  safeRoute: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  safeRouteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  routeContent: {
    gap: spacing.lg,
  },
  routeMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricBox: {
    minWidth: 160,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  redirectPanel: {
    padding: spacing.md,
    gap: spacing.xs,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  evidencePanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  adaptationsPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  adaptationRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  adaptationText: {
    flex: 1,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
    backgroundColor: colors.warning,
  },
  recentPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  recentRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
});
