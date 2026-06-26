/**
 * Route prefetch on link focus / press-in — native parity port of
 * web/src/lib/routePrefetch.ts.
 *
 * WEB BEHAVIOR (for reference): every route in `web/src/App.tsx` is code-split
 * via `React.lazy(() => import(...))`. The first navigation to a route pays the
 * full chunk-fetch + parse cost, which shows as a brief PageLoadSkeleton flash
 * on a typical 100 ms-RTT connection. The web `<PrefetchLink>` eagerly
 * downloads the destination chunk on hover / focus, so the actual click
 * navigates to a chunk already in the runtime cache and the destination renders
 * instantly. Each preload runs at most once per page lifetime; failed downloads
 * are evicted from the cache so the prefetch can be retried on the next hover
 * (the click itself also triggers the import via React.lazy on a miss).
 *
 * NATIVE REALITY (contract rule 7 — browser-only behavior): React Native ships
 * a single Metro JS bundle and React Navigation registers every screen up
 * front, so there are NO per-route network chunks to prefetch — the destination
 * module is already resident the moment the app boots. The "download the chunk
 * on hover" optimization therefore has no native analog and is a tracked no-op
 * here (see ROUTE_PREFETCH_NATIVE_UNAVAILABLE_REASON).
 *
 * What IS preserved for parity: the exact prefetchable-path set and the
 * call/track contract. A native focus / press-in analog of `<PrefetchLink>`
 * (or the command palette, deep-link prewarm, etc.) can call `prefetchRoute`
 * harmlessly, and `isPrefetchablePath` returns byte-identical truth values to
 * web — so any shared navigation chrome behaves the same on both platforms.
 *
 * PREFETCHABLE_PATHS below mirrors the `lazy(() => import(...))` statements in
 * `web/src/App.tsx`. It is HAND-MAINTAINED — when a new lazy route is added to
 * `App.tsx`, add a row here so the native path set stays in lockstep with web.
 * Routes not in this set are silently skipped: prefetch is best-effort and
 * never required for correctness on either platform.
 *
 * Unlike web, the entries are plain path strings (data only) — there is no
 * `import(...)` here, so no DOM-only module, browser HTML element, Recharts,
 * Leaflet, or old web UI component is pulled into the native bundle, and the
 * Vite "string-literal so the bundler can statically emit the same chunk"
 * constraint does not apply.
 */

/**
 * Native-safe preloader. There is no code-split chunk to fetch under Metro, so
 * "preloading" a route is already satisfied — this resolves immediately. Kept
 * as a function (rather than dropping the call) to preserve the web preloader
 * contract shape: invoked at most once per path, with `.catch` eviction so a
 * future real preload could be retried on the next focus.
 */
const nativeNoopPreload: () => Promise<unknown> = () => Promise.resolve();

/**
 * The prefetchable route patterns, mirroring the `web/src/App.tsx`
 * `React.lazy(() => import(...))` imports one-for-one. Only the keys are
 * carried across: the web module specifiers (e.g. `../features/.../Page`) are a
 * browser chunk-identity detail with no native meaning. Exported so the parity
 * test can assert this set stays equal to the web PRELOADERS keys.
 */
export const PREFETCHABLE_PATHS: readonly string[] = [
  '/',
  '/admin/feedback',
  '/admin/telemetry/coverage',
  '/alert-rules',
  '/alert-studio',
  '/alerts',
  '/analytics',
  '/anomaly-detection',
  '/api-keys',
  '/api-logs',
  '/api-playground',
  '/automations',
  '/automations/:id/edit',
  '/automations/list',
  '/automations/new',
  '/backup',
  '/battery',
  '/battery-cells',
  '/battery-degradation',
  '/charging',
  '/charging-curve',
  '/charging-heatmap',
  '/charging/:id',
  '/chatbot',
  '/climate-control',
  '/command-history',
  '/commands',
  '/cost-analysis',
  '/data-export',
  '/data-repair',
  '/db-health',
  '/dev-tools',
  '/digital-twin',
  '/drive-score',
  '/drives',
  '/drives/:id',
  '/drives/:id/replay',
  '/drivetrain-health',
  '/driving-dynamics',
  '/efficiency',
  '/energy',
  '/energy-flow',
  '/energy-products',
  '/exports',
  '/fleet-api',
  '/geofences',
  '/glance',
  '/guard-mode',
  '/lifetime-stats',
  '/live',
  '/live-monitor',
  '/locations',
  '/maintenance',
  '/me/activity',
  '/media-player',
  '/mileage',
  '/mqtt-inspector',
  '/navigation',
  '/notifications',
  '/notifications/alerts',
  '/notifications/archived',
  '/notifications/audit',
  '/notifications/browser',
  '/notifications/channels',
  '/notifications/inbox',
  '/notifications/quiet-hours',
  '/notifications/rules',
  '/notifications/studio',
  '/notifications/webhooks',
  '/onboarding',
  '/period-compare',
  '/power-flow',
  '/powershare',
  '/projected-range',
  '/quick-stats',
  '/redis-signals',
  '/regen-efficiency',
  '/roadmap',
  '/route-efficiency',
  '/s/:token',
  '/safety-settings',
  '/search',
  '/security-access',
  '/settings',
  '/signal-diff',
  '/signal-explorer',
  '/signal-gaps',
  '/signal-log',
  '/sleep-efficiency',
  '/smart-charge',
  '/software-updates',
  '/speed-profile',
  '/state-debugger',
  '/statistics',
  '/system-status',
  '/tco',
  '/temperature-impact',
  '/tesla-account',
  '/tesla-charging-history',
  '/tesla-charging-sessions',
  '/timeline',
  '/tire-pressure',
  '/trip-planner',
  '/trips',
  '/trips/:id',
  '/vampire-drain',
  '/vehicle-comparison',
  '/vehicles',
  '/vehicles/:id',
  '/vehicles/:id/access',
  '/watch',
  '/weekly-digest',
  '/year-review/:year',
] as const;

function buildPreloaders(
  paths: readonly string[],
): Readonly<Record<string, () => Promise<unknown>>> {
  const map: Record<string, () => Promise<unknown>> = {};
  for (const path of paths) {
    map[path] = nativeNoopPreload;
  }
  return map;
}

const PRELOADERS: Readonly<Record<string, () => Promise<unknown>>> =
  buildPreloaders(PREFETCHABLE_PATHS);

const prefetched = new Set<string>();

/**
 * Eagerly "download" the route module for `path`. Called by a native focus /
 * press-in navigation analog of web's `<PrefetchLink>`; safe to call repeatedly
 * with the same path (subsequent calls are no-ops once tracked).
 *
 * - Empty / missing path → no-op (defensive).
 * - Path with no PRELOADERS entry → no-op (silent; not all routes are listed,
 *   e.g. dynamic links computed at click time).
 * - Failed preload → evicted from the prefetched set so the next focus retries.
 *   On native the preload resolves immediately (single Metro bundle, nothing to
 *   download), so this eviction branch never fires — it is kept to preserve the
 *   web contract shape.
 */
export function prefetchRoute(path: string): void {
  if (!path) {
    return;
  }
  if (prefetched.has(path)) {
    return;
  }
  const preload = PRELOADERS[path];
  if (!preload) {
    return;
  }
  prefetched.add(path);
  void preload().catch(() => {
    prefetched.delete(path);
  });
}

/** Returns true when `path` has at least one matching PRELOADERS entry. */
export function isPrefetchablePath(path: string): boolean {
  return path in PRELOADERS;
}

/** Test helper: clear the prefetched set so each test starts fresh. */
export function __resetPrefetchedForTests(): void {
  prefetched.clear();
}

/** Test helper: list the paths that have been prefetched this lifetime. */
export function __getPrefetchedForTests(): readonly string[] {
  return [...prefetched];
}

/**
 * Explicit unavailable-state for the route-chunk prefetch optimization on
 * React Native. Surfaced (mirroring LOG_STREAM_UNAVAILABLE_REASON /
 * APP_ICON_PNG_UNAVAILABLE_REASON / LEAFLET_GLOBAL_UNAVAILABLE_REASON) so
 * callers/tests can document why `prefetchRoute` performs no network work
 * rather than guessing at the silent no-op.
 */
export const ROUTE_PREFETCH_NATIVE_UNAVAILABLE_REASON =
  'React Native ships a single Metro bundle with every screen already resident (no React.lazy code-split chunks to fetch), so route-chunk prefetch is a no-op; prefetchRoute still tracks calls and isPrefetchablePath stays in parity with web for shared navigation chrome.';
