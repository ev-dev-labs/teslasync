import { describe, expect, it } from 'vitest';
import {
  RANGE_ENABLED_PATHS,
  VEHICLE_DISABLED_PATHS,
  VEHICLE_DISABLED_PREFIXES,
  getWorkspaceRouteScope,
} from '../workspaceScope';
import { ROUTE_REGISTRY } from '../routeRegistry';

describe('getWorkspaceRouteScope', () => {
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
    expect(getWorkspaceRouteScope('/power-flow')).toEqual({
      range: true,
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
});
