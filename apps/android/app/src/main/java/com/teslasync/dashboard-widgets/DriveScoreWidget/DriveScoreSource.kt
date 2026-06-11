// The data port the Drive Score widget binds to — the native analogue of the two web hooks the
// component composes: `useFleetAnalytics(7)` (the rendered trailing-7-day `/analytics/fleet` feed) and
// `useUnits` (which reads the `/settings` document for the distance unit). See
// web/src/features/dashboard/widgets/DriveScoreWidget.tsx + web/src/api/hooks/useAnalytics.ts. The view
// never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each
// emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveScoreWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescore

import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the trailing-7-day [fleetAnalytics] deep
 * fleet feed (the rendered `GET /analytics/fleet?days=7`, web `useFleetAnalytics(7)`) and the [settings]
 * document (web `useUnits`, for the distance unit). A narrow seam so the view-model depends on an
 * abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface DriveScoreSource {
    /** The cache-then-network `GET /analytics/fleet?days=7` feed (web `useFleetAnalytics(7)`). */
    fun fleetAnalytics(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting the analytics feed performs a genuine cache-then-network re-fetch, which is
 * what backs the widget's manual refresh / error-retry affordance (the web `refetch()`). The window is
 * pinned to [DriveScoreRegistration.WINDOW_DAYS] (7), matching the web `useFleetAnalytics(7)` call. No
 * HTTP touches the view.
 */
fun driveScoreSource(
    analytics: AnalyticsRepository,
    settings: SettingsRepository,
): DriveScoreSource =
    object : DriveScoreSource {
        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analytics.fleetAnalytics(days = DriveScoreRegistration.WINDOW_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface
 * shares. Use this when a host wants the widget to fold into the same shared collections as the rest of
 * the app; the live values (incl. each store's background refresh) flow through unchanged. The analytics
 * window is pinned to [DriveScoreRegistration.WINDOW_DAYS] (7). No HTTP touches the view.
 */
fun driveScoreSource(
    analytics: AnalyticsStore,
    settings: SettingsStore,
): DriveScoreSource =
    object : DriveScoreSource {
        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analytics.fleetAnalytics(days = DriveScoreRegistration.WINDOW_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
