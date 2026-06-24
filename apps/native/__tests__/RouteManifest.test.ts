import {
  EXPECTED_WEB_ROUTE_COUNT,
  getRouteParitySummary,
  oldWebDeletionReadiness,
  routeGroupParitySummaries,
  routeGroups,
  routes,
  webRouteManifest,
} from '../src/navigation/routes';
import {
  IMPLEMENTED_NATIVE_WIDGETS,
  NATIVE_WIDGET_REGISTRY,
  PENDING_NATIVE_WIDGETS,
} from '../src/widgets';

declare const __dirname: string;
declare function require(moduleName: string): unknown;

const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: string) => string;
};
const { resolve } = require('path') as {
  resolve: (...paths: string[]) => string;
};

const appSource = readFileSync(
  resolve(__dirname, '..', '..', '..', 'web', 'src', 'App.tsx'),
  'utf8',
);

function extractWebRoutePaths(source: string) {
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(
    match => match[1],
  );
}

function countByPath(paths: readonly string[]) {
  return paths.reduce<Record<string, number>>((counts, path) => {
    counts[path] = (counts[path] ?? 0) + 1;
    return counts;
  }, {});
}

const representativeSourcePaths = [
  '/',
  'quick-stats',
  'vehicles/:id/access',
  'charging/vampire-drain',
  'vehicle-systems/software',
  'analytics/range',
  'analytics/anomalies',
  'charging/curves',
  'notifications/studio',
  'admin/live-signals',
  'analytics/tco',
  's/:token',
  'power/sql',
  'me/activity',
];

const r0006AdminOpsRouteIds = [
  'admin',
  'admin-dlq',
  'api-logs',
  'dev-tools',
  'power-sql',
  'power-grafana',
  'power-dashboards',
  'signal-log',
  'data-repair',
  'backup',
  'exports',
  'chatbot',
  'system-status-incidents-id',
  'docs-status-api',
  'roadmap',
  'api-keys',
  'admin-feedback',
  'admin-flags',
  'admin-ingest-xray',
  'admin-schema-drift',
  'admin-slow-queries',
  'admin-vehicle-cost',
  'admin-disk-forecast',
  'admin-secret-rotation',
  'admin-gdpr-exports',
  'fleet-api',
  'tesla-features',
  'tesla-region',
  'tesla-orders',
  'gas-price',
  'api-playground',
  'redis-signals',
  'state-debugger',
  'signal-diff',
  'signal-gaps',
  'db-health',
  'mqtt-inspector',
  'anomaly-detection',
  'analytics-anomalies',
] as const;

test('tracks the current web route universe with representative routes present', () => {
  const sourcePaths = webRouteManifest.map(route => route.sourcePath);
  const appRoutePaths = extractWebRoutePaths(appSource);

  expect(EXPECTED_WEB_ROUTE_COUNT).toBe(157);
  expect(appRoutePaths).toHaveLength(EXPECTED_WEB_ROUTE_COUNT);
  expect(webRouteManifest).toHaveLength(EXPECTED_WEB_ROUTE_COUNT);
  expect(countByPath(sourcePaths)).toEqual(countByPath(appRoutePaths));
  expect(sourcePaths).toEqual(
    expect.arrayContaining(representativeSourcePaths),
  );
  expect(sourcePaths.filter(sourcePath => sourcePath === '*')).toHaveLength(2);
});

const nativeStatuses = ['implemented', 'native-summary', 'pending'] as const;

test('keeps every manifest entry typed, statused, deletion-ready, and mapped to a native target', () => {
  const nativeTargets = new Set(routes.map(route => route.id));

  for (const route of webRouteManifest) {
    expect(route.id.length).toBeGreaterThan(0);
    expect(route.label.length).toBeGreaterThan(0);
    expect(route.webPath.length).toBeGreaterThan(0);
    expect(nativeTargets.has(route.nativeTarget)).toBe(true);
    expect(route.webImplementationStatus).toBe('implemented');
    expect(route.nativeImplementationStatus).toBe(route.implementationStatus);
    expect(nativeStatuses).toContain(route.nativeImplementationStatus);
    expect(route.evidence.length).toBeGreaterThan(0);
    expect(route.deletionReadiness.blocker.length).toBeGreaterThan(0);

    if (route.nativeImplementationStatus === 'implemented') {
      expect(route.evidence).toMatch(/^Implemented:/);
      expect(route.deletionReadiness).toEqual(
        expect.objectContaining({
          status: 'ready',
          canDeleteWebRoute: true,
          finalParityGateRequired: false,
        }),
      );
    } else if (route.nativeImplementationStatus === 'native-summary') {
      expect(route.evidence).toMatch(/^Native summary:/);
      expect(route.deletionReadiness).toEqual(
        expect.objectContaining({
          status: 'blocked',
          canDeleteWebRoute: false,
          finalParityGateRequired: true,
        }),
      );
    } else {
      expect(route.evidence).toMatch(/^Pending:/);
      expect(route.deletionReadiness).toEqual(
        expect.objectContaining({
          status: 'blocked',
          canDeleteWebRoute: false,
          finalParityGateRequired: true,
        }),
      );
    }
  }
});

test('derives universal old-web deletion readiness only from complete native route parity', () => {
  const summary = getRouteParitySummary();
  const nativeTotal = routes.reduce(
    (total, route) => total + route.parity.total,
    0,
  );
  const implementedRoutes = webRouteManifest.filter(
    route => route.implementationStatus === 'implemented',
  );
  const pendingRoutes = webRouteManifest.filter(
    route => route.implementationStatus !== 'implemented',
  );
  const literalPendingRoutes = webRouteManifest.filter(
    route => route.implementationStatus === 'pending',
  );
  const nativeSummaryRoutes = webRouteManifest.filter(
    route => route.implementationStatus === 'native-summary',
  );
  const canDeleteFromRouteCounts =
    summary.total === EXPECTED_WEB_ROUTE_COUNT &&
    implementedRoutes.length === EXPECTED_WEB_ROUTE_COUNT &&
    nativeSummaryRoutes.length === 0 &&
    literalPendingRoutes.length === 0;

  expect(summary).toEqual({
    total: EXPECTED_WEB_ROUTE_COUNT,
    implemented: implementedRoutes.length,
    pending: pendingRoutes.length,
  });
  expect(nativeTotal).toBe(EXPECTED_WEB_ROUTE_COUNT);
  expect(implementedRoutes.length).toBeGreaterThan(0);
  expect(implementedRoutes).toHaveLength(EXPECTED_WEB_ROUTE_COUNT);
  expect(pendingRoutes).toHaveLength(0);
  expect(nativeSummaryRoutes).toHaveLength(0);
  expect(literalPendingRoutes).toHaveLength(0);
  expect(implementedRoutes.length + pendingRoutes.length).toBe(
    EXPECTED_WEB_ROUTE_COUNT,
  );
  expect(canDeleteFromRouteCounts).toBe(true);
  expect(oldWebDeletionReadiness).toEqual(
    expect.objectContaining({
      status: 'ready',
      canDeleteOldWeb: canDeleteFromRouteCounts,
      finalParityGateRequired: false,
      totalRoutes: EXPECTED_WEB_ROUTE_COUNT,
      implementedRoutes: implementedRoutes.length,
      unresolvedRoutes: pendingRoutes.length,
    }),
  );
  expect(oldWebDeletionReadiness.blocker).toContain('157/157');
  expect(
    routes.find(route => route.id === 'system')?.parity.pending,
  ).toBe(0);
});

test('keeps widget readiness complete or explicitly blocked with evidence', () => {
  expect(PENDING_NATIVE_WIDGETS).toHaveLength(0);
  expect(IMPLEMENTED_NATIVE_WIDGETS).toHaveLength(NATIVE_WIDGET_REGISTRY.length);

  for (const widget of NATIVE_WIDGET_REGISTRY) {
    if (widget.status === 'implemented') {
      expect(widget.component).toEqual(expect.any(Function));
      expect(widget.webWidgetIds.length).toBeGreaterThan(0);
    } else {
      expect(widget.pendingReason.length).toBeGreaterThan(0);
    }
  }
});

test('derives route parity counters by web route group', () => {
  expect(routeGroupParitySummaries.map(summary => summary.group)).toEqual(
    routeGroups,
  );

  const groupedTotal = routeGroupParitySummaries.reduce(
    (total, summary) => total + summary.total,
    0,
  );
  expect(groupedTotal).toBe(EXPECTED_WEB_ROUTE_COUNT);

  for (const summary of routeGroupParitySummaries) {
    const groupedRoutes = webRouteManifest.filter(
      route => route.group === summary.group,
    );
    expect(summary.total).toBe(groupedRoutes.length);
    expect(summary.implemented + summary.pending).toBe(summary.total);
    expect(summary.label.length).toBeGreaterThan(0);
  }
});

test('marks implemented energy analytics and diagnostics routes with evidence', () => {
  const implementedRouteIds = [
    'battery',
    'battery-health',
    'analytics',
    'battery-degradation',
    'tco',
    'analytics-tco',
    'sleep-efficiency',
    'temperature-impact',
    'route-efficiency',
    'regen-efficiency',
    'speed-profile',
    'admin-telemetry-coverage',
    'admin-live-signals',
    'admin-audit-log',
    'signals',
    'signal-explorer',
    'live-monitor',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
  }

  for (const routeId of ['energy-products', 'energy-flow', 'power-flow']) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.deletionReadiness.status).toBe('ready');
    expect(route?.evidence).toMatch(/^Implemented: /);
  }
});

test('marks R0003 charging and energy routes implemented', () => {
  const implementedRouteIds = [
    'charging-curve',
    'charging-curves',
    'charging-vampire-drain',
    'cost-analysis',
    'charging-costs',
    'tesla-charging-history',
    'tesla-charging-sessions',
    'smart-charge',
    'charging-schedule',
    'powershare',
    'charging-heatmap',
    'energy-flow',
    'power-flow',
    'energy-products',
    'battery-cells',
    'vampire-drain',
    'projected-range',
    'analytics-range',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
    expect(route?.deletionReadiness.status).toBe('ready');
  }

  expect(
    routes.find(route => route.id === 'charging')?.parity.implemented,
  ).toBeGreaterThanOrEqual(10);
  expect(
    routes.find(route => route.id === 'energy')?.parity.implemented,
  ).toBeGreaterThanOrEqual(15);
});

test('marks R0004 driving and analytics route summaries implemented', () => {
  const implementedRouteIds = [
    'sharing-trips',
    'analytics-lifetime',
    'compare',
    'analytics-compare',
    'timeline',
    'mileage',
    'trip-planner',
    'statistics',
    'lifetime-stats',
    'period-compare',
    'driving-dynamics',
    'drive-score',
    'weekly-digest',
    'drivetrain-health',
    'navigation',
    'vehicle-comparison',
    'geofences',
    'locations',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
    expect(route?.deletionReadiness.status).toBe('ready');
  }

  expect(
    routes.find(route => route.id === 'dashboard')?.parity.implemented,
  ).toBeGreaterThanOrEqual(12);
  expect(
    routes.find(route => route.id === 'driving')?.parity.implemented,
  ).toBeGreaterThanOrEqual(12);
  expect(
    routes.find(route => route.id === 'vehicles')?.parity.implemented,
  ).toBeGreaterThanOrEqual(19);
});

test('marks R0001 command, shared, onboarding, live, search, and fallback routes implemented', () => {
  const implementedRouteIds = [
    'quick-stats',
    'glance',
    'year-review-year',
    'shared-drive-token',
    'watch',
    'onboarding',
    'root-layout',
    'explore',
    'live',
    'search',
    'not-found-layout',
    'not-found-root',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
    expect(route?.deletionReadiness.status).toBe('ready');
  }

  expect(
    routes.find(route => route.id === 'dashboard')?.parity.implemented,
  ).toBeGreaterThanOrEqual(7);
  expect(
    routes.find(route => route.id === 'driving')?.parity.implemented,
  ).toBeGreaterThanOrEqual(5);
  expect(
    routes.find(route => route.id === 'vehicles')?.parity.implemented,
  ).toBeGreaterThanOrEqual(3);
});

test('marks R0002 vehicle-system routes implemented with native evidence', () => {
  const implementedRouteIds = [
    'vehicles-id-access',
    'digital-twin',
    'tire-pressure',
    'software-updates',
    'vehicle-systems-software',
    'climate-control',
    'climate',
    'security-access',
    'safety-settings',
    'maintenance',
    'media-player',
    'guard-mode',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.nativeTarget).toBe('vehicles');
    expect(route?.evidence).toMatch(/^Implemented: VehiclesScreen renders/);
    expect(route?.deletionReadiness.status).toBe('ready');
  }

  expect(
    routes.find(route => route.id === 'vehicles')?.parity.implemented,
  ).toBeGreaterThanOrEqual(15);
});

test('marks notification platform routes with implemented or honest unavailable evidence', () => {
  const implementedRouteIds = [
    'alerts',
    'notifications',
    'notifications-inbox',
    'notifications-archived',
    'notifications-alerts',
    'notifications-channels',
    'notifications-webhooks',
    'notifications-browser',
    'notifications-quiet-hours',
    'notifications-rules',
    'notifications-studio',
    'notifications-audit',
    'alert-studio',
    'alert-rules',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
  }
});

test('marks R0005 notification auth settings and integration routes implemented', () => {
  const implementedRouteIds = [
    'automations',
    'automations-list',
    'automations-new',
    'automations-id-edit',
    'alert-studio',
    'alert-rules',
    'notifications-browser',
    'notifications-rules',
    'notifications-studio',
    'settings',
    'settings-safety',
    'account-2fa',
    'account-sessions',
    'account-privacy',
    'integrations-helix',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
    expect(route?.deletionReadiness.canDeleteWebRoute).toBe(true);
  }

  expect(
    routes.find(route => route.id === 'alerts')?.parity.implemented,
  ).toBeGreaterThanOrEqual(14);
  expect(
    routes.find(route => route.id === 'settings')?.parity.implemented,
  ).toBeGreaterThanOrEqual(3);
  expect(
    routes.find(route => route.id === 'auth')?.parity.implemented,
  ).toBeGreaterThanOrEqual(4);
});

test('marks R0006 admin ops and diagnostics routes implemented', () => {
  expect(r0006AdminOpsRouteIds).toHaveLength(39);

  for (const routeId of r0006AdminOpsRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
    expect(route?.deletionReadiness.canDeleteWebRoute).toBe(true);
    expect(route?.deletionReadiness.status).toBe('ready');
  }

  expect(
    routes.find(route => route.id === 'system')?.parity.implemented,
  ).toBeGreaterThanOrEqual(31);
  expect(
    routes.find(route => route.id === 'dashboard')?.parity.implemented,
  ).toBeGreaterThanOrEqual(14);
  expect(
    routes.find(route => route.id === 'auth')?.parity.implemented,
  ).toBeGreaterThanOrEqual(5);
  expect(
    routes.find(route => route.id === 'settings')?.parity.implemented,
  ).toBeGreaterThanOrEqual(4);
});

test('marks final R0007 routes implemented with deletion readiness evidence', () => {
  const finalRouteIds = [
    'commands',
    'command-history',
    'data-export',
    'me-activity',
  ];

  for (const routeId of finalRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
    expect(route?.deletionReadiness.status).toBe('ready');
    expect(route?.deletionReadiness.canDeleteWebRoute).toBe(true);
  }
});
