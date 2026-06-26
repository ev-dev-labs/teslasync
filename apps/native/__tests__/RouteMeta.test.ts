import {ROUTE_REGISTRY} from '../src/web-parity/lib/routeRegistry';
import {ROUTE_META, RouteMeta} from '../src/web-parity/lib/routeMeta';

// Mirrors web/src/lib/__tests__/routeMeta.test.ts (vitest -> jest): the same
// four invariants that keep the breadcrumb hierarchy honest — full coverage of
// the registry, resolvable parents, acyclic chains, and non-empty labels.
describe('web-parity routeMeta', () => {
  it('has an entry for every route in ROUTE_REGISTRY', () => {
    const missing = ROUTE_REGISTRY.filter(r => !ROUTE_META[r.path]).map(
      r => r.path,
    );
    expect(missing).toEqual([]);
  });

  it('every parent reference resolves to a real entry', () => {
    const dangling: string[] = [];
    for (const [path, meta] of Object.entries(ROUTE_META)) {
      if (meta.parent && !ROUTE_META[meta.parent]) {
        dangling.push(`${path} -> ${meta.parent}`);
      }
    }
    expect(dangling).toEqual([]);
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
    for (const meta of Object.values(ROUTE_META)) {
      expect(meta.i18nKey).toBeTruthy();
      expect(meta.defaultLabel).toBeTruthy();
    }
  });

  it('declares the expected nested parent overrides', () => {
    const overrides: Array<[string, string]> = Object.entries(ROUTE_META)
      .filter((entry): entry is [string, RouteMeta] => Boolean(entry[1].parent))
      .map(([path, meta]) => [path, meta.parent as string]);
    expect(overrides).toEqual(
      expect.arrayContaining([
        ['/drives/:id', '/drives'],
        ['/drives/:id/replay', '/drives/:id'],
        ['/charging/:id', '/charging'],
        ['/vehicles/:id', '/vehicles'],
        ['/vehicles/:id/access', '/vehicles/:id'],
        ['/trips/:id', '/trips'],
        ['/automations/new', '/automations'],
        ['/automations/:id/edit', '/automations'],
        ['/notifications/studio', '/notifications/inbox'],
        ['/notifications/archived', '/notifications/inbox'],
        ['/year-review/:year', '/analytics'],
        ['/me/activity', '/'],
      ]),
    );
    // Top-level pages stay parentless so their breadcrumb suppresses itself.
    expect(ROUTE_META['/'].parent).toBeUndefined();
    expect(ROUTE_META['/drives'].parent).toBeUndefined();
  });
});
