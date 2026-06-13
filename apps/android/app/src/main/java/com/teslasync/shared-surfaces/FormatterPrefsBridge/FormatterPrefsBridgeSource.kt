// The single data port the FormatterPrefsBridge shared surface binds to — the native analogue of the data the
// web component reads (web/src/components/FormatterPrefsBridge.tsx): the `useSettings` / `useSettingsQuery`
// `/settings` document and the `subscribe(TOPICS.SETTINGS_CHANGED)` cross-tab signal. The view-model depends on
// this abstraction (a real adapter over the shared Settings layer in production, a fake in tests), never on a
// concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located adapters + builder
// alongside the namesake interface; `InvalidPackageDeclaration` is suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/FormatterPrefsBridge) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.JsonElement

/**
 * The seam the [FormatterPrefsBridgeViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network — mirroring the web bridge's two subscriptions.
 * No HTTP touches the view.
 */
interface FormatterPrefsBridgeSource {
    /** Cache-then-network `GET /settings` document feed (web `useSettings` / `useSettingsQuery`). */
    fun settings(): Flow<Resource<JsonElement>>

    /**
     * Defense-in-depth "settings changed elsewhere" signal — the native analogue of the web bridge's
     * `subscribe(TOPICS.SETTINGS_CHANGED)` path. Each emission asks the bridge to refetch the document (web
     * `qc.invalidateQueries(['settings'])`). It defaults to [emptyFlow] because the shared [SettingsStore]
     * already refreshes the settings feed on its own mutations; a host with an out-of-band mutation path (an
     * admin reset, a deep link, a future cross-process bus) wires one via [formatterPrefsBridgeSource].
     */
    fun settingsChanged(): Flow<Unit> = emptyFlow()
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer settings feed every
 * Settings-derived surface shares (the same store backing the app's live unit formatter), the native counterpart
 * of the web `useSettings` read. No HTTP touches the view.
 */
fun SettingsStore.asFormatterPrefsBridgeSource(): FormatterPrefsBridgeSource {
    val store = this
    return object : FormatterPrefsBridgeSource {
        override fun settings(): Flow<Resource<JsonElement>> = store.settings()
    }
}

/**
 * Binds the surface to the shared **S7** [SettingsRepository] — the cold cache-then-network `Flow`. Re-collecting
 * it performs a genuine cache-then-network re-fetch, which backs the bridge's refresh path. No HTTP touches the
 * view.
 */
fun SettingsRepository.asFormatterPrefsBridgeSource(): FormatterPrefsBridgeSource {
    val repo = this
    return object : FormatterPrefsBridgeSource {
        override fun settings(): Flow<Resource<JsonElement>> = repo.settings()
    }
}

/**
 * Builds a [FormatterPrefsBridgeSource] from a host-wired [settings] feed and an optional [settingsChanged]
 * signal — the production seam when a host wants to drive the web bridge's `TOPICS.SETTINGS_CHANGED`
 * defense-in-depth refetch from a real out-of-band bus. A test fake implements the interface directly instead.
 */
fun formatterPrefsBridgeSource(
    settings: () -> Flow<Resource<JsonElement>>,
    settingsChanged: () -> Flow<Unit> = { emptyFlow() },
): FormatterPrefsBridgeSource =
    object : FormatterPrefsBridgeSource {
        override fun settings(): Flow<Resource<JsonElement>> = settings()

        override fun settingsChanged(): Flow<Unit> = settingsChanged()
    }
