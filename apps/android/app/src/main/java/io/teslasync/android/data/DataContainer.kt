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
import io.teslasync.shared.core.data.repo.HttpDashboardRepository
import io.teslasync.shared.core.data.repo.HttpFeedbackRepository
import io.teslasync.shared.core.data.repo.HttpPinnedRepository
import io.teslasync.shared.core.data.repo.HttpSettingsRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.dashboard.DashboardStore
import io.teslasync.shared.core.presentation.feedback.FeedbackStore
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

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
 * @param clock wall-clock seam for cache freshness; injectable for tests.
 */
class DataContainer(
    api: ApiHttpClient,
    cacheStore: CacheStore,
    private val scope: CoroutineScope,
    val logger: Logger,
    val liveSessionStore: LiveSessionStore,
    clock: Clock = SystemClock,
) {
    // S7 repositories — HTTP-backed, cache-then-network, over the shared resilient client + offline cache.
    private val vehiclesRepository = HttpVehiclesRepository(api, cacheStore, clock)
    private val dashboardRepository = HttpDashboardRepository(api, cacheStore, clock)
    private val settingsRepository = HttpSettingsRepository(api, cacheStore, clock)
    private val pinnedRepository = HttpPinnedRepository(api, cacheStore, clock)
    private val adminRepository = HttpAdminRepository(api, cacheStore, clock)
    private val feedbackRepository = HttpFeedbackRepository(api, cacheStore, clock)

    // S8 shared state holders — the single source of truth each page ViewModel binds to.

    /** Shared Vehicles domain state holder (web `useVehicles` port). */
    val vehiclesStore = VehiclesStore(vehiclesRepository, scope)

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
