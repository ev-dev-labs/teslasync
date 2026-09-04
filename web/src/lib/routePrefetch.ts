/**
 * Route prefetch on link hover, focus, or pointer intent.
 *
 * Every route in `App.tsx` is code-split via `React.lazy()`. The first
 * navigation to a route pays the full chunk-fetch + parse cost, which
 * shows as a brief PageLoadSkeleton flash on a typical 100 ms-RTT
 * connection. By eagerly downloading the chunk on hover/focus of the
 * navigation link, the actual click navigates to a chunk that is
 * already in the runtime cache, so the destination renders instantly. Pointer
 * intent gives touch and pen users the same early-start path as mouse users.
 *
 * Each preload is invoked at most once per page lifetime; subsequent
 * hovers are no-ops. Failed downloads are evicted from the cache so
 * the prefetch can be retried on the next hover (the click itself
 * will also trigger the import via React.lazy on miss).
 *
 * The PRELOADERS map below mirrors the `lazy(() => import(...))`
 * statements in `web/src/App.tsx`. It is HAND-MAINTAINED — when a new
 * lazy route is added to `App.tsx`, add a row here so it benefits
 * from prefetch. Routes not in this map are silently skipped: prefetch
 * is best-effort and never required for correctness.
 *
 * NOTE: import paths must be string literals so Vite can statically
 * analyse them and emit the same chunk that `React.lazy` produces.
 * Variable interpolation breaks chunk identity and forces a separate
 * fetch on click.
 */

const PRELOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  '/': () => import('../features/dashboard/pages/DashboardPage'),
  '/activity': () => import('../features/system/pages/ActivityTimelinePage'),
  '/admin/feedback': () => import('../features/admin/pages/FeedbackQueuePage'),
  '/admin/telemetry/coverage': () => import('../features/admin/pages/FleetTelemetryCoveragePage'),
  '/alert-rules': () => import('../features/notifications/components/LegacyAlertRulesRedirect'),
  '/alert-studio': () => import('../features/notifications/components/LegacyAlertStudioRedirect'),
  '/alerts': () => import('../features/notifications/components/LegacyAlertsRedirect'),
  '/analytics': () => import('../features/analytics/pages/AnalyticsPage'),
  '/anomaly-detection': () => import('../features/diagnostics/pages/AnomalyDashboardPage'),
  '/api-keys': () => import('../features/admin/pages/APIKeysPage'),
  '/api-logs': () => import('../features/admin/pages/ApiLogsPage'),
  '/api-playground': () => import('../features/admin/pages/ApiPlaygroundPage'),
  '/automations': () => import('../features/automations/pages/AutomationsListPage'),
  '/automations/:id/edit': () => import('../features/automations/pages/AutomationBuilderPage'),
  '/automations/list': () => import('../features/automations/pages/AutomationListPage'),
  '/automations/new': () => import('../features/automations/pages/AutomationBuilderPage'),
  '/backup': () => import('../features/admin/pages/BackupRestorePage'),
  '/battery': () => import('../features/battery/pages/BatteryHealthPage'),
  '/battery-cells': () => import('../features/battery/pages/BatteryCellsPage'),
  '/battery-degradation': () => import('../features/battery/pages/BatteryDegradationPage'),
  '/charging': () => import('../features/charging/pages/ChargingListPage'),
  '/charging-curve': () => import('../features/charging/pages/ChargingCurvePage'),
  '/charging-heatmap': () => import('../features/charging/pages/ChargingHeatmapPage'),
  '/charging/:id': () => import('../features/charging/pages/ChargingDetailPage'),
  '/chatbot': () => import('../features/system/pages/ChatbotPage'),
  '/climate-control': () => import('../features/vehicle-systems/pages/ClimateControlPage'),
  '/command-history': () => import('../features/system/pages/CommandHistoryPage'),
  '/commands': () => import('../features/system/pages/CommandsPage'),
  '/cost-analysis': () => import('../features/charging/pages/CostAnalysisPage'),
  '/data-export': () => import('../features/system/pages/DataExportPage'),
  '/data-repair': () => import('../features/system/pages/DataRepairPage'),
  '/db-health': () => import('../features/system/pages/DBHealthPage'),
  '/dev-tools': () => import('../features/admin/pages/DevToolsPage'),
  '/digital-twin': () => import('../features/vehicles/pages/DigitalTwinPage'),
  '/drive-score': () => import('../features/driving/pages/DriveScorePage'),
  '/drives': () => import('../features/driving/pages/DrivesListPage'),
  '/drives/:id': () => import('../features/driving/pages/DriveDetailPage'),
  '/drives/:id/replay': () => import('../features/trips/pages/TripReplayPage'),
  '/drivetrain-health': () => import('../features/driving/pages/DrivetrainHealthPage'),
  '/driving-dynamics': () => import('../features/driving/pages/DrivingDynamicsPage'),
  '/efficiency': () => import('../features/driving/pages/EfficiencyPage'),
  '/energy': () => import('../features/battery/pages/EnergyPage'),
  '/energy-flow': () => import('../features/battery/pages/EnergyFlowPage'),
  '/energy-products': () => import('../features/battery/pages/EnergyProductsPage'),
  '/exports': () => import('../features/exports/pages/ExportsPage'),
  '/fleet-api': () => import('../features/admin/pages/FleetAPIPage'),
  '/fsd': () => import('../features/driving/pages/FSDInsightsPage'),
  '/geofences': () => import('../features/maps/pages/GeofencesPage'),
  '/glance': () => import('../features/dashboard/pages/GlancePage'),
  '/guard-mode': () => import('../features/vehicle-systems/pages/GuardModePage'),
  '/lifetime-stats': () => import('../features/analytics/pages/LifetimeStatsPage'),
  '/live': () => import('../features/maps/pages/MapOverviewPage'),
  '/live-monitor': () => import('../features/telemetry/pages/LiveSignalMonitorPage'),
  '/locations': () => import('../features/maps/pages/LocationsPage'),
  '/maintenance': () => import('../features/vehicle-systems/pages/MaintenancePage'),
  '/me/activity': () => import('../features/system/pages/MyActivityPage'),
  '/media-player': () => import('../features/vehicle-systems/pages/MediaPlayerPage'),
  '/mileage': () => import('../features/analytics/pages/MileagePage'),
  '/mqtt-inspector': () => import('../features/telemetry/pages/MQTTInspectorPage'),
  '/navigation': () => import('../features/maps/pages/NavigationRoutePage'),
  '/notifications': () => import('../features/notifications/components/LegacyNotificationsRedirect'),
  '/notifications/alerts': () => import('../features/notifications/pages/AlertsListPage'),
  '/notifications/archived': () => import('../features/notifications/pages/ArchivedPage'),
  '/notifications/audit': () => import('../features/notifications/pages/AuditLogPage'),
  '/notifications/browser': () => import('../features/notifications/pages/BrowserNotificationsPage'),
  '/notifications/channels': () => import('../features/notifications/pages/ChannelsPage'),
  '/notifications/inbox': () => import('../features/notifications/pages/InboxPage'),
  '/notifications/quiet-hours': () => import('../features/notifications/pages/QuietHoursPage'),
  '/notifications/rules': () => import('../features/notifications/pages/AlertRulesPage'),
  '/notifications/studio': () => import('../features/notifications/pages/AlertStudioPage'),
  '/notifications/webhooks': () => import('../features/notifications/pages/WebhooksPage'),
  '/onboarding': () => import('../features/onboarding/pages/OnboardingPage'),
  '/period-compare': () => import('../features/analytics/pages/PeriodComparePage'),
  '/power-flow': () => import('../features/battery/pages/PowerFlowDashboardPage'),
  '/powershare': () => import('../features/charging/pages/PowersharePage'),
  '/projected-range': () => import('../features/battery/pages/ProjectedRangePage'),
  '/quick-stats': () => import('../features/dashboard/pages/QuickStatsPage'),
  '/redis-signals': () => import('../features/admin/pages/RedisSignalViewerPage'),
  '/regen-efficiency': () => import('../features/driving/pages/RegenEfficiencyPage'),
  '/roadmap': () => import('../features/system/pages/RoadmapPage'),
  '/route-efficiency': () => import('../features/driving/pages/RouteEfficiencyPage'),
  '/s/:token': () => import('../features/sharing/pages/SharedDrivePage'),
  '/safety-settings': () => import('../features/vehicle-systems/pages/SafetySettingsPage'),
  '/search': () => import('../features/system/pages/SearchPage'),
  '/security-access': () => import('../features/admin/pages/SecurityAccessPage'),
  '/settings': () => import('../features/settings/pages/SettingsPage'),
  '/settings/fleet-setup': () => import('../features/settings/pages/FleetSetupPage'),
  '/settings/safety': () => import('../features/settings/pages/SafetyPage'),
  '/signal-diff': () => import('../features/telemetry/pages/SignalDiffPage'),
  '/signal-explorer': () => import('../features/telemetry/pages/SignalExplorerPage'),
  '/signal-gaps': () => import('../features/telemetry/pages/SignalGapDetectorPage'),
  '/signal-log': () => import('../features/telemetry/pages/SignalLogViewerPage'),
  '/sleep-efficiency': () => import('../features/battery/pages/SleepEfficiencyPage'),
  '/smart-charge': () => import('../features/charging/pages/SmartChargePage'),
  '/software-updates': () => import('../features/vehicle-systems/pages/SoftwareUpdatesPage'),
  '/speed-profile': () => import('../features/driving/pages/SpeedProfilePage'),
  '/state-debugger': () => import('../features/system/pages/StateMachineDebuggerPage'),
  '/statistics': () => import('../features/analytics/pages/StatisticsPage'),
  '/system-status': () => import('../features/system/pages/SystemStatusPage'),
  '/tco': () => import('../features/analytics/pages/TrueCostPage'),
  '/temperature-impact': () => import('../features/maps/pages/TemperatureImpactPage'),
  '/tesla-account': () => import('../features/system/pages/TeslaAccountPage'),
  '/tesla-charging-history': () => import('../features/charging/pages/TeslaChargingHistoryPage'),
  '/tesla-charging-sessions': () => import('../features/charging/pages/TeslaChargingSessionsPage'),
  '/timeline': () => import('../features/analytics/pages/TimelinePage'),
  '/tire-pressure': () => import('../features/vehicle-systems/pages/TirePressurePage'),
  '/trip-planner': () => import('../features/driving/pages/TripPlannerPage'),
  '/trips': () => import('../features/trips/pages/TripListPage'),
  '/trips/:id': () => import('../features/trips/pages/TripDetailPage'),
  '/vampire-drain': () => import('../features/battery/pages/VampireDrainPage'),
  '/vehicle-comparison': () => import('../features/analytics/pages/FleetComparePage'),
  '/vehicles': () => import('../features/vehicles/pages/VehicleListPage'),
  '/vehicles/:id': () => import('../features/vehicles/pages/VehicleDetailPage'),
  '/vehicles/:id/access': () => import('../features/vehicles/pages/VehicleAccessPage'),
  '/watch': () => import('../features/watch/pages/WatchFacePage'),
  '/weekly-digest': () => import('../features/analytics/pages/WeeklyDigestPage'),
  '/year-review/:year': () => import('../features/analytics/pages/YearReviewPage'),
}

const DYNAMIC_PRELOADER_PATTERNS = Object.keys(PRELOADERS).filter((path) =>
  path.split('/').some((segment) => segment.startsWith(':')),
)

const prefetched = new Set<string>()

/**
 * Network-condition gate.
 *
 * Prefetch is a *speculative* download: it spends bandwidth on a navigation
 * the user has not committed to. Honour the user's explicit Data Saver
 * preference and skip speculation on 2G-class links, where the extra chunk
 * competes with the request the user actually made. `navigator.connection`
 * is not implemented everywhere (Safari/Firefox) — a missing API means "no
 * signal", which we treat as "prefetch is fine", matching the pre-existing
 * behaviour on those browsers.
 */
const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g'])

interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
}

function networkInformation(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike
    mozConnection?: NetworkInformationLike
    webkitConnection?: NetworkInformationLike
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection
}

/**
 * `true` when speculative route prefetching is appropriate right now.
 *
 * Returns `false` when the user enabled Data Saver (`saveData`) or the
 * connection reports a 2G-class `effectiveType`. Exported so navigation
 * primitives can skip scheduling work entirely instead of scheduling a
 * timer that will be discarded.
 */
export function shouldPrefetchRoutes(): boolean {
  const connection = networkInformation()
  if (!connection) return true
  if (connection.saveData === true) return false
  if (connection.effectiveType && SLOW_EFFECTIVE_TYPES.has(connection.effectiveType)) {
    return false
  }
  return true
}

function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? ''
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function matchesPattern(pattern: string, path: string): boolean {
  const patternSegments = pattern.split('/')
  const pathSegments = path.split('/')
  if (patternSegments.length !== pathSegments.length) return false

  return patternSegments.every((segment, index) =>
    segment.startsWith(':')
      ? (pathSegments[index]?.length ?? 0) > 0
      : segment === pathSegments[index],
  )
}

function resolvePreloaderPath(path: string): string | null {
  const normalized = normalizePath(path)
  if (!normalized) return null
  if (PRELOADERS[normalized]) return normalized
  return DYNAMIC_PRELOADER_PATTERNS.find((pattern) =>
    matchesPattern(pattern, normalized),
  ) ?? null
}

/**
 * Eagerly download the lazy chunk for `path`. Called by `<PrefetchLink>`
 * on hover / focus / pointerdown; safe to call repeatedly with the same path (subsequent
 * calls are no-ops once the chunk is in flight or resolved).
 *
 * - Empty / missing path → no-op (defensive).
 * - Query strings, hashes, and trailing slashes are ignored.
 * - Concrete detail paths resolve to their parameterized route entry.
 * - Path with no PRELOADERS entry → no-op (silent; not all routes are
 *   listed, e.g. dynamic links computed at click time).
 * - Failed download → evicted from the prefetched set so the next hover
 *   retries; the click itself will also trigger the import via React.lazy.
 */
export function prefetchRoute(path: string): void {
  if (!shouldPrefetchRoutes()) return
  const preloaderPath = resolvePreloaderPath(path)
  if (!preloaderPath) return
  if (prefetched.has(preloaderPath)) return
  const preload = PRELOADERS[preloaderPath]
  if (!preload) return
  prefetched.add(preloaderPath)
  void preload().catch(() => {
    prefetched.delete(preloaderPath)
  })
}

/**
 * Default delay before a *touch/pen* intent turns into a real download.
 *
 * Mouse users get prefetch on `mouseenter`, which is a genuine intent
 * signal. Touch users have no hover, so the only pre-click signal is
 * `pointerdown` — but a `pointerdown` that becomes a scroll, a long-press,
 * or a drag is NOT an intent to navigate. Waiting a beat and cancelling on
 * `pointerup`/`pointercancel`/`pointerleave` keeps the early start for real
 * taps while avoiding a burst of chunk downloads during a flick-scroll.
 */
export const TOUCH_INTENT_PREFETCH_DELAY_MS = 120

/**
 * Schedule a prefetch for `path` and return a cancel function.
 *
 * The returned canceller is idempotent and safe to call after the prefetch
 * already fired. Because cancellation clears the pending timer BEFORE the
 * dynamic import starts, a cancelled intent can never resolve later and
 * mutate shared state — there is no stale-update window.
 *
 * Returns a no-op canceller when prefetching is disabled for the current
 * network conditions or the path is not prefetchable.
 */
export function schedulePrefetch(
  path: string,
  delayMs: number = TOUCH_INTENT_PREFETCH_DELAY_MS,
): () => void {
  if (typeof window === 'undefined') return () => {}
  if (!shouldPrefetchRoutes()) return () => {}
  if (!resolvePreloaderPath(path)) return () => {}

  let cancelled = false
  const handle = window.setTimeout(() => {
    if (cancelled) return
    prefetchRoute(path)
  }, Math.max(0, delayMs))

  return () => {
    if (cancelled) return
    cancelled = true
    window.clearTimeout(handle)
  }
}

/** Returns true when `path` has at least one matching PRELOADERS entry. */
export function isPrefetchablePath(path: string): boolean {
  return resolvePreloaderPath(path) != null
}

/** Test helper: clear the prefetched set so each test starts fresh. */
export function __resetPrefetchedForTests(): void {
  prefetched.clear()
}

/** Test helper: list the paths that have been prefetched this lifetime. */
export function __getPrefetchedForTests(): readonly string[] {
  return [...prefetched]
}
