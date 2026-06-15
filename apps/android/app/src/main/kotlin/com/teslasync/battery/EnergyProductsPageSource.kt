// The data seam the EnergyProductsPage surface binds to, plus its production binding over the shared S8 holders. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's four data hooks: `useTeslaEnergySites` (`GET /tesla/energy-sites`), `useTeslaEnergySiteInfo`
// (`GET /tesla/energy-sites/{id}/site-info`), `useRefreshTeslaEnergySites` (`POST /tesla/energy-sites/refresh`) and
// `useRefreshTeslaEnergySiteInfo` (`POST /tesla/energy-sites/{id}/site-info/refresh`).
//
// All four feeds + mutations are already exposed by the shared **S8** [EnergyStore] (the memoized, multi-observer
// catalog + per-site detail feeds, and the two refresh mutations that re-fetch their cache family), and the locale
// preference comes from the shared [SettingsStore] `/settings` document. So this seam is a thin pass-through: a narrow
// interface so the view-model depends on an abstraction (the real store binding ↔ a test fake), never on a concrete
// store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.energyproducts

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [EnergyProductsPageViewModel] depends on so it binds to an abstraction (the shared Energy +
 * Settings holders in production; a fake in tests), never to a concrete store or the network. The two read feeds are
 * cache-then-network `Resource` flows (the web read hooks); the two refresh suspends are the web mutation hooks (each
 * re-fetches its cache family on success). No HTTP touches the view.
 */
interface EnergyProductsPageSource {
    /** The cache-then-network `GET /tesla/energy-sites` catalog feed (web `useTeslaEnergySites`). */
    fun energySites(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /tesla/energy-sites/{siteId}/site-info` feed (web `useTeslaEnergySiteInfo`). */
    fun energySiteInfo(siteId: Long): Flow<Resource<JsonElement>>

    /**
     * Runs `POST /tesla/energy-sites/refresh` then re-fetches the catalog family (web `useRefreshTeslaEnergySites`).
     * The result is surfaced as a one-shot toast; the refreshed catalog flows back through [energySites].
     */
    suspend fun refreshEnergySites(): Result<JsonElement>

    /**
     * Runs `POST /tesla/energy-sites/{siteId}/site-info/refresh` then re-fetches that site's detail family (web
     * `useRefreshTeslaEnergySiteInfo`). The refreshed detail flows back through [energySiteInfo].
     */
    suspend fun refreshEnergySiteInfo(siteId: Long): Result<JsonElement>

    /** The cache-then-network `GET /settings` document feed (web `useFormatting` locale). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [EnergyStore] + [SettingsStore] — the memoized, multi-observer feeds every
 * Energy surface shares app-wide, plus the two refresh mutations the store already owns (each invalidates + re-fetches
 * the matching cache family, mirroring the web hooks' `invalidateQueries`). The live values flow through unchanged so
 * the view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches
 * the view.
 */
fun energyProductsPageSourceOf(
    energyStore: EnergyStore,
    settingsStore: SettingsStore,
): EnergyProductsPageSource =
    object : EnergyProductsPageSource {
        override fun energySites(): Flow<Resource<JsonElement>> = energyStore.teslaEnergySites()

        override fun energySiteInfo(siteId: Long): Flow<Resource<JsonElement>> = energyStore.teslaEnergySiteInfo(siteId)

        override suspend fun refreshEnergySites(): Result<JsonElement> = energyStore.refreshTeslaEnergySites()

        override suspend fun refreshEnergySiteInfo(siteId: Long): Result<JsonElement> =
            energyStore.refreshTeslaEnergySiteInfo(siteId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
