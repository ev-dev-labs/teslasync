import { describe, expect, it } from 'vitest';
import nodePath from 'node:path';
import { sourceHookCalls } from '../../test/sourceHookGraph';
import {
  RANGE_ENABLED_PATHS,
  VEHICLE_DISABLED_PATHS,
  VEHICLE_DISABLED_PREFIXES,
  getWorkspaceRouteScope,
  getWorkspaceQuickRangePresets,
  isWorkspaceRangePresetAvailable,
} from '../workspaceScope';
import { ROUTE_REGISTRY } from '../routeRegistry';
import appSource from '../../App.tsx?raw';

const pageSources = import.meta.glob('../../features/**/pages/*Page.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const lazyPages = new Map(
  [...appSource.matchAll(/const (\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('\.\/features\/([^']+\/pages\/[^']+)'\)/g)]
    .map(([, name, path]) => [name, `../../features/${path}.tsx`]),
);
const routedPages = [...appSource.matchAll(
  /<Route\b[^>]*?path="([^"]+)"[^>]*?element=\{<SafeRoute[^>]*><([A-Z]\w*)/g,
)].map(([, path, name]) => ({ path: `/${path.replace(/^\/+/, '')}`, name }));

describe('getWorkspaceRouteScope', () => {
  it('owns tire differential drift range and vehicle on the actual normalized route', () => {
    for (const path of ['/tire-differential-drift', '/tire-differential-drift/',
      '/tire-differential-drift?from=2024-03-10&to=2024-03-10',
      '/tire-differential-drift#methodology', 'tire-differential-drift']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceRouteScope('/vehicle-systems/tire-differential-drift').range).toBe(false);
    expect(getWorkspaceQuickRangePresets('/tire-differential-drift')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns preconditioning effectiveness range and vehicle on the actual normalized route', () => {
    for (const path of [
      '/preconditioning-effectiveness', '/preconditioning-effectiveness/',
      '/preconditioning-effectiveness?from=2024-03-10&to=2024-03-11',
      '/preconditioning-effectiveness#methodology', 'preconditioning-effectiveness',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/preconditioning-effectiveness')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns HVAC cycling range and vehicle on its normalized route', () => {
    for (const path of [
      '/hvac-cycling', '/hvac-cycling/',
      '/hvac-cycling?from=2026-03-08&to=2026-03-08',
      '/hvac-cycling#methodology', 'hvac-cycling',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/hvac-cycling')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns battery degradation analysis on the actual route, not the API path', () => {
    for (const path of ['/battery-degradation', '/battery-degradation/',
      '/battery-degradation?from=2024-03-10&to=2024-03-11', '/battery-degradation#history']) {
      expect(getWorkspaceRouteScope(path)).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceRouteScope('/analytics/battery-degradation').range).toBe(false);
  });
  it('owns comfort consistency range and vehicle on its normalized route', () => {
    for (const path of [
      '/comfort-consistency', '/comfort-consistency/',
      '/comfort-consistency?from=2026-03-08&to=2026-03-08',
      '/comfort-consistency#methodology', 'comfort-consistency',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/comfort-consistency')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns the shared range and vehicle on both climate-control aliases', () => {
    for (const alias of ['/climate-control', '/climate']) {
      for (const path of [alias, `${alias}/`, `${alias}?from=2026-10-10&to=2026-10-13`, `${alias}#history`, alias.slice(1)]) {
        expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
      }
      expect(getWorkspaceQuickRangePresets(alias)).toEqual(['24h', '7d', '30d', '90d']);
    }
  });
  it('owns cabin thermal range and vehicle on the actual normalized route', () => {
    for (const path of [
      '/cabin-thermal', '/cabin-thermal/',
      '/cabin-thermal?from=2026-08-01&to=2026-08-08',
      '/cabin-thermal#methodology', 'cabin-thermal',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/cabin-thermal')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns the correlation range and selected vehicle on the actual normalized route', () => {
    for (const path of [
      '/signal-correlation', '/signal-correlation/',
      '/signal-correlation?from=2026-10-10&to=2026-10-13',
      '/signal-correlation#overlay', 'signal-correlation',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/signal-correlation')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns the deadband range and vehicle on its normalized route', () => {
    for (const path of ['/signal-deadband', '/signal-deadband/', '/signal-deadband?from=2026-10-10', '/signal-deadband#chart', 'signal-deadband']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/signal-deadband')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('owns the change-point range and vehicle on the actual normalized route', () => {
    for (const path of [
      '/signal-change-points',
      '/signal-change-points/',
      '/signal-change-points?from=2026-10-10&to=2026-10-13',
      '/signal-change-points#timeline',
      'signal-change-points',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceQuickRangePresets('/signal-change-points')).toEqual(['24h', '7d', '30d', '90d']);
  });

  it('keeps Tesla API usage fleet-wide without overriding its independent UTC history range', () => {
    for (const path of [
      '/tesla-api-usage',
      '/tesla-api-usage/',
      '/tesla-api-usage?vehicle_id=42&from=2026-01-01',
      '/tesla-api-usage#history',
      'tesla-api-usage',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: false, vehicle: false });
    }
    expect(getWorkspaceRouteScope('/drives')).toEqual({ range: true, vehicle: true });
  });

  it('keeps the SQL composing workspace free of misleading vehicle and range controls', () => {
    for (const path of [
      '/power/sql',
      '/power/sql/',
      '/power/sql?vehicle_id=42',
      '/power/sql#editor',
      'power/sql',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: false, vehicle: false });
    }
    expect(getWorkspaceRouteScope('/drives')).toEqual({ range: true, vehicle: true });
    expect(getWorkspaceRouteScope('/vehicles/42')).toEqual({ range: false, vehicle: true });
  });

  it('owns the Explorer range and vehicle on its actual route', () => {
    for (const path of ['/explorer', '/explorer/', '/explorer?from=2026-01-01', '/explorer#methodology']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceRouteScope('/driving/explorer').range).toBe(false);
    expect(getWorkspaceQuickRangePresets('/explorer')).toEqual(['24h', '7d', '30d', '90d']);
  });
  it('offers the six and twenty-four hour shared ranges on physics ledger', () => {
    expect(getWorkspaceRouteScope('/tesla-physics/ledger')).toEqual({ range: true, vehicle: true });
    expect(getWorkspaceQuickRangePresets('/tesla-physics/ledger')).toEqual(['6h', '24h']);
    expect(isWorkspaceRangePresetAvailable('/tesla-physics/ledger', '6h')).toBe(true);
    expect(isWorkspaceRangePresetAvailable('/drives', '6h')).toBe(false);
  });
  it('owns the root-cause analysis range without changing the service evidence workspace', () => {
    for (const path of ['/diagnostics/root-cause', '/diagnostics/root-cause/', '/diagnostics/root-cause?from=2026-01-01']) {
      expect(getWorkspaceRouteScope(path)).toEqual({ range: true, vehicle: true });
    }
    expect(getWorkspaceRouteScope('/diagnostics/service-evidence')).toEqual({ range: false, vehicle: true });
  });
  it('keeps fleet analytics range-owned without implying single-vehicle scope', () => {
    for (const path of [
      '/analytics',
      '/analytics/',
      '/analytics?vehicle_id=42&from=2026-01-01',
      '/analytics#overview',
      'analytics',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: false });
    }
    expect(getWorkspaceRouteScope('/analytics/carbon')).toEqual({ range: true, vehicle: true });
    expect(getWorkspaceRouteScope('/analytics/range')).toEqual({ range: false, vehicle: true });
  });

  it('owns the charge advisor analysis window in the header', () => {
    for (const path of ['/charge-advisor', '/charge-advisor/', '/charge-advisor?from=2026-01-01']) {
      expect(getWorkspaceRouteScope(path)).toEqual({ range: true, vehicle: true });
    }
  });
  it('does not scope account-wide energy installations to a vehicle or date range', () => {
    for (const path of ['/energy-products', '/energy-products/', '/energy-products?site_id=42']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: false, vehicle: false });
    }
    for (const path of ['/projected-range', '/analytics/range']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: false, vehicle: true });
    }
  });

  it('keeps whole-home energy orchestration fleet-wide without misleading workspace filters', () => {
    for (const path of [
      '/energy-orchestrator',
      '/energy-orchestrator/',
      '/energy-orchestrator?vehicle_id=42',
      '/energy-orchestrator#plan',
      'energy-orchestrator',
    ]) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: false, vehicle: false });
    }
    for (const path of ['/energy', '/energy-flow']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({ range: true, vehicle: true });
    }
  });

  it('does not imply live workspace scope for synthetic developer references', () => {
    for (const path of ['/dev/grid-states', '/dev/layout', '/dev/stats']) {
      expect(getWorkspaceRouteScope(path)).toEqual({ range: false, vehicle: false });
    }
    expect(getWorkspaceRouteScope('/dev-tools')).toEqual({ range: false, vehicle: false });
  });

  it('offers year-to-date and year navigation only for Drive Calendar', () => {
    expect(getWorkspaceQuickRangePresets('/drive-calendar/')).toEqual(['7d', '30d', '90d', 'ytd']);
    expect(getWorkspaceQuickRangePresets('/drives')).toEqual(['24h', '7d', '30d', '90d']);
    expect(isWorkspaceRangePresetAvailable('/drive-calendar', '1y')).toBe(false);
    expect(isWorkspaceRangePresetAvailable('/drives', '1y')).toBe(false);
    expect(isWorkspaceRangePresetAvailable('/drive-calendar', '24h')).toBe(false);
    expect(isWorkspaceRangePresetAvailable('/drives', '24h')).toBe(true);
    expect(isWorkspaceRangePresetAvailable('/drive-calendar', 'ytd')).toBe(true);
    expect(isWorkspaceRangePresetAvailable('/drives', 'ytd')).toBe(false);
    expect(isWorkspaceRangePresetAvailable('/drives', 'all')).toBe(true);
  });

  it('enables both canonical controls on vehicle history pages', () => {
    expect(getWorkspaceRouteScope('/driving-dynamics')).toEqual({
      range: true,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/charging?tab=sessions')).toEqual({
      range: true,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/media-player')).toEqual({
      range: true,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/command-reliability')).toEqual({
      range: true,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/drive-calendar')).toEqual({
      range: true,
      vehicle: true,
    });
    for (const path of ['/fsd', '/signal-explorer', '/signal-log', '/signals']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({
        range: true,
        vehicle: true,
      });
    }
  });

  it('shows only controls that affect the active page', () => {
    expect(getWorkspaceRouteScope('/battery')).toEqual({
      range: false,
      vehicle: true,
    });
    expect(getWorkspaceRouteScope('/api-logs')).toEqual({
      range: true,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/automations/history')).toEqual({
      range: true,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/power-flow')).toEqual({
      range: true,
      vehicle: false,
    });
  });

  it('owns the period comparison vehicle without overriding independent periods', () => {
    for (const path of ['/period-compare', '/period-compare/', '/period-compare?period_a=7&period_b=0']) {
      expect(getWorkspaceRouteScope(path), path).toEqual({
        range: false,
        vehicle: true,
      });
    }
    expect(getWorkspaceRouteScope('/vehicle-comparison')).toEqual({
      range: false,
      vehicle: false,
    });
  });

  it('keeps workflow and settings routes free of misleading global filters', () => {
    expect(getWorkspaceRouteScope('/settings/')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/notifications/rules')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/action-center')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/signal-diff')).toEqual({
      range: false,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/tesla-charging-history')).toEqual({
      range: true,
      vehicle: false,
    });
    expect(getWorkspaceRouteScope('/tesla-charging-sessions')).toEqual({
      range: true,
      vehicle: false,
    });
  });

  it('keeps detail-route vehicle context while hiding the global range', () => {
    expect(getWorkspaceRouteScope('/vehicles/42')).toEqual({
      range: false,
      vehicle: true,
    });
  });

  it('never offers the global analysis window on a deep entity detail route', () => {
    for (const path of [
      '/drives/4421',
      '/drives/4421/replay',
      '/charging/88',
      '/trips/7',
      '/vehicles/42/access',
      '/system-status/incidents/12',
    ]) {
      expect(getWorkspaceRouteScope(path).range, path).toBe(false);
    }
  });

  it('normalizes query strings, hashes, and trailing slashes identically', () => {
    const canonical = getWorkspaceRouteScope('/drives');
    for (const variant of ['/drives/', '/drives?from=2026-01-01', '/drives#top', 'drives']) {
      expect(getWorkspaceRouteScope(variant), variant).toEqual(canonical);
    }
  });

  it('is stable and never throws for unknown routes', () => {
    expect(getWorkspaceRouteScope('/totally-unknown')).toEqual({
      range: false,
      vehicle: true,
    });
    expect(() => getWorkspaceRouteScope('')).not.toThrow();
  });
});

// ── Contract drift guards ─────────────────────────────────────────────────
//
// The context bar is metadata-driven: these sets decide whether the shell
// renders the global vehicle / range control at all. A stale entry means the
// shell offers a control the page cannot consume (or hides one it needs), so
// the sets are pinned against the generated route registry.

describe('workspace scope metadata', () => {
  const registeredPaths = new Set(ROUTE_REGISTRY.map((route) => route.path));

  it('only grants range ownership to routes that actually exist', () => {
    const orphans = [...RANGE_ENABLED_PATHS].filter((path) => !registeredPaths.has(path));
    expect(orphans, `unknown range-enabled routes: ${orphans.join(', ')}`).toEqual([]);
  });

  it('only disables vehicle scope for routes that actually exist', () => {
    const orphans = [...VEHICLE_DISABLED_PATHS].filter(
      (path) => !registeredPaths.has(path),
    );
    expect(orphans, `unknown vehicle-disabled routes: ${orphans.join(', ')}`).toEqual([]);
  });

  it('declares every vehicle-disabled prefix as a rooted path segment', () => {
    for (const prefix of VEHICLE_DISABLED_PREFIXES) {
      expect(prefix.startsWith('/'), prefix).toBe(true);
      expect(prefix.endsWith('/'), prefix).toBe(false);
    }
  });

  it('never lists a path as both range-owning and a vehicle-disabled prefix root', () => {
    for (const prefix of VEHICLE_DISABLED_PREFIXES) {
      // A prefix root itself may still own a range (e.g. /notifications/inbox
      // is a child, not the root) — the root path must not be range-enabled
      // because the shell would show a window nothing consumes.
      expect(RANGE_ENABLED_PATHS.has(prefix), prefix).toBe(false);
    }
  });

  it('exposes at most one canonical owner per control for a given route', () => {
    // Structural guarantee behind "no duplicate context controls": the scope
    // resolver returns exactly one boolean per control kind, so the shell and
    // the page can never both claim ownership.
    const scope = getWorkspaceRouteScope('/drives');
    expect(Object.keys(scope).sort()).toEqual(['range', 'vehicle']);
    expect(typeof scope.range).toBe('boolean');
    expect(typeof scope.vehicle).toBe('boolean');
  });

  it('audits every lazy-loaded routed page for real header range ownership', () => {
    const visited = new Set(routedPages.map(({ name }) => name));
    visited.add('Dashboard'); // index route has no path attribute
    const unmounted = [...lazyPages.keys()].filter((name) => !visited.has(name));
    expect(unmounted).toEqual([]);

    const missingSources = [...lazyPages.values()].filter((path) => !pageSources[path]);
    expect(missingSources).toEqual([]);

    const unscoped = routedPages.flatMap(({ path, name }) => {
      const page = pageSources[lazyPages.get(name) ?? ''];
      if (!page) return [];
      const pageFile = nodePath.resolve(process.cwd(), 'src/lib/__tests__', lazyPages.get(name) ?? '');
      const hasRange = (getWorkspaceRouteScope(path).range && sourceHookCalls(pageFile).some((call) =>
        call.name === 'useRangeState' &&
        call.module === nodePath.resolve(process.cwd(), 'src/hooks/useRangeState.ts'))) ||
        (name === 'ArchivedPage' && page.includes('<InboxBody'));
      const hasPagePicker = page.includes('<RangePicker');
      if (getWorkspaceRouteScope(path).range && !hasRange) return [path];
      if (hasPagePicker && !getWorkspaceRouteScope(path).range) return [path];
      return [];
    });
    expect(unscoped).toEqual([]);
  });
});
