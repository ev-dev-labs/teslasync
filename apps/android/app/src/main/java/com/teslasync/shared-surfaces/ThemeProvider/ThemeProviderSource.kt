// The data seam the ThemeProvider surface binds to, plus its production binding over the shared P1/S8
// holders. Named after the surface bundle (ThemeProvider*) rather than the single interface it declares.
// The view (composable) performs NO HTTP and never touches persistence directly — it only collects state
// from the [ThemeProviderViewModel], which drives this seam, satisfying the "no direct HTTP from the view"
// contract (ADR-002).
//
// The web provider composes two data dependencies: the backend settings document (`GET /settings` read on
// mount + `PUT /settings` on every change) and a synchronous `localStorage` cache of the chosen theme/mode/
// custom colours. This seam mirrors that union: [settings] + [saveSettings] are the shared **S8**
// SettingsStore document feed + full-replace write (the `useSettings` / `useSaveSettings` ports), and
// [localSelection] + [persistSelection] are the local cache (the `localStorage` getters/setters). The
// shared SettingsStore already exists app-wide (P1/S8, `DataContainer.settingsStore`), so every observer
// folds into one upstream collection and follows one settings document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` and the ktlint filename rule are suppressed:
// the mandated `ThemeProvider*` filename cannot match the `ThemeProviderSource` seam plus its co-located
// store + persistence adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themeprovider

import android.content.Context
import android.content.SharedPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ThemeProviderViewModel] depends on so it binds to abstractions (real holders ↔ a
 * test fake), never a concrete client — the Android analogue of the web provider's `GET/PUT /settings`
 * fetch + the `localStorage` cache (P1/S8 state-holder boundary).
 *
 * [settings] streams the shared cache-then-network settings document (web mount `fetch('/settings')` +
 * the backing of `useTheme`); [saveSettings] full-replaces it (web `saveThemeToBackend`'s `PUT`);
 * [localSelection] streams the locally-cached selection (web `localStorage` snapshot) and [persistSelection]
 * writes it and broadcasts it to every observer (web `localStorage.setItem` + the cross-tab mirror). No HTTP
 * touches the view.
 */
interface ThemeProviderSource {
    /** Stream the cache-then-network `GET /settings` document (web mount fetch + `useTheme` backing). */
    fun settings(): Flow<Resource<JsonElement>>

    /** Full-replace `PUT /settings` with the merged [document] (web `saveThemeToBackend`). */
    suspend fun saveSettings(document: JsonElement): Result<JsonElement>

    /** The locally-cached selection, shared by every observer (web `localStorage` snapshot). */
    val localSelection: StateFlow<ThemeSelection>

    /** Persist + broadcast the selection (web `localStorage.setItem` + the cross-tab `storage` mirror). */
    fun persistSelection(selection: ThemeSelection)
}

/**
 * The persistence boundary for the local selection — the native analogue of the web provider's
 * `localStorage.getItem/setItem`. A pure read/write seam so the store is testable with an in-memory fake
 * and a write failure can be exercised deterministically.
 */
interface ThemeSelectionPersistence {
    /** Returns the persisted selection, or `null` when nothing has been stored yet (web `!saved`). */
    fun read(): ThemeSelection?

    /** Persists [selection] (web `localStorage.setItem`). May throw; the store treats failures as best-effort. */
    fun write(selection: ThemeSelection)
}

/**
 * In-memory [ThemeSelectionPersistence] — the default seam for previews and unit tests so no real device
 * storage is touched. Seed it with [initial] to exercise the "stored value" path.
 */
class InMemoryThemeSelectionPersistence(
    initial: ThemeSelection? = null,
) : ThemeSelectionPersistence {
    private var value: ThemeSelection? = initial

    override fun read(): ThemeSelection? = value

    override fun write(selection: ThemeSelection) {
        value = selection
    }
}

/**
 * [SharedPreferences]-backed [ThemeSelectionPersistence] — the production seam mirroring the web
 * `localStorage` store. The four values are stored under the exact web keys ([ThemeProviderRegistration]
 * `THEME_KEY` / `MODE_KEY` / `CUSTOM_PRIMARY_KEY` / `CUSTOM_ACCENT_KEY`) so the persisted form is
 * cross-platform recognisable; an absent theme record returns `null` so the store falls back to
 * [ThemeProviderRegistration.DEFAULTS].
 */
class SharedPreferencesThemeSelectionPersistence(
    private val prefs: SharedPreferences,
) : ThemeSelectionPersistence {
    override fun read(): ThemeSelection? {
        if (!prefs.contains(ThemeProviderRegistration.THEME_KEY) && !prefs.contains(ThemeProviderRegistration.MODE_KEY)) {
            return null
        }
        val defaults = ThemeProviderRegistration.DEFAULTS
        val themeId = ThemeId.fromWire(prefs.getString(ThemeProviderRegistration.THEME_KEY, null)) ?: defaults.themeId
        val modeId = ModeId.fromWire(prefs.getString(ThemeProviderRegistration.MODE_KEY, null)) ?: defaults.modeId
        return ThemeSelection(
            themeId = themeId,
            modeId = modeId,
            customPrimary = prefs.getString(ThemeProviderRegistration.CUSTOM_PRIMARY_KEY, null) ?: defaults.customPrimary,
            customAccent = prefs.getString(ThemeProviderRegistration.CUSTOM_ACCENT_KEY, null) ?: defaults.customAccent,
        )
    }

    override fun write(selection: ThemeSelection) {
        prefs
            .edit()
            .putString(ThemeProviderRegistration.THEME_KEY, selection.themeId.wire)
            .putString(ThemeProviderRegistration.MODE_KEY, selection.modeId.wire)
            .putString(ThemeProviderRegistration.CUSTOM_PRIMARY_KEY, selection.customPrimary)
            .putString(ThemeProviderRegistration.CUSTOM_ACCENT_KEY, selection.customAccent)
            .apply()
    }

    companion object {
        /** Opens the named [ThemeProviderRegistration.STORAGE_NAME] preference file for [context]. */
        fun fromContext(context: Context): SharedPreferencesThemeSelectionPersistence =
            SharedPreferencesThemeSelectionPersistence(
                context.getSharedPreferences(ThemeProviderRegistration.STORAGE_NAME, Context.MODE_PRIVATE),
            )
    }
}

/**
 * The shared, multi-observer local-selection store — the native port of the web provider's `localStorage`
 * cache plus its cross-tab `storage` mirror. A single instance is shared by every observer so a change made
 * anywhere refreshes the theme everywhere, the same way the web provider's `broadcast`/`subscribe` mirrors
 * a change across tabs.
 *
 * The selection is read synchronously from [persistence] at construction (web reads `localStorage` on init),
 * so the very first frame already has the user's choice. [persist] writes best-effort and broadcasts the new
 * value immediately — a write failure still applies in-session, exactly as the web setter swallows
 * `localStorage` errors.
 *
 * @param persistence the read/write boundary (a [SharedPreferencesThemeSelectionPersistence] in production).
 */
class ThemeSelectionStore(
    private val persistence: ThemeSelectionPersistence,
) {
    private val state = MutableStateFlow(persistence.read() ?: ThemeProviderRegistration.DEFAULTS)

    /** The reactive selection shared by every observer (web `localStorage` snapshot + cross-tab mirror). */
    val selection: StateFlow<ThemeSelection> = state.asStateFlow()

    /** Persists + broadcasts [next] (web `localStorage.setItem` + `broadcast`). Best-effort on write failure. */
    fun persist(next: ThemeSelection) {
        runCatching { persistence.write(next) }
        state.update { next }
    }

    companion object {
        /** Builds a production store over [context]'s [SharedPreferences] (the `localStorage` analogue). */
        fun fromContext(context: Context): ThemeSelectionStore =
            ThemeSelectionStore(SharedPreferencesThemeSelectionPersistence.fromContext(context))
    }
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] (the settings document feed + full-replace save,
 * exactly the feeds/invalidations the web `useSettings` / `useSaveSettings` hooks own) and the shared local
 * [ThemeSelectionStore]. Re-collecting [settings] performs a genuine cache-then-network re-fetch backing the
 * refresh/retry affordance; [saveSettings] routes through the store so it refreshes the settings feed on
 * success. No HTTP touches the view.
 *
 * @param settingsStore the shared settings document holder (web `useSettings` / `useSaveSettings`).
 * @param selectionStore the shared local selection store (web `localStorage` cache + cross-tab mirror).
 */
fun bindThemeProviderSource(
    settingsStore: SettingsStore,
    selectionStore: ThemeSelectionStore,
): ThemeProviderSource =
    object : ThemeProviderSource {
        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> = settingsStore.saveSettings(document)

        override val localSelection: StateFlow<ThemeSelection> get() = selectionStore.selection

        override fun persistSelection(selection: ThemeSelection) = selectionStore.persist(selection)
    }
