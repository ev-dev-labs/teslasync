package io.teslasync.android.data

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.dashboard.DashboardViewModel
import io.teslasync.android.data.live.LiveSessionStore
import io.teslasync.android.data.live.LiveViewModel
import io.teslasync.android.data.vehicles.VehicleDetailViewModel
import io.teslasync.android.data.vehicles.VehiclesListViewModel
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.HttpAdminRepository
import io.teslasync.shared.core.data.repo.HttpAnalyticsRepository
import io.teslasync.shared.core.data.repo.HttpAutomationsRepository
import io.teslasync.shared.core.data.repo.HttpDashboardRepository
import io.teslasync.shared.core.data.repo.HttpEnergyRepository
import io.teslasync.shared.core.data.repo.HttpFeedbackRepository
import io.teslasync.shared.core.data.repo.HttpIngestXRayRepository
import io.teslasync.shared.core.data.repo.HttpOperatorConfidenceRepository
import io.teslasync.shared.core.data.repo.HttpPinnedRepository
import io.teslasync.shared.core.data.repo.HttpSettingsRepository
import io.teslasync.shared.core.data.repo.HttpUserRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.sse.SseTransport
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import io.teslasync.shared.core.presentation.dashboard.DashboardStore
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.feedback.FeedbackStore
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayStore
import io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.user.UserStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import io.teslasync.shared.core.data.repo.HttpDlqRepository
import io.teslasync.shared.core.presentation.dlq.DlqStore
import io.teslasync.shared.core.data.repo.HttpFleetTelemetryRepository
import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryStore
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.data.repo.HttpRbacRepository
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixStore
import io.teslasync.shared.core.data.repo.HttpSystemQueuesRepository
import io.teslasync.shared.core.data.repo.HttpSystemRepository
import io.teslasync.shared.core.presentation.system.SystemStore
import io.teslasync.shared.core.presentation.systemqueues.SystemQueuesStore
import io.teslasync.shared.core.data.repo.HttpImpersonationRepository
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStore
import io.teslasync.shared.core.data.repo.HttpDrivingRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore

/**
 * Manual DI graph for the Android data layer (ADR-013), the analogue of the auth `AuthContainer`. It
 * wires the shared-core S7 repositories (HTTP-backed, cache-then-network, over the one resilient
 * [ApiHttpClient] + offline [CacheStore]) into the S8 state holders, then exposes those holders plus
 * the app-scoped cross-cutting concerns (active-vehicle selection, the live unit formatter) and the
 * [ViewModelProvider.Factory] every page ViewModel is constructed through.
 *
 * The Android module adds NO networking or business logic here — it only assembles the shared pieces
 * and binds them to lifecycle-aware Compose ViewModels. This is the single seam A7 page prompts widen
 * (register their store + ViewModel) without touching any feature page.
 *
 * @param api the shared resilient client (its only auth seam is the auth token provider).
 * @param cacheStore the shared offline cache store (cleared on sign-out by the auth graph).
 * @param scope the app-scoped coroutine scope the shared feeds and observers run in.
 * @param logger the single sanctioned redacting logger (ADR-016) handed to every ViewModel.
 * @param liveSessionStore the app-scoped live-data pipeline holder (ADR-009), built in the auth graph
 *   over the shared SSE client + auth gate; `LiveViewModel` projects it per page and
 *   `TeslaSyncApplication` binds it to the process foreground lifecycle.
 * @param sseTransport the shared authenticated SSE transport (the SAME one the `/events` live pipe streams
 *   through), exposed so embedded admin surfaces that open their own server-sent stream — the A7 LiveLogs
 *   tail over `/admin/logs/stream` — reuse the centralised bearer + 401-refresh wiring rather than minting a
 *   second engine. The view binds it through a narrow per-surface source seam; no HTTP lives in a page.
 * @param clock wall-clock seam for cache freshness; injectable for tests.
 */
class DataContainer(
    val api: ApiHttpClient,
    val cacheStore: CacheStore,
    private val scope: CoroutineScope,
    val logger: Logger,
    val liveSessionStore: LiveSessionStore,
    val sseTransport: SseTransport,
    clock: Clock = SystemClock,
) {
    // S7 repositories — HTTP-backed, cache-then-network, over the shared resilient client + offline cache.
    private val vehiclesRepository = HttpVehiclesRepository(api, cacheStore, clock)
    private val analyticsRepository = HttpAnalyticsRepository(api, cacheStore, clock)
    private val energyRepository = HttpEnergyRepository(api, cacheStore, clock)
    private val dashboardRepository = HttpDashboardRepository(api, cacheStore, clock)
    private val settingsRepository = HttpSettingsRepository(api, cacheStore, clock)
    private val pinnedRepository = HttpPinnedRepository(api, cacheStore, clock)
    private val adminRepository = HttpAdminRepository(api, cacheStore, clock)
    private val feedbackRepository = HttpFeedbackRepository(api, cacheStore, clock)
    private val ingestXRayRepository = HttpIngestXRayRepository(api, cacheStore, clock)
    private val operatorConfidenceRepository = HttpOperatorConfidenceRepository(api, cacheStore, clock)
    private val userRepository = HttpUserRepository(api, cacheStore, clock)
    private val automationsRepository = HttpAutomationsRepository(api, cacheStore, clock)

    // S8 shared state holders — the single source of truth each page ViewModel binds to.

    /** Shared Vehicles domain state holder (web `useVehicles` port). */
    val vehiclesStore = VehiclesStore(vehiclesRepository, scope)

    /**
     * Shared Analytics read-model state holder (web `useAnalytics` port) — the memoized, multi-observer raw-JSON
     * feeds (`/analytics/lifetime`, `/analytics/fleet`, `/mileage/stats`, …) the A7 LifetimeStatsPage analytics
     * surface binds to.
     */
    val analyticsStore = AnalyticsStore(analyticsRepository, scope)

    /**
     * Shared Energy/battery read-model state holder (web `useEnergy` port) — the memoized, multi-observer raw-JSON
     * feeds (`/analytics/battery-health`, …) the A7 StatisticsPage analytics surface binds to for its battery panel.
     */
    val energyStore = EnergyStore(energyRepository, scope)

    /** Shared Dashboard domain state holder (web `useDashboard` port). */
    val dashboardStore = DashboardStore(dashboardRepository, scope)

    /** Shared Settings domain state holder (web `useSettings` port); backs the unit formatter. */
    val settingsStore = SettingsStore(settingsRepository, scope)

    /**
     * Shared unified-pin domain state holder (web `usePinned` port). Backs pin-aware ordering on every
     * surface that floats pinned rows to the top (the layout `VehiclePicker`, dashboard widgets, …).
     */
    val pinnedStore = PinnedStore(pinnedRepository, scope)

    /** App-scoped active-vehicle selection, self-healing from the live vehicle list. */
    val selectedVehicleStore = SelectedVehicleStore()

    /**
     * Shared Analytics read-model state holder (web `useAnalytics` port) — the memoized, multi-observer
     * cache-then-network mileage + fleet-analytics feeds (mileage stats, daily, monthly, …) the A7
     * analytics surfaces (MileagePage, …) bind to.
     */

    /**
     * Shared Admin/operational control-plane state holder (web `useAdmin` port) — the memoized, multi-observer
     * raw-JSON feeds (`/api-logs`, `/api-logs/stats`, `/system/health`, …) every A7 admin surface binds to.
     */
    val adminStore = AdminStore(adminRepository, scope)

    /**
     * Shared in-app Feedback domain state holder (web `useFeedback` port) — the admin queue list feed +
     * the status/forward patch the A7 FeedbackQueuePage admin surface binds to.
     */
    val feedbackStore = FeedbackStore(feedbackRepository, scope)

    /**
     * Shared Ingest X-Ray domain state holder (web `useIngestXRay` port) — the per-vehicle telemetry-ingest
     * diagnostic feed (`/system/ingest-xray/{id}`) the A7 IngestXRayPage admin surface binds to.
     */
    val ingestXRayStore = IngestXRayStore(ingestXRayRepository, scope)

    /**
     * Shared Operator-Confidence control-plane state holder (web `useOperatorConfidence` port) — the memoized,
     * multi-observer admin-observability feeds (`/admin/observability/schema-drift`, …) the A7 SchemaDriftPage
     * admin surface binds to.
     */
    val operatorConfidenceStore = OperatorConfidenceStore(operatorConfidenceRepository, scope)

    /**
     * Shared User/Account domain state holder (web `useUser` port) — the cache-then-network Tesla region feed
     * (`/tesla/user/region`) + its refresh mutation the A7 TeslaRegionPage admin surface binds to.
     */
    val userStore = UserStore(userRepository, scope)
    private val dlqRepository = HttpDlqRepository(api, cacheStore, clock)
    val dlqStore = DlqStore(dlqRepository, scope)
    private val fleetTelemetryRepository = HttpFleetTelemetryRepository(api, cacheStore, clock)
    val fleetTelemetryStore = FleetTelemetryStore(fleetTelemetryRepository, scope)
    private val telemetryRepository = HttpTelemetryRepository(api, cacheStore, clock)
    val telemetryStore = TelemetryStore(telemetryRepository, scope)
    private val rbacRepository = HttpRbacRepository(api, cacheStore, clock)
    val rbacMatrixStore = RbacMatrixStore(rbacRepository, scope)
    private val systemRepository = HttpSystemRepository(api, cacheStore, clock)
    private val systemQueuesRepository = HttpSystemQueuesRepository(api, cacheStore, clock)
    val systemStore = SystemStore(systemRepository, scope)
    val systemQueuesStore = SystemQueuesStore(systemQueuesRepository, scope)
    private val impersonationRepository = HttpImpersonationRepository(api, cacheStore, clock)
    val impersonationStore = ImpersonationStore(impersonationRepository, scope)
    private val drivingRepository = HttpDrivingRepository(api, cacheStore, clock)
    val drivingStore = DrivingStore(drivingRepository, scope)

    /**
     * Shared Automations control-plane state holder (web `useAutomations` port) — the cache-then-network
     * automation list feed (`GET /automations`) + the allowlisted bulk enable/disable/delete mutation
     * (`POST /automations/bulk`) the A7 AutomationListPage surface binds to.
     */
    val automationsStore = AutomationsStore(automationsRepository, scope)

    /**
     * Shared Automations control-plane state holder (web `useAutomations` port) — the cache-then-network reads
     * (`/automations/{id}`, `/automations/presets/{id}`) + the create/update/test-run mutations the A7
     * AutomationBuilderPage automations surface binds to.
     */

    /**
     * The live display-unit formatter, derived from the user's settings document — the single SI ->
     * display boundary (web `useUnits` port). Shared while observed; falls back to metric defaults
     * before settings load.
     */
    val unitFormatter: StateFlow<UnitFormatter> =
        settingsStore
            .settings()
            .map { resource -> UnitFormatter(UnitPreferences.fromSettings(resource.cached)) }
            .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UnitFormatter.default())

    /** The factory every page ViewModel is created through (Compose `viewModel(factory = ...)`). */
    val viewModelFactory: ViewModelProvider.Factory =
        viewModelFactory {
            initializer { VehiclesListViewModel(vehiclesStore, selectedVehicleStore, logger) }
            initializer { VehicleDetailViewModel(vehiclesStore, selectedVehicleStore, logger) }
            initializer { DashboardViewModel(dashboardStore, logger) }
            initializer { LiveViewModel(liveSessionStore, selectedVehicleStore, logger) }
        }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}