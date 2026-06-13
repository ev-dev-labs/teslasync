// The data seam the CurrencyInput surface binds to for the default currency + locale it reads — the native
// analogue of the web `useSettings`/`useFormatting` reads the primitive's host composes (the `/settings`
// document holds `currency_symbol` + the global `locale`). The view (composable) performs NO HTTP — it only
// collects state from the [CurrencyInputViewModel], which drives this seam (ADR-002), satisfying the "no
// direct HTTP from the view" contract. A concrete adapter over the shared Settings layer — the S8
// [SettingsStore] for the shared, multi-observer, refresh-on-mutation feed, or the S7 [SettingsRepository]
// for the cold cache-then-network flow a manual retry re-collects — backs it in production; a test fake backs
// it in unit tests. Mirrors the dual-adapter shape of the sibling Range / Currency surfaces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CurrencyInput) cannot form a valid Kotlin package. `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed because the mandated `CurrencyInput*` filename cannot match the
// `CurrencyInputSettingsSource` seam name.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currencyinput

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [CurrencyInputViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `useSettings` read behind the field's
 * `currency`/`locale`. The `/settings` document is carried as the raw [JsonElement] the backend serves so the
 * `currency_symbol` and `locale` preferences are read verbatim. No HTTP touches the view.
 */
fun interface CurrencyInputSettingsSource {
    /** Cache-then-network `GET /settings` document feed (web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer settings feed every
 * Settings-derived surface shares (the same store backing the app's live unit formatter). No HTTP touches the
 * view.
 */
fun SettingsStore.asCurrencyInputSettingsSource(): CurrencyInputSettingsSource {
    val store = this
    return CurrencyInputSettingsSource { store.settings() }
}

/**
 * Binds the surface to the shared **S7** [SettingsRepository] — the cold cache-then-network `Flow`.
 * Re-collecting it performs a genuine cache-then-network re-fetch, which backs the surface's manual refresh /
 * error-retry affordance. No HTTP touches the view.
 */
fun SettingsRepository.asCurrencyInputSettingsSource(): CurrencyInputSettingsSource {
    val repo = this
    return CurrencyInputSettingsSource { repo.settings() }
}
