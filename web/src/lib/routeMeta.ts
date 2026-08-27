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
  // ── Entity detail chains ───────────────────────────────────────────────
  '/drives/:id': '/drives',
  '/drives/:id/replay': '/drives/:id',
  '/charging/:id': '/charging',
  '/vehicles/:id': '/vehicles',
  '/vehicles/:id/access': '/vehicles/:id',
  '/trips/:id': '/trips',
  '/sharing/trips': '/trips',
  '/automations/new': '/automations',
  '/automations/list': '/automations',
  '/automations/:id/edit': '/automations',
  '/year-review/:year': '/analytics',
  '/me/activity': '/',

  // ── Charging sub-surfaces ──────────────────────────────────────────────
  '/charging/costs': '/charging',
  '/charging/curves': '/charging',
  '/charging/schedule': '/charging',
  '/charging/vampire-drain': '/charging',

  // ── Battery / energy sub-surfaces ──────────────────────────────────────
  '/battery/health': '/battery',
  '/power/dashboards': '/power-flow',
  '/power/grafana': '/power-flow',
  '/power/sql': '/power-flow',

  // ── Analytics sub-surfaces ─────────────────────────────────────────────
  '/analytics/anomalies': '/analytics',
  '/analytics/carbon': '/analytics',
  '/analytics/range': '/analytics',
  '/analytics/tco': '/analytics',
  '/benchmarks/privacy': '/analytics',

  // ── Advanced / experimental intelligence ───────────────────────────────
  '/intelligence/behavioral-sentinel': '/intelligence-packs',
  '/intelligence/causal-lab': '/intelligence-packs',
  '/intelligence/charging-forensics': '/intelligence-packs',
  '/intelligence/charging-site-twin': '/intelligence-packs',
  '/intelligence/component-survival': '/intelligence-packs',
  '/intelligence/emergency-resilience': '/intelligence-packs',
  '/intelligence/federated-learning': '/intelligence-packs',
  '/intelligence/firmware-canary': '/intelligence-packs',
  '/intelligence/journey-assurance': '/intelligence-packs',
  '/intelligence/road-hazards': '/intelligence-packs',
  '/intelligence/tco-optimizer': '/intelligence-packs',
  '/intelligence/twin-lab': '/intelligence-packs',
  '/ownership/charging-reconciliation': '/tco',
  '/ownership/consumables-lifecycle': '/tco',
  '/ownership/data-governance': '/tco',
  '/ownership/driver-attribution': '/tco',
  '/ownership/insurance-telematics': '/tco',
  '/ownership/jurisdiction-compliance': '/tco',
  '/ownership/model-trust': '/tco',
  '/ownership/subscription-roi': '/tco',
  '/ownership/tariff-lab': '/tco',
  '/ownership/warranty-command': '/tco',

  // ── Notifications workspace ────────────────────────────────────────────
  '/notifications/studio': '/notifications/inbox',
  '/notifications/archived': '/notifications/inbox',
  '/notifications/alerts': '/notifications/inbox',
  '/notifications/audit': '/notifications/inbox',
  '/notifications/browser': '/notifications/inbox',
  '/notifications/channels': '/notifications/inbox',
  '/notifications/quiet-hours': '/notifications/inbox',
  '/notifications/rules': '/notifications/inbox',
  '/notifications/webhooks': '/notifications/inbox',

  // ── Diagnostics / repair ───────────────────────────────────────────────
  '/diagnostics/root-cause': '/system-status',
  '/diagnostics/rul': '/system-status',
  '/diagnostics/service-evidence': '/maintenance',
  '/system-status/incidents/:id': '/system-status',
  '/docs/status-api': '/system-status',

  // ── Administration & developer surfaces ────────────────────────────────
  '/admin/audit-log': '/dev-tools',
  '/admin/disk-forecast': '/dev-tools',
  '/admin/dlq': '/dev-tools',
  '/admin/feedback': '/dev-tools',
  '/admin/flags': '/dev-tools',
  '/admin/gdpr-exports': '/dev-tools',
  '/admin/ingest-xray': '/dev-tools',
  '/admin/live-signals': '/dev-tools',
  '/admin/schema-drift': '/dev-tools',
  '/admin/secret-rotation': '/dev-tools',
  '/admin/slow-queries': '/dev-tools',
  '/admin/telemetry/coverage': '/dev-tools',
  '/admin/vehicle-cost': '/dev-tools',

  // ── Account & settings ─────────────────────────────────────────────────
  '/account/2fa': '/settings',
  '/account/privacy': '/settings',
  '/account/sessions': '/settings',
  '/settings/safety': '/settings',
  '/integrations/helix': '/settings',
  '/vehicle-systems/software': '/software-updates',
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
