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
const EMPTY_BREADCRUMB_OVERRIDES: BreadcrumbOverrideMap = {};

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
  return ctx?.overrides ?? EMPTY_BREADCRUMB_OVERRIDES;
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
  // Depend on the stable `register` / `unregister` callbacks (both are
  // `useCallback(…, [])` in the provider) rather than the whole context
  // value. The context value's identity changes on EVERY registration
  // because `overrides` is re-derived each time, so keying the effect on
  // `ctx` would make it re-run → unregister → re-register in an infinite
  // loop the moment any non-empty map is registered.
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const idRef = useRef<number | null>(null);
  // Serialise the map so we don't re-register on every render when callers
  // pass a fresh object literal with identical content.
  const serialised = map ? JSON.stringify(map) : '';

  useEffect(() => {
    if (!register || !unregister) return;
    if (!serialised) {
      if (idRef.current != null) {
        unregister(idRef.current);
        idRef.current = null;
      }
      return;
    }
    if (idRef.current == null) idRef.current = nextId++;
    const id = idRef.current;
    register(id, JSON.parse(serialised) as BreadcrumbOverrideMap);
    return () => {
      unregister(id);
      idRef.current = null;
    };
  }, [register, unregister, serialised]);
}
