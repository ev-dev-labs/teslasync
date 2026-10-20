import { describe, expect, it } from 'vitest';
import appSource from '../App.tsx?raw';
import layoutSource from '../components/layout/Layout.tsx?raw';
import headerSource from '../components/layout/WorkspaceHeader.tsx?raw';
import { ROUTE_REGISTRY } from './routeRegistry';
import {
  getWorkspaceQuickRangePresets,
  getWorkspaceRouteScope,
  isWorkspaceRangePresetAvailable,
  RANGE_ENABLED_PATHS,
} from './workspaceScope';

const auditMounts = [...appSource.matchAll(
  /<Route\s+path="([^"]+)"\s+element=\{<SafeRoute\s+name="AuditLog"><(\w+)\s*\/>/g,
)].map(([, path, component]) => ({ path: `/${path}`, component }));
const auditPath = auditMounts[0]?.path ?? '';

describe('phase6 audit workspace range registration', () => {
  it('registers the actual mounted AuditLog page rather than an assumed alias', () => {
    expect(auditMounts).toEqual([
      { path: '/admin/audit-log', component: 'AuditLogAdmin' },
    ]);
    expect(appSource).toMatch(
      /const AuditLogAdmin = lazy\(\(\) => import\('\.\/features\/admin\/pages\/AuditLogPage'\)\)/,
    );
    expect(ROUTE_REGISTRY.find((route) => route.name === 'AuditLog')?.path).toBe(auditPath);
    expect(RANGE_ENABLED_PATHS.has(auditPath)).toBe(true);
    expect(getWorkspaceRouteScope(auditPath)).toEqual({ range: true, vehicle: false });
  });

  it.each([
    '/admin/audit-log/',
    '/admin/audit-log///',
    '/admin/audit-log?from=2026-10-01&to=2026-10-02',
    '/admin/audit-log#entries',
    'admin/audit-log',
  ])('retains exact audit capability after normalization: %s', (pathname) => {
    expect(getWorkspaceRouteScope(pathname)).toEqual({ range: true, vehicle: false });
  });

  it.each([
    '/admin',
    '/admin/audit-log/42',
    '/admin/audit-log/verify',
    '/admin/gdpr-exports',
    '/admin/flags',
    '/admin/schema-drift',
  ])('does not enable a broad admin prefix or a guessed child route: %s', (pathname) => {
    expect(getWorkspaceRouteScope(pathname)).toEqual({ range: false, vehicle: false });
  });

  it.each(['/audit-log', '/admin/audit-logs', '/admin/audit-logbook'])(
    'does not register an unmounted audit alias: %s',
    (pathname) => {
      expect(RANGE_ENABLED_PATHS.has(pathname)).toBe(false);
      expect(getWorkspaceRouteScope(pathname).range).toBe(false);
    },
  );

  it.each([
    ['/', false, true],
    ['/notifications', false, false],
    ['/notifications/inbox', true, false],
    ['/notifications/archived', true, false],
    ['/notifications/rules', false, false],
    ['/power/dashboards', false, false],
    ['/power/dashboards/7', false, true],
    ['/power/sql', false, false],
    ['/power/grafana', false, true],
    ['/power-flow', true, false],
    ['/activity', true, true],
    ['/me/activity', true, false],
    ['/api-logs', true, false],
    ['/drives', true, true],
    ['/vehicles/42', false, true],
    ['/settings', false, false],
  ] as const)('preserves prior route %s range=%s vehicle=%s', (pathname, range, vehicle) => {
    for (const variant of [pathname, `${pathname}?from=2026-10-01`, `${pathname}#top`]) {
      expect(getWorkspaceRouteScope(variant), variant).toEqual({ range, vehicle });
    }
  });

  it('keeps standard rolling, custom and all-time choices without changing calendar policy', () => {
    expect(getWorkspaceQuickRangePresets(auditPath)).toEqual(['24h', '7d', '30d', '90d']);
    for (const preset of ['24h', '7d', '30d', '90d', 'custom', 'all']) {
      expect(isWorkspaceRangePresetAvailable(auditPath, preset), preset).toBe(true);
    }
    expect(isWorkspaceRangePresetAvailable(auditPath, 'ytd')).toBe(false);
    expect(isWorkspaceRangePresetAvailable(auditPath, '1y')).toBe(false);
    expect(getWorkspaceQuickRangePresets('/drive-calendar')).toEqual(['7d', '30d', '90d', 'ytd']);
    expect(isWorkspaceRangePresetAvailable('/drive-calendar', '24h')).toBe(false);
  });

  it('feeds the responsive header from the same route capability (no separate mobile drawer control)', () => {
    expect(layoutSource).toMatch(
      /const workspaceScope = useMemo\(\s*\(\) => getWorkspaceRouteScope\(location\.pathname\)/,
    );
    expect(layoutSource).toContain('<WorkspaceScopeProvider scope={workspaceScope}>');
    // The sidenav shell removed the separate mobile-drawer context block; the
    // responsive header below is the single context surface at every width.
    expect(layoutSource).not.toContain('WorkspaceContextControl');
    expect(headerSource).toContain('<WorkspaceContextControl');
    expect(headerSource).toContain('const workspaceScope = useWorkspaceScope()');
    expect(headerSource).toContain('const showRange = !workspaceScope.managed || workspaceScope.range');
    expect(headerSource).toContain('hidden={!showRange}');
    expect(headerSource).toContain('const showVehicle = !workspaceScope.managed || workspaceScope.vehicle');
    expect(headerSource).toContain('{showVehicle && (');
  });
});
