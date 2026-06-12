// The data port the [GasPriceSettingsViewModel] binds to (P1/S8 state-holder seam) — the native analogue of the
// web component's gas-price hook composition
// (web/src/api/hooks/useSettings.ts → web/src/features/settings/components/GasPriceSettings.tsx). The view never
// performs HTTP itself; a shared adapter (the S8 SettingsStore or the S7 SettingsRepository) or a test fake
// drives this. Cache-then-network freshness is preserved end to end (ADR-013): every read emission's
// cached/stale/error flags flow through unchanged so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/GasPriceSettings) cannot form a valid Kotlin package and the file hosts the seam
// plus its two bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.gaspricesettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.GasPriceConfigResult
import io.teslasync.shared.core.presentation.settings.GasPricePollResult
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import io.teslasync.shared.core.presentation.settings.GasPriceToggleResult
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [GasPriceSettingsViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store or the network. The two reads are the cache-then-network feeds the web
 * `useGasPriceStatus` / `useSettings` hooks serve; the three mutations mirror the web `usePollGasPrice` /
 * `useToggleGasPrice` / `useUpdateGasPriceConfig` non-throwing results. No HTTP touches the view.
 */
interface GasPriceSettingsSource {
    /** Stream the cache-then-network gas-price status (web `useGasPriceStatus`, `GET /gas-price/status`). */
    fun gasPriceStatus(): Flow<Resource<GasPriceStatus>>

    /** Stream the cache-then-network `/settings` document for the currency + fuel-unit prefs (web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Trigger a manual gas-price poll (web `usePollGasPrice`, `POST /gas-price/poll`); invalidates nothing. */
    suspend fun pollGasPrice(): Result<GasPricePollResult>

    /** Toggle auto-poll (web `useToggleGasPrice`, `POST /gas-price/toggle`); invalidates the status feed. */
    suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult>

    /** Save the poll cadence (web `useUpdateGasPriceConfig`, `PUT /gas-price/config`); invalidates the status feed. */
    suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer settings feed every
 * Settings surface shares app-wide (web `useSettings` hook domain). Mutations route through the store so it
 * refreshes exactly the feeds the matching web hook invalidates (the gas-price-status feed for toggle/config;
 * nothing for poll); the view-model additionally restarts its own collection after a successful mutation so a
 * host using either binding refreshes uniformly. No HTTP touches the view — the store (S7/S8) owns it.
 */
fun gasPriceSettingsSource(store: SettingsStore): GasPriceSettingsSource =
    object : GasPriceSettingsSource {
        override fun gasPriceStatus(): Flow<Resource<GasPriceStatus>> = store.gasPriceStatus()

        override fun settings(): Flow<Resource<JsonElement>> = store.settings()

        override suspend fun pollGasPrice(): Result<GasPricePollResult> = store.pollGasPrice()

        override suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> = store.toggleGasPrice(enabled)

        override suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> =
            store.updateGasPriceConfig(pollInterval)
    }

/**
 * Binds the surface directly to the shared **S7** [SettingsRepository]. Each [gasPriceStatus]/[settings] call
 * starts a NEW cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the
 * web `refetch()` behaviour) — the binding to use when a host does not share a single app-wide store. The
 * view-model restarts its read collection after a successful mutation to reflect the write.
 */
fun gasPriceSettingsSource(repository: SettingsRepository): GasPriceSettingsSource =
    object : GasPriceSettingsSource {
        override fun gasPriceStatus(): Flow<Resource<GasPriceStatus>> = repository.gasPriceStatus()

        override fun settings(): Flow<Resource<JsonElement>> = repository.settings()

        override suspend fun pollGasPrice(): Result<GasPricePollResult> = repository.pollGasPrice()

        override suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> = repository.toggleGasPrice(enabled)

        override suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> =
            repository.updateGasPriceConfig(pollInterval)
    }
