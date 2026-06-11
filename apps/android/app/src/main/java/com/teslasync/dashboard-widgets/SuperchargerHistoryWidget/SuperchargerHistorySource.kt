// The data port the Supercharger History widget binds to — the native analogue of the hooks the web
// component composes: `useTeslaChargingHistory()` (the rendered `/tesla/charging/history` feed, fetched
// with no VIN so it spans the account) plus `useUnits` + `useFormatting` (both read from the `/settings`
// document, for the energy unit + currency symbol + precision). See
// web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx + web/src/api/hooks/useCharging.ts. The
// view never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives
// this seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each
// emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SuperchargerHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.superchargerhistory

import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the account-wide Tesla [chargingHistory]
 * envelope (the rendered `GET /tesla/charging/history` feed — web `useTeslaChargingHistory()` with no VIN,
 * spanning every enrolled vehicle), and the [settings] document (web `useUnits`/`useFormatting`, for the
 * energy unit + currency symbol + precision). A narrow seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface SuperchargerHistorySource {
    /** The cache-then-network `GET /tesla/charging/history` feed (web `useTeslaChargingHistory()`). */
    fun chargingHistory(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun superchargerHistorySource(
    charging: ChargingStore,
    settings: SettingsStore,
): SuperchargerHistorySource =
    object : SuperchargerHistorySource {
        override fun chargingHistory(): Flow<Resource<JsonElement>> = charging.teslaChargingHistory()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). No HTTP touches the view.
 */
fun superchargerHistorySource(
    charging: ChargingRepository,
    settings: SettingsRepository,
): SuperchargerHistorySource =
    object : SuperchargerHistorySource {
        override fun chargingHistory(): Flow<Resource<JsonElement>> = charging.teslaChargingHistory()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
