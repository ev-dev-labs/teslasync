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
