import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Per-render breadcrumb label overrides keyed by route pattern (e.g.
 * `{ '/drives/:id': '196th Street → Northeast 90th' }`). Pages push their
 * dynamic labels up to the global Layout breadcrumb via this context so
 * the single global breadcrumb slot can show rich, friendly labels without
 * each page rendering its own duplicate breadcrumb row.
 *
 * Layout reads `useBreadcrumbOverrides()` and forwards the merged map to
 * `useBreadcrumbs(overrides)`. Pages call `useSetBreadcrumbOverrides({...})`
 * inside an effect to register their labels for the current route.
 */
type BreadcrumbOverrideMap = Partial<Record<string, string>>;

interface BreadcrumbOverridesContextValue {
  overrides: BreadcrumbOverrideMap;
  /**
   * Register an override map for the current page. Returns an unregister
   * function. Layout merges all registered maps shallow-left-to-right so a
   * later registration wins for the same route key (matches React's
   * latest-effect-wins semantics).
   */
  register: (id: number, map: BreadcrumbOverrideMap) => void;
  unregister: (id: number) => void;
}

const BreadcrumbOverridesContext = createContext<BreadcrumbOverridesContextValue | null>(null);

let nextId = 1;

export function BreadcrumbOverridesProvider({ children }: { children: ReactNode }) {
  // Map of registration-id -> overrides. Multiple consumers can register
  // simultaneously (e.g. a parent layout + a nested PageContainer); we
  // merge them on read so neither stomps the other.
  const [registrations, setRegistrations] = useState<ReadonlyMap<number, BreadcrumbOverrideMap>>(
    () => new Map(),
  );

  const register = useCallback((id: number, map: BreadcrumbOverrideMap) => {
    setRegistrations((prev) => {
      const next = new Map(prev);
      next.set(id, map);
      return next;
    });
  }, []);

  const unregister = useCallback((id: number) => {
    setRegistrations((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const overrides = useMemo<BreadcrumbOverrideMap>(() => {
    const merged: BreadcrumbOverrideMap = {};
    for (const map of registrations.values()) {
      for (const [k, v] of Object.entries(map)) {
        if (v) merged[k] = v;
      }
    }
    return merged;
  }, [registrations]);

  const value = useMemo<BreadcrumbOverridesContextValue>(
    () => ({ overrides, register, unregister }),
    [overrides, register, unregister],
  );

  return (
    <BreadcrumbOverridesContext.Provider value={value}>
      {children}
    </BreadcrumbOverridesContext.Provider>
  );
}

export function useBreadcrumbOverrides(): BreadcrumbOverrideMap {
  const ctx = useContext(BreadcrumbOverridesContext);
  return ctx?.overrides ?? {};
}

/**
 * Push an override map up to the global Layout breadcrumb for the current
 * page. Pass `undefined` (or omit) to register nothing.
 *
 * Stable across renders as long as the map's serialised content is stable.
 * The map is JSON-compared so passing inline literals is safe.
 */
export function useSetBreadcrumbOverrides(map?: BreadcrumbOverrideMap): void {
  const ctx = useContext(BreadcrumbOverridesContext);
  const idRef = useRef<number | null>(null);
  // Serialise the map so we don't re-register on every render when callers
  // pass a fresh object literal with identical content.
  const serialised = map ? JSON.stringify(map) : '';

  useEffect(() => {
    if (!ctx) return;
    if (!serialised) {
      if (idRef.current != null) {
        ctx.unregister(idRef.current);
        idRef.current = null;
      }
      return;
    }
    if (idRef.current == null) idRef.current = nextId++;
    const id = idRef.current;
    ctx.register(id, JSON.parse(serialised) as BreadcrumbOverrideMap);
    return () => {
      ctx.unregister(id);
      idRef.current = null;
    };
  }, [ctx, serialised]);
}
