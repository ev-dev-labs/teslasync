// Breadcrumb dedupe & app-wide adoption.

// Single source of truth for breadcrumb hierarchy. Every entry in
// `routeRegistry.ts` MUST have a matching entry here (enforced by the unit
// test in `__tests__/routeMeta.test.ts`). Most top-level pages have NO
// `parent` and render as Home > Current Page. Nested/detail routes declare a
// parent and render the complete hierarchy.

// Pages can supply per-render label overrides (e.g. "Drive #4421" → "Trip to
// office") via the `breadcrumbLabels` prop on `<PageContainer>`, which
// flows through `useBreadcrumbs`.

import { ROUTE_REGISTRY } from './routeRegistry';

export interface RouteMeta {
  /** i18n key for the human-readable label (falls back to `defaultLabel`). */
  i18nKey: string;
  /**
 * Stable English label used as the i18n fallback so pages still render
 * sensibly when a translation is missing.
 */
  defaultLabel: string;
  /**
 * Parent route pattern. The breadcrumb hook walks this chain to compose
 * the trail. Omit for top-level routes.
 */
  parent?: string;
}

/**
 * Explicit parent overrides for nested / detail routes. Anything not listed
 * here is treated as a top-level page.
 *
 * NOTE: parent values MUST appear in `ROUTE_REGISTRY` (validated by the
 * routeMeta unit test, which also detects cycles).
 */
const PARENT_OVERRIDES: Record<string, string> = {
  '/drives/:id': '/drives',
  '/drives/:id/replay': '/drives/:id',
  '/charging/:id': '/charging',
  '/vehicles/:id': '/vehicles',
  '/vehicles/:id/access': '/vehicles/:id',
  '/trips/:id': '/trips',
  '/automations/new': '/automations',
  '/automations/:id/edit': '/automations',
  '/notifications/studio': '/notifications/inbox',
  '/notifications/archived': '/notifications/inbox',
  '/year-review/:year': '/analytics',
  '/me/activity': '/',
};

/**
 * ROUTE_META is derived from ROUTE_REGISTRY so that adding a new route in
 * App.tsx (and re-running the registry generator) automatically gives it
 * a baseline breadcrumb entry. Only opt-in to a parent chain by editing
 * `PARENT_OVERRIDES` above.
 */
export const ROUTE_META: Readonly<Record<string, RouteMeta>> = Object.fromEntries(
  ROUTE_REGISTRY.map((r) => [
    r.path,
    {
      i18nKey: r.i18nKey,
      defaultLabel: r.label,
      parent: PARENT_OVERRIDES[r.path],
    } satisfies RouteMeta,
  ]),
);
