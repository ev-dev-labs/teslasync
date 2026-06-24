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
  expect(sourcePaths).toEqual(expect.arrayContaining(representativeSourcePaths));
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
      route.implementationStatus === 'implemented' ? /^Implemented/ : /^Pending/,
    );
  }
});

test('derives native shell parity counters from the route manifest', () => {
  const summary = getRouteParitySummary();
  const nativeTotal = routes.reduce((total, route) => total + route.parity.total, 0);

  expect(summary).toEqual({
    total: EXPECTED_WEB_ROUTE_COUNT,
    implemented: 8,
    pending: EXPECTED_WEB_ROUTE_COUNT - 8,
  });
  expect(nativeTotal).toBe(EXPECTED_WEB_ROUTE_COUNT);
  expect(routes.find(route => route.id === 'system')?.parity.pending).toBeGreaterThan(0);
});
