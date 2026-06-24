import {
  EXPECTED_WEB_ROUTE_COUNT,
  getRouteParitySummary,
  oldWebDeletionReadiness,
  routeGroupParitySummaries,
  routeGroups,
  routes,
  webRouteManifest,
} from '../src/navigation/routes';

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

test('keeps every manifest entry typed, statused, deletion-blocked, and mapped to a native target', () => {
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
    expect(route.deletionReadiness).toEqual(
      expect.objectContaining({
        status: 'blocked',
        canDeleteWebRoute: false,
        finalParityGateRequired: true,
      }),
    );
    expect(route.deletionReadiness.blocker.length).toBeGreaterThan(0);

    if (route.nativeImplementationStatus === 'implemented') {
      expect(route.evidence).toMatch(/^Implemented:/);
    } else if (route.nativeImplementationStatus === 'native-summary') {
      expect(route.evidence).toMatch(/^Native summary:/);
    } else {
      expect(route.evidence).toMatch(/^Pending:/);
    }
  }
});

test('derives honest native shell parity counters and keeps old-web deletion blocked', () => {
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

  expect(summary).toEqual({
    total: EXPECTED_WEB_ROUTE_COUNT,
    implemented: implementedRoutes.length,
    pending: pendingRoutes.length,
  });
  expect(nativeTotal).toBe(EXPECTED_WEB_ROUTE_COUNT);
  expect(implementedRoutes.length).toBeGreaterThan(0);
  expect(pendingRoutes.length).toBeGreaterThan(0);
  expect(implementedRoutes.length + pendingRoutes.length).toBe(
    EXPECTED_WEB_ROUTE_COUNT,
  );
  expect(oldWebDeletionReadiness).toEqual(
    expect.objectContaining({
      status: 'blocked',
      canDeleteOldWeb: false,
      finalParityGateRequired: true,
      totalRoutes: EXPECTED_WEB_ROUTE_COUNT,
      implementedRoutes: implementedRoutes.length,
      unresolvedRoutes: pendingRoutes.length,
    }),
  );
  expect(oldWebDeletionReadiness.blocker).toContain('final parity gate');
  expect(
    routes.find(route => route.id === 'system')?.parity.pending,
  ).toBeGreaterThan(0);
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
    expect(route?.implementationStatus).toBe('native-summary');
    expect(route?.deletionReadiness.status).toBe('blocked');
    expect(route?.evidence).toMatch(/^Native summary: /);
  }
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
    'notifications-quiet-hours',
    'notifications-audit',
  ];
  const nativeSummaryRouteIds = [
    'alert-studio',
    'alert-rules',
    'notifications-browser',
    'notifications-rules',
    'notifications-studio',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
  }

  for (const routeId of nativeSummaryRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('native-summary');
    expect(route?.evidence).toMatch(/^Native summary: /);
    expect(route?.deletionReadiness.canDeleteWebRoute).toBe(false);
  }
});

test('keeps unported web routes visible as pending rather than success-shaped', () => {
  const pendingRouteIds = [
    'api-playground',
    'admin-slow-queries',
    'fleet-api',
    'gas-price',
    'vehicle-comparison',
  ];

  for (const routeId of pendingRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('pending');
    expect(route?.evidence).toMatch(/^Pending: /);
    expect(route?.deletionReadiness.status).toBe('blocked');
  }
});
