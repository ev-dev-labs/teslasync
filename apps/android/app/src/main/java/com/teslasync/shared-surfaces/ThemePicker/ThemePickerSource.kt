// The data seam the ThemePicker surface binds to for its single (local-first) data source — the native
// analogue of the web `ThemeProvider`'s persisted theme state (web/src/components/ui/ThemeProvider.tsx:
// the `localStorage` `teslasync-theme`/`teslasync-mode`/`teslasync-custom-*` keys mirrored to
// `GET/PUT /settings`). The view (composable) performs NO HTTP and never touches persistence — it only
// collects state from the [ThemePickerViewModel], which drives this seam (ADR-002). A concrete adapter over
// a persisted [ThemePreferencePersistence] backs it in production; a test fake backs it in unit tests.
//
// Like the web `ThemeProvider`, the surface OWNS this holder: a theme preference is a client-first setting
// with a persistence mirror, so "bind via the shared state-holder, no HTTP from the view" is satisfied
// honestly. The preference is carried as a cache-then-network [Resource] feed (ADR-013) so the surface's
// loading/content/empty/error/stale/offline matrix folds out of the same contract every other surface uses.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ThemePicker) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `ThemePicker*` filename cannot match the
// `ThemePickerSource` seam plus its co-located store + persistence adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import android.content.Context
import android.content.SharedPreferences
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The seam the [ThemePickerViewModel] depends on so it binds to abstractions (a real persisted store ↔ a
 * test fake), never a concrete client — the Android counterpart of the web `ThemeProvider`'s `useTheme()`
 * read + its `setTheme`/`setMode`/`setCustomColors` writes. The selection is carried as a cache-then-network
 * [Resource] feed (ADR-013) so the surface's loading/content/error/stale/offline matrix folds out of the
 * shared contract. No HTTP and no persistence touch the view.
 */
interface ThemePickerSource {
    /** The persisted selection feed (web `useTheme()`): hydrating → resolved, with honest freshness. */
    fun selection(): Flow<Resource<ThemeSelection>>

    /** (Re)loads the selection from persistence — drives the loading→content (and offline) transitions. */
    fun hydrate()

    /** Persists + broadcasts the chosen brand theme (web `setTheme(id)`). */
    fun setTheme(themeId: String)

    /** Persists + broadcasts the chosen display mode (web `setMode(id)`). */
    fun setMode(modeId: String)

    /** Persists + broadcasts custom colours and switches to the custom theme (web `setCustomColors`). */
    fun setCustomColors(
        primary: Long,
        accent: Long,
    )
}

/**
 * The persistence boundary for the theme selection — the native analogue of the web `ThemeProvider`'s
 * `localStorage` getters/setters (mirrored to `/settings`). A pure read/write seam so the store is testable
 * with an in-memory fake and a read failure can be exercised deterministically.
 */
interface ThemePreferencePersistence {
    /** Returns the persisted selection, or `null` when nothing has been stored yet (web `!saved`). */
    fun read(): ThemeSelection?

    /** Persists [selection] (web `localStorage.setItem` + `PUT /settings`). May throw; treated best-effort. */
    fun write(selection: ThemeSelection)
}

/**
 * In-memory [ThemePreferencePersistence] — the default seam for previews and unit tests so no real device
 * storage is touched. Seed it with [initial] to exercise the "stored value" path; pass a [failRead] /
 * [failWrite] flag to drive the error/offline branches deterministically.
 */
class InMemoryThemePreferencePersistence(
    initial: ThemeSelection? = null,
    private val failRead: Boolean = false,
    private val failWrite: Boolean = false,
) : ThemePreferencePersistence {
    private var value: ThemeSelection? = initial

    override fun read(): ThemeSelection? {
        if (failRead) error("theme preference read failed")
        return value
    }

    override fun write(selection: ThemeSelection) {
        if (failWrite) error("theme preference write failed")
        value = selection
    }
}

/**
 * [SharedPreferences]-backed [ThemePreferencePersistence] — the production seam mirroring the web
 * `localStorage` store. The four values are stored as discrete keys (no JSON) so a partially-written or
 * legacy value still reads cleanly; an absent record returns `null` so the store falls back to
 * [ThemePickerRegistration.DEFAULTS].
 */
class SharedPreferencesThemePreferencePersistence(
    private val prefs: SharedPreferences,
) : ThemePreferencePersistence {
    override fun read(): ThemeSelection? {
        if (!prefs.contains(KEY_THEME) && !prefs.contains(KEY_MODE)) return null
        val defaults = ThemePickerRegistration.DEFAULTS
        return ThemeSelection(
            themeId = prefs.getString(KEY_THEME, defaults.themeId) ?: defaults.themeId,
            modeId = prefs.getString(KEY_MODE, defaults.modeId) ?: defaults.modeId,
            customPrimary = prefs.getLong(KEY_CUSTOM_PRIMARY, defaults.customPrimary),
            customAccent = prefs.getLong(KEY_CUSTOM_ACCENT, defaults.customAccent),
        )
    }

    override fun write(selection: ThemeSelection) {
        prefs
            .edit()
            .putString(KEY_THEME, selection.themeId)
            .putString(KEY_MODE, selection.modeId)
            .putLong(KEY_CUSTOM_PRIMARY, selection.customPrimary)
            .putLong(KEY_CUSTOM_ACCENT, selection.customAccent)
            .apply()
    }

    companion object {
        private const val KEY_THEME = "theme"
        private const val KEY_MODE = "mode"
        private const val KEY_CUSTOM_PRIMARY = "custom_primary"
        private const val KEY_CUSTOM_ACCENT = "custom_accent"

        /** Opens the named [ThemePickerRegistration.STORAGE_KEY] preference file for [context]. */
        fun fromContext(context: Context): SharedPreferencesThemePreferencePersistence =
            SharedPreferencesThemePreferencePersistence(
                context.getSharedPreferences(ThemePickerRegistration.STORAGE_KEY, Context.MODE_PRIVATE),
            )
    }
}

/**
 * The shared, multi-observer theme preference store — the native port of the web `ThemeProvider`'s context
 * value + its cross-tab `broadcast`/`subscribe` mirror. A single instance is shared by every observer so a
 * change made anywhere (the picker, a quick-switcher, the first-run banner) re-themes everywhere, the same
 * way the web provider broadcasts `theme.changed`.
 *
 * The feed starts [Resource.Loading] (pre-hydrate). [hydrate] reads persistence and resolves it to
 * [Resource.Success]; a read failure resolves to [Resource.Error] (offline/last-known when a prior value
 * exists, a hard error otherwise) — the native analogue of the web `fetch('/settings').catch(...)` falling
 * back to localStorage/defaults. Writes ([setTheme]/[setMode]/[setCustomColors]) persist best-effort and
 * broadcast the new value immediately — a persistence failure still applies in-session, exactly as the web
 * setter swallows storage errors. [setCustomColors] also pins the theme to `custom` (web
 * `setCustomColors → setThemeId('custom')`).
 *
 * @param persistence the read/write boundary (a [SharedPreferencesThemePreferencePersistence] in production).
 * @param clock injectable time source for the freshness stamp; tests pass a deterministic stub.
 */
class ThemePreferenceStore(
    private val persistence: ThemePreferencePersistence,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val feed =
        MutableStateFlow<Resource<ThemeSelection>>(
            Resource.Loading(cached = null, fetchedAt = null, stale = false),
        )

    /** The reactive selection feed shared by every observer (web `useTheme()` context value). */
    fun selection(): StateFlow<Resource<ThemeSelection>> = feed.asStateFlow()

    /** Reads persistence into the feed: a refresh over a cached value flags it stale until the read lands. */
    fun hydrate() {
        val current = feed.value.cached
        if (current != null) {
            feed.value = Resource.Loading(cached = current, fetchedAt = null, stale = true)
        }
        // Best-effort, like the web `try { ... } catch { DEFAULTS }`: a read failure degrades to
        // last-known/offline (cached present) or a hard error (no cache), never a crash.
        feed.value =
            runCatching { persistence.read() ?: ThemePickerRegistration.DEFAULTS }
                .fold(
                    onSuccess = { Resource.Success(it, fetchedAt = clock(), stale = false) },
                    onFailure = {
                        Resource.Error(cached = current, fetchedAt = clock(), stale = current != null, error = it)
                    },
                )
    }

    /** Persists + broadcasts the chosen brand theme (web `setTheme(id)`). */
    fun setTheme(themeId: String) = update { it.copy(themeId = themeId) }

    /** Persists + broadcasts the chosen display mode (web `setMode(id)`). */
    fun setMode(modeId: String) = update { it.copy(modeId = modeId) }

    /** Persists + broadcasts custom colours and switches to the custom theme (web `setCustomColors`). */
    fun setCustomColors(
        primary: Long,
        accent: Long,
    ) = update {
        it.copy(
            themeId = ThemePickerRegistration.CUSTOM_THEME_ID,
            customPrimary = primary,
            customAccent = accent,
        )
    }

    private fun update(transform: (ThemeSelection) -> ThemeSelection) {
        val current = feed.value.cached ?: ThemePickerRegistration.DEFAULTS
        val next = transform(current)
        // Best-effort, like the web setter: the change still applies in-session if persistence fails.
        runCatching { persistence.write(next) }
        feed.value = Resource.Success(next, fetchedAt = clock(), stale = false)
    }

    companion object {
        /** Builds a production store over [context]'s [SharedPreferences] (the `localStorage` analogue). */
        fun fromContext(context: Context): ThemePreferenceStore =
            ThemePreferenceStore(SharedPreferencesThemePreferencePersistence.fromContext(context))
    }
}

/**
 * Binds the surface to the shared [ThemePreferenceStore] — the single, process-wide preference store every
 * theme observer shares (so a pick anywhere re-themes the app). No HTTP and no persistence touch the view.
 *
 * @param store the shared preference store (web `useTheme()` + its setters).
 */
class StoreThemePickerSource(
    private val store: ThemePreferenceStore,
) : ThemePickerSource {
    override fun selection(): Flow<Resource<ThemeSelection>> = store.selection()

    override fun hydrate() = store.hydrate()

    override fun setTheme(themeId: String) = store.setTheme(themeId)

    override fun setMode(modeId: String) = store.setMode(modeId)

    override fun setCustomColors(
        primary: Long,
        accent: Long,
    ) = store.setCustomColors(primary, accent)
}
