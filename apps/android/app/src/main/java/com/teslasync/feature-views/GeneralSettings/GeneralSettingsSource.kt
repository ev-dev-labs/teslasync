// The data port the GeneralSettings surface binds to (P1/S8 state-holder seam) — the native analogue of
// the four web hooks the panel composes: `useSettings` (the `/settings` document read), `useVehicles`
// (to find the first vehicle id), `useCarPreferences` (that vehicle's car-reported units), and
// `useSaveSettings` (the full-replace PUT). The view never performs HTTP; a concrete adapter over the
// shared Settings data layer — the S8 [SettingsStore] for the shared, multi-observer, refresh-on-mutation
// feed, or the S7 [SettingsRepository] for the cold cache-then-network flow that a manual retry
// re-collects — drives this seam (a test fake drives it in unit tests). Mirrors the dual-adapter shape of
// the sibling WhyEndedPanel surface so a host can fold the panel into the shared collection or run it
// standalone.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GeneralSettings) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `GeneralSettings*` filename cannot match the
// surface's `GeneralSettingsSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.generalsettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.CarPreferences
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.Vehicle
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The Settings data seam the panel binds to — the native analogue of the web hook composition. A concrete
 * adapter over the shared Settings layer (or a test fake) drives it; the view never performs HTTP. The
 * `/settings` document is carried as the raw [JsonElement] the backend serves so unknown keys round-trip
 * on save (the web full-replace contract).
 */
interface GeneralSettingsSource {
    /** Cache-then-network `GET /settings` document feed (web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Cache-then-network `GET /vehicles` feed; the panel reads only the first id (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Cache-then-network `GET /user-preferences/latest?vehicle_id=` feed (web `useCarPreferences`). */
    fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>>

    /** `PUT /settings` full-replace with the [document] (web `useSaveSettings`); non-throwing [Result]. */
    suspend fun saveSettings(document: JsonElement): Result<JsonElement>
}

/**
 * Binds the panel to the shared **S8** [SettingsStore] — the memoized, multi-observer feeds every Settings
 * surface shares. [saveSettings] routes through the store so it refreshes the `settings` feed on success
 * (the web `invalidateAndBroadcast(settingsKeys.settings)`), which re-emits into the panel automatically.
 * No HTTP touches the view.
 */
fun SettingsStore.asGeneralSettingsSource(): GeneralSettingsSource {
    val store = this
    return object : GeneralSettingsSource {
        override fun settings(): Flow<Resource<JsonElement>> = store.settings()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>> = store.carPreferences(vehicleId)

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> = store.saveSettings(document)
    }
}

/**
 * Binds the panel to the shared **S7** [SettingsRepository] — the cold cache-then-network `Flow`s.
 * Re-collecting a read performs a genuine cache-then-network re-fetch, which backs the panel's manual
 * refresh / error-retry affordance. No HTTP touches the view.
 */
fun SettingsRepository.asGeneralSettingsSource(): GeneralSettingsSource {
    val repo = this
    return object : GeneralSettingsSource {
        override fun settings(): Flow<Resource<JsonElement>> = repo.settings()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun carPreferences(vehicleId: Long): Flow<Resource<CarPreferences>> = repo.carPreferences(vehicleId)

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> = repo.saveSettings(document)
    }
}
