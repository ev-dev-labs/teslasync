import {
  EXPECTED_WEB_ROUTE_COUNT,
  getRouteParitySummary,
  routes,
  webRouteManifest,
} from '../src/navigation/routes';

const representativeSourcePaths = [
  '/',
  'quick-stats',
  'vehicles/:id/access',
  'charging/vampire-drain',
  'notifications/studio',
  'admin/live-signals',
  'analytics/tco',
  's/:token',
  'power/sql',
  'me/activity',
];

test('tracks the current web route universe with representative routes present', () => {
  const sourcePaths = webRouteManifest.map(route => route.sourcePath);

  expect(EXPECTED_WEB_ROUTE_COUNT).toBe(157);
  expect(webRouteManifest).toHaveLength(EXPECTED_WEB_ROUTE_COUNT);
  expect(sourcePaths).toEqual(
    expect.arrayContaining(representativeSourcePaths),
  );
  expect(sourcePaths.filter(sourcePath => sourcePath === '*')).toHaveLength(2);
});

test('keeps every manifest entry typed and mapped to a native target', () => {
  const nativeTargets = new Set(routes.map(route => route.id));

  for (const route of webRouteManifest) {
    expect(route.id.length).toBeGreaterThan(0);
    expect(route.label.length).toBeGreaterThan(0);
    expect(route.webPath.length).toBeGreaterThan(0);
    expect(nativeTargets.has(route.nativeTarget)).toBe(true);
    expect(route.evidence.length).toBeGreaterThan(0);
    expect(route.evidence).toMatch(
      route.implementationStatus === 'implemented'
        ? /^Implemented/
        : /^Pending/,
    );
  }
});

test('derives native shell parity counters from the route manifest', () => {
  const summary = getRouteParitySummary();
  const nativeTotal = routes.reduce(
    (total, route) => total + route.parity.total,
    0,
  );

  expect(summary).toEqual({
    total: EXPECTED_WEB_ROUTE_COUNT,
    implemented: 35,
    pending: EXPECTED_WEB_ROUTE_COUNT - 35,
  });
  expect(nativeTotal).toBe(EXPECTED_WEB_ROUTE_COUNT);
  expect(
    routes.find(route => route.id === 'system')?.parity.pending,
  ).toBeGreaterThan(0);
});

test('marks N0006 energy analytics and diagnostics routes with implemented evidence', () => {
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
});

test('marks N0007 notification platform routes with implemented or honest unavailable evidence', () => {
  const implementedRouteIds = [
    'alerts',
    'alert-rules',
    'notifications',
    'notifications-inbox',
    'notifications-alerts',
    'notifications-channels',
    'notifications-webhooks',
    'notifications-browser',
    'notifications-quiet-hours',
    'notifications-rules',
  ];

  for (const routeId of implementedRouteIds) {
    const route = webRouteManifest.find(entry => entry.id === routeId);
    expect(route?.implementationStatus).toBe('implemented');
    expect(route?.evidence).toMatch(/^Implemented: /);
  }

  expect(
    webRouteManifest.find(entry => entry.id === 'notifications-browser')
      ?.evidence,
  ).toContain('unavailable');
  expect(
    webRouteManifest.find(entry => entry.id === 'notifications-studio')
      ?.implementationStatus,
  ).toBe('pending');
});
