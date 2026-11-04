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
 * The PRELOADERS map shares literal import functions with `App.tsx`
 * through `routeLoaders`. It is HAND-MAINTAINED — when a new
 * lazy route is added to `App.tsx`, add a shared loader and row here so it benefits
 * from prefetch. Routes not in this map are silently skipped: prefetch
 * is best-effort and never required for correctness.
 *
 * NOTE: import paths must be string literals so Vite can statically
 * analyse them and emit the same chunk that `React.lazy` produces.
 * Variable interpolation breaks chunk identity and forces a separate
 * fetch on click.
 */

import * as routeLoaders from './routeLoaders'

const PRELOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  '/experiments/vehicle-lab': routeLoaders.VehicleLab,
  '/experiments/route-flyover': routeLoaders.RouteFlyover,
  '/experiments/energy-flow': routeLoaders.EnergyFlowExperiment,
  '/experiments/year-in-motion': routeLoaders.YearInMotion,
  '/experiments/battery-what-if': routeLoaders.BatteryWhatIf,
  '/experiments/drive-art': routeLoaders.DriveArt,
  ...(import.meta.env.DEV ? {
    '/dev/grid-states': routeLoaders.MobileGridReference,
    '/dev/layout': routeLoaders.LayoutReference,
    '/dev/stats': routeLoaders.StatReference,
  } : {}),
  '/': routeLoaders.Dashboard,
  '/activity': routeLoaders.ActivityTimeline,
  '/admin/feedback': routeLoaders.FeedbackQueue,
  '/admin/telemetry/coverage': routeLoaders.FleetTelemetryCoverage,
  '/alert-rules': routeLoaders.LegacyAlertRulesRedirect,
  '/alert-studio': routeLoaders.LegacyAlertStudioRedirect,
  '/analytics': routeLoaders.Analytics,
  '/analytics/carbon': routeLoaders.CarbonIntelligence,
  '/anomaly-detection': routeLoaders.AnomalyDashboard,
  '/api-keys': routeLoaders.APIKeysPage,
  '/api-logs': routeLoaders.ApiLogs,
  '/api-playground': routeLoaders.ApiPlayground,
  '/automations': routeLoaders.AutomationsListPage,
  '/automations/:id/edit': routeLoaders.AutomationBuilderPage,
  '/automations/list': routeLoaders.AutomationListPage,
  '/automations/history': routeLoaders.AutomationHistoryPage,
  '/automations/new': routeLoaders.AutomationBuilderPage,
  '/backup': routeLoaders.BackupRestore,
  '/benchmarks/privacy': routeLoaders.PrivacyBenchmarks,
  '/battery': routeLoaders.BatteryHealth,
  '/battery-cells': routeLoaders.BatteryCells,
  '/battery-degradation': routeLoaders.BatteryDegradation,
  '/charging': routeLoaders.Charging,
  '/connect': routeLoaders.ConnectPage,
  '/charging-curve': routeLoaders.ChargingCurve,
  '/charging-heatmap': routeLoaders.ChargingHeatmap,
  '/charging/:id': routeLoaders.ChargeDetail,
  '/chatbot': routeLoaders.Chatbot,
  '/climate-control': routeLoaders.ClimateControl,
  '/command-history': routeLoaders.CommandHistory,
  '/commands': routeLoaders.Commands,
  '/cost-analysis': routeLoaders.CostAnalysis,
  '/data-export': routeLoaders.DataExport,
  '/data-repair': routeLoaders.DataRepair,
  '/db-health': routeLoaders.DBHealthDashboard,
  '/dev-tools': routeLoaders.DevTools,
  '/digital-twin': routeLoaders.DigitalTwin,
  '/drive-archetypes': routeLoaders.DriveArchetypes,
  '/drive-score': routeLoaders.DriveScore,
  '/drives': routeLoaders.Drives,
  '/drives/:id': routeLoaders.DriveDetail,
  '/drives/:id/replay': routeLoaders.TripReplay,
  '/drivetrain-health': routeLoaders.DrivetrainHealth,
  '/driving-dynamics': routeLoaders.DrivingDynamics,
  '/efficiency': routeLoaders.Efficiency,
  '/energy': routeLoaders.Energy,
  '/energy-flow': routeLoaders.EnergyFlow,
  '/energy-products': routeLoaders.EnergyProducts,
  '/exports': routeLoaders.ExportsPage,
  '/fleet-api': routeLoaders.FleetAPI,
  '/fsd': routeLoaders.FSDInsights,
  '/geofences': routeLoaders.Geofences,
  '/glance': routeLoaders.GlancePage,
  '/guard-mode': routeLoaders.GuardMode,
  '/lifetime-stats': routeLoaders.LifetimeStats,
  '/live': routeLoaders.LiveMap,
  '/live-monitor': routeLoaders.LiveSignalMonitor,
  '/locations': routeLoaders.Locations,
  '/maintenance': routeLoaders.Maintenance,
  '/me/activity': routeLoaders.MyActivity,
  '/media-player': routeLoaders.MediaPlayer,
  '/mileage': routeLoaders.Mileage,
  '/mqtt-inspector': routeLoaders.MQTTInspector,
  '/navigation': routeLoaders.NavigationRoute,
  '/notifications': routeLoaders.InboxPage,
  '/notifications/archived': routeLoaders.ArchivedPage,
  '/notifications/audit': routeLoaders.NotificationsAudit,
  '/notifications/browser': routeLoaders.BrowserNotificationsPage,
  '/notifications/channels': routeLoaders.ChannelsPage,
  '/notifications/health': routeLoaders.NotificationHealth,
  '/notifications/inbox': routeLoaders.InboxPage,
  '/notifications/packs': routeLoaders.AlertPacksPage,
  '/notifications/quiet-hours': routeLoaders.QuietHoursPage,
  '/notifications/rules': routeLoaders.AlertRulesPage,
  '/notifications/studio': routeLoaders.AlertStudio,
  '/onboarding': routeLoaders.Onboarding,
  '/period-compare': routeLoaders.PeriodCompare,
  '/power-flow': routeLoaders.PowerFlowDashboard,
  '/powershare': routeLoaders.Powershare,
  '/projected-range': routeLoaders.ProjectedRange,
  '/quick-stats': routeLoaders.QuickStats,
  '/redis-signals': routeLoaders.RedisSignalViewer,
  '/regen-efficiency': routeLoaders.RegenEfficiency,
  '/roadmap': routeLoaders.Roadmap,
  '/route-efficiency': routeLoaders.RouteEfficiency,
  '/s/:token': routeLoaders.SharedDrive,
  '/safety-settings': routeLoaders.SafetySettings,
  '/search': routeLoaders.Search,
  '/security-access': routeLoaders.SecurityAccess,
  '/settings': routeLoaders.Settings,
  '/settings/fleet-setup': routeLoaders.FleetSetupPage,
  '/settings/safety': routeLoaders.SafetySettingsPage,
  '/share-card': routeLoaders.ShareCard,
  '/signal-diff': routeLoaders.SignalDiff,
  '/signal-explorer': routeLoaders.SignalExplorer,
  '/signal-gaps': routeLoaders.SignalGapDetector,
  '/signal-log': routeLoaders.SignalLogViewer,
  '/sleep-efficiency': routeLoaders.SleepEfficiency,
  '/smart-charge': routeLoaders.SmartCharge,
  '/software-updates': routeLoaders.SoftwareUpdates,
  '/speed-profile': routeLoaders.SpeedProfile,
  '/state-debugger': routeLoaders.StateMachineDebugger,
  '/statistics': routeLoaders.Statistics,
  '/system-status': routeLoaders.SystemStatus,
  '/tesla-api-usage': routeLoaders.TeslaApiUsage,
  '/tesla-physics': routeLoaders.TeslaPhysics,
  '/tesla-physics/clocks': routeLoaders.TeslaPhysics,
  '/tesla-physics/life-tape': routeLoaders.TeslaPhysics,
  '/tesla-physics/contradictions': routeLoaders.TeslaPhysics,
  '/tesla-physics/meters': routeLoaders.TeslaPhysics,
  '/tesla-physics/unknown': routeLoaders.TeslaPhysics,
  '/tesla-physics/car-kept-living': routeLoaders.TeslaPhysics,
  '/tesla-physics/logbook': routeLoaders.TeslaPhysics,
  '/tesla-physics/firmware-epochs': routeLoaders.TeslaPhysics,
  '/tesla-physics/charge-port': routeLoaders.TeslaPhysics,
  '/tesla-physics/black-box': routeLoaders.TeslaPhysics,
  '/tesla-physics/dictionary': routeLoaders.TeslaPhysics,
  '/tesla-physics/vault': routeLoaders.TeslaPhysics,
  '/tesla-physics/modes': routeLoaders.TeslaPhysics,
  '/tesla-physics/nervous-system': routeLoaders.TeslaPhysics,
  '/tesla-physics/range': routeLoaders.TeslaPhysics,
  '/tesla-physics/ledger': routeLoaders.PhysicsLedger,
  '/tco': routeLoaders.TrueCostOwnership,
  '/temperature-impact': routeLoaders.TemperatureImpact,
  '/tesla-account': routeLoaders.TeslaAccount,
  '/tesla-charging-history': routeLoaders.TeslaChargingHistory,
  '/tesla-charging-sessions': routeLoaders.TeslaChargingSessions,
  '/timeline': routeLoaders.Timeline,
  '/tire-pressure': routeLoaders.TirePressure,
  '/trip-planner': routeLoaders.TripPlanner,
  '/trips': routeLoaders.Trips,
  '/trips/:id': routeLoaders.TripDetail,
  '/vampire-drain': routeLoaders.VampireDrain,
  '/vehicle-comparison': routeLoaders.FleetCompare,
  '/vehicles': routeLoaders.Vehicles,
  '/vehicles/:id': routeLoaders.VehicleDetail,
  '/vehicles/:id/access': routeLoaders.VehicleAccess,
  '/watch': routeLoaders.WatchFace,
  '/weekly-digest': routeLoaders.WeeklyDigest,
  '/year-review/:year': routeLoaders.YearReview,
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
