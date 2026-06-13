// The data seam the UnitInput surface binds to for the display-unit preference document it reads — the
// native analogue of the web `useSettings` hook (web/src/hooks/useSettings.ts) the field consults on every
// render. The view (composable) performs NO HTTP — it only collects state from the [UnitInputViewModel],
// which drives this seam (ADR-002), satisfying the "no direct HTTP from the view" contract. A concrete
// adapter over the shared Settings layer — the S8 [SettingsStore] for the shared, multi-observer,
// refresh-on-mutation feed, or the S7 [SettingsRepository] for the cold cache-then-network flow a manual
// retry re-collects — backs it in production; a test fake backs it in unit tests. Mirrors the dual-adapter
// shape of the sibling Range surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UnitInput) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed: the mandated `UnitInput*` filename cannot match the `UnitInputSettingsSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.unitinput

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [UnitInputViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `useSettings` read. The `/settings`
 * document is carried as the raw [JsonElement] the backend serves so the `unit_of_length`, `unit_of_temp`,
 * `locale`, `decimal_precision`, and `currency_symbol` preferences are read verbatim. No HTTP touches the
 * view.
 */
fun interface UnitInputSettingsSource {
    /** Cache-then-network `GET /settings` document feed (web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer settings feed
 * every Settings-derived surface shares (the same store backing the app's live unit formatter). No HTTP
 * touches the view.
 */
fun SettingsStore.asUnitInputSettingsSource(): UnitInputSettingsSource {
    val store = this
    return UnitInputSettingsSource { store.settings() }
}

/**
 * Binds the surface to the shared **S7** [SettingsRepository] — the cold cache-then-network `Flow`.
 * Re-collecting it performs a genuine cache-then-network re-fetch, which backs the surface's manual
 * refresh / error-retry affordance. No HTTP touches the view.
 */
fun SettingsRepository.asUnitInputSettingsSource(): UnitInputSettingsSource {
    val repo = this
    return UnitInputSettingsSource { repo.settings() }
}
