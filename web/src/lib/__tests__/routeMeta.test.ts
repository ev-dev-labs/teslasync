import { describe, it, expect } from 'vitest';
import { ROUTE_REGISTRY } from '../routeRegistry';
import { ROUTE_META } from '../routeMeta';

describe('ROUTE_META', () => {
  it('has an entry for every route in ROUTE_REGISTRY', () => {
    const missing = ROUTE_REGISTRY
      .filter((r) => !ROUTE_META[r.path])
      .map((r) => r.path);
    expect(missing, `missing ROUTE_META entries: ${missing.join(', ')}`).toEqual([]);
  });

  it('every parent reference resolves to a real entry', () => {
    const dangling: string[] = [];
    for (const [path, meta] of Object.entries(ROUTE_META)) {
      if (meta.parent && !ROUTE_META[meta.parent]) {
        dangling.push(`${path} → ${meta.parent}`);
      }
    }
    expect(dangling, `dangling parent refs: ${dangling.join(', ')}`).toEqual([]);
  });

  it('parent chains terminate (no cycles)', () => {
    for (const startPath of Object.keys(ROUTE_META)) {
      const seen = new Set<string>();
      let cur: string | undefined = startPath;
      while (cur) {
        if (seen.has(cur)) {
          throw new Error(
            `Cycle in ROUTE_META parent chain starting at ${startPath}: revisited ${cur}`,
          );
        }
        seen.add(cur);
        cur = ROUTE_META[cur]?.parent;
      }
    }
  });

  it('every entry carries a non-empty defaultLabel and i18nKey', () => {
    for (const [path, meta] of Object.entries(ROUTE_META)) {
      expect(meta.i18nKey, `i18nKey missing for ${path}`).toBeTruthy();
      expect(meta.defaultLabel, `defaultLabel missing for ${path}`).toBeTruthy();
    }
  });
});

// ── Deep-route breadcrumb coverage ────────────────────────────────────────
//
// Breadcrumbs are metadata-driven: a deep route without a `parent` renders as
// "Home > Leaf" and loses the hierarchy the user navigated through. These
// guards keep detail / admin / analytics / repair routes honest without any
// page-by-page hardcoding.

/** Walk `parent` up to the root and return the full trail (root → leaf). */
function trailFor(path: string): string[] {
  const trail: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = path;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    trail.unshift(cur);
    cur = ROUTE_META[cur]?.parent;
  }
  return trail;
}

describe('ROUTE_META breadcrumb hierarchy', () => {
  /**
   * Nested URL segments that are legitimately top-level:
   *   - `/s/:token` is a public share link rendered outside the app shell.
   *   - `/notifications/inbox` is itself the notifications hub root; every
   *     other `/notifications/*` page hangs off it.
   */
  const HIERARCHY_EXEMPT = new Set(['/s/:token', '/notifications/inbox']);

  it('gives every nested route pattern a parent so the trail is complete', () => {
    const flat = Object.keys(ROUTE_META).filter((path) => {
      if (HIERARCHY_EXEMPT.has(path)) return false;
      const segments = path.split('/').filter(Boolean);
      if (segments.length < 2) return false;
      return !ROUTE_META[path]?.parent;
    });
    expect(flat, `nested routes without a breadcrumb parent: ${flat.join(', ')}`).toEqual([]);
  });

  it('nests every /admin route under a reachable operator surface', () => {
    const adminRoutes = Object.keys(ROUTE_META).filter((p) => p.startsWith('/admin/'));
    expect(adminRoutes.length).toBeGreaterThan(5);
    for (const path of adminRoutes) {
      const trail = trailFor(path);
      expect(trail.length, `${path} has no parent chain`).toBeGreaterThan(1);
      expect(trail[0]).toBe('/dev-tools');
    }
  });

  it('nests analytics sub-surfaces under /analytics', () => {
    for (const path of [
      '/analytics/anomalies',
      '/analytics/carbon',
      '/analytics/range',
      '/analytics/tco',
    ]) {
      expect(trailFor(path)).toEqual(['/analytics', path]);
    }
  });

  it('nests notification workspace pages under the inbox', () => {
    for (const path of [
      '/notifications/alerts',
      '/notifications/rules',
      '/notifications/channels',
      '/notifications/webhooks',
      '/notifications/quiet-hours',
      '/notifications/audit',
    ]) {
      expect(trailFor(path)).toEqual(['/notifications/inbox', path]);
    }
  });

  it('nests diagnostics and repair surfaces under system status / maintenance', () => {
    expect(trailFor('/diagnostics/root-cause')).toEqual([
      '/system-status',
      '/diagnostics/root-cause',
    ]);
    expect(trailFor('/diagnostics/rul')).toEqual(['/system-status', '/diagnostics/rul']);
    expect(trailFor('/system-status/incidents/:id')).toEqual([
      '/system-status',
      '/system-status/incidents/:id',
    ]);
    expect(trailFor('/diagnostics/service-evidence')).toEqual([
      '/maintenance',
      '/diagnostics/service-evidence',
    ]);
  });

  it('keeps multi-level entity detail trails intact', () => {
    expect(trailFor('/drives/:id/replay')).toEqual([
      '/drives',
      '/drives/:id',
      '/drives/:id/replay',
    ]);
    expect(trailFor('/vehicles/:id/access')).toEqual([
      '/vehicles',
      '/vehicles/:id',
      '/vehicles/:id/access',
    ]);
  });

  it('nests experimental intelligence surfaces under a real hub', () => {
    for (const path of Object.keys(ROUTE_META).filter((p) =>
      p.startsWith('/intelligence/'),
    )) {
      expect(trailFor(path)[0], path).toBe('/intelligence-packs');
    }
    for (const path of Object.keys(ROUTE_META).filter((p) => p.startsWith('/ownership/'))) {
      expect(trailFor(path)[0], path).toBe('/tco');
    }
  });
});
