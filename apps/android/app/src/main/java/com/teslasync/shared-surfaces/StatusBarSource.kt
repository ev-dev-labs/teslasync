// The data seam the StatusBar surface binds to for its single (local) data source — the native analogue of
// the web container's `useStatusBarPrefs` external store (web/src/components/layout/StatusBar.tsx, the
// module-level `cachedPrefs` + `useSyncExternalStore(subscribePrefs, getPrefsSnapshot)` + `setStatusBarPrefs`
// pair backed by `localStorage`). The view (composable) performs NO HTTP and never touches persistence —
// it only collects state from the [StatusBarViewModel], which drives this seam (ADR-002). A concrete
// adapter over a persisted [StatusBarPrefsStore] backs it in production; a test fake backs it in unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StatusBar) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `StatusBar*` filename cannot match the
// `StatusBarSource` seam plus its co-located store + persistence adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.statusbar

import android.content.Context
import android.content.SharedPreferences
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The seam the [StatusBarViewModel] depends on so it binds to abstractions (a real persisted store ↔ a
 * test fake), never a concrete client — the Android counterpart of the web container's
 * `useStatusBarPrefs` read + `setStatusBarPrefs` write. The preferences are carried as a cache-then-network
 * [Resource] feed (ADR-013) so the surface's loading/content/empty/error/stale/offline matrix folds out of
 * the same contract every other surface uses. No HTTP and no persistence touch the view.
 */
interface StatusBarSource {
    /** The persisted bar-preferences feed (web `useStatusBarPrefs`): hydrating → resolved, with freshness. */
    fun preferences(): Flow<Resource<StatusBarPreferences>>

    /** (Re)loads the preferences from persistence — drives the loading→content (and offline) transitions. */
    fun hydrate()

    /** Persists and broadcasts the show/hide preference (web `setStatusBarPrefs({ enabled })`). */
    fun setEnabled(enabled: Boolean)

    /** Persists and broadcasts the icon-only preference (web `setStatusBarPrefs({ iconOnly })`). */
    fun setIconOnly(iconOnly: Boolean)
}

/**
 * The persistence boundary for the bar preferences — the native analogue of the web container's
 * `localStorage.getItem/setItem(STORAGE_KEY)`. A pure read/write seam so the store is testable with an
 * in-memory fake and a read failure can be exercised deterministically.
 */
interface StatusBarPrefsPersistence {
    /** Returns the persisted preferences, or `null` when nothing has been stored yet (web `!raw`). */
    fun read(): StatusBarPreferences?

    /** Persists [prefs] (web `localStorage.setItem`). May throw; the store treats failures as best-effort. */
    fun write(prefs: StatusBarPreferences)
}

/**
 * In-memory [StatusBarPrefsPersistence] — the default seam for previews and unit tests so no real device
 * storage is touched. Seed it with [initial] to exercise the "stored value" path.
 */
class InMemoryStatusBarPrefsPersistence(
    initial: StatusBarPreferences? = null,
) : StatusBarPrefsPersistence {
    private var value: StatusBarPreferences? = initial

    override fun read(): StatusBarPreferences? = value

    override fun write(prefs: StatusBarPreferences) {
        value = prefs
    }
}

/**
 * [SharedPreferences]-backed [StatusBarPrefsPersistence] — the production seam mirroring the web
 * `localStorage` store. The two booleans are stored as discrete keys (no JSON) so a partially-written or
 * legacy value still reads cleanly; an absent record returns `null` so the store falls back to
 * [StatusBarRegistration.DEFAULTS].
 */
class SharedPreferencesStatusBarPrefsPersistence(
    private val prefs: SharedPreferences,
) : StatusBarPrefsPersistence {
    override fun read(): StatusBarPreferences? {
        if (!prefs.contains(KEY_ENABLED) && !prefs.contains(KEY_ICON_ONLY)) return null
        return StatusBarPreferences(
            enabled = prefs.getBoolean(KEY_ENABLED, StatusBarRegistration.DEFAULTS.enabled),
            iconOnly = prefs.getBoolean(KEY_ICON_ONLY, StatusBarRegistration.DEFAULTS.iconOnly),
        )
    }

    override fun write(prefs: StatusBarPreferences) {
        this.prefs
            .edit()
            .putBoolean(KEY_ENABLED, prefs.enabled)
            .putBoolean(KEY_ICON_ONLY, prefs.iconOnly)
            .apply()
    }

    companion object {
        private const val KEY_ENABLED = "enabled"
        private const val KEY_ICON_ONLY = "iconOnly"

        /** Opens the named [StatusBarRegistration.STORAGE_KEY] preference file for [context]. */
        fun fromContext(context: Context): SharedPreferencesStatusBarPrefsPersistence =
            SharedPreferencesStatusBarPrefsPersistence(
                context.getSharedPreferences(StatusBarRegistration.STORAGE_KEY, Context.MODE_PRIVATE),
            )
    }
}

/**
 * The shared, multi-observer preference store — the native port of the web container's module-level
 * `cachedPrefs` + listener set (`useSyncExternalStore`). A single instance is shared by every observer so a
 * change made anywhere (e.g. a settings toggle) refreshes the bar everywhere, the same way the web store's
 * `emitPrefs()` notifies all subscribers and the cross-tab `storage` listener mirrors changes.
 *
 * The feed starts [Resource.Loading] (pre-hydrate). [hydrate] reads persistence and resolves it to
 * [Resource.Success]; a read failure resolves to [Resource.Error] (offline/last-known when a prior value
 * exists, a hard error otherwise). Writes ([setEnabled]/[setIconOnly]) persist best-effort and broadcast the
 * new value immediately — a persistence failure still applies in-session, exactly as the web setter swallows
 * `localStorage` errors.
 *
 * @param persistence the read/write boundary (a [SharedPreferencesStatusBarPrefsPersistence] in production).
 * @param clock injectable time source for the freshness stamp; tests pass a deterministic stub.
 */
class StatusBarPrefsStore(
    private val persistence: StatusBarPrefsPersistence,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val feed =
        MutableStateFlow<Resource<StatusBarPreferences>>(
            Resource.Loading(cached = null, fetchedAt = null, stale = false),
        )

    /** The reactive preference feed shared by every observer (web `useSyncExternalStore` snapshot). */
    fun preferences(): StateFlow<Resource<StatusBarPreferences>> = feed.asStateFlow()

    /** Reads persistence into the feed: a refresh over a cached value flags it stale until the read lands. */
    fun hydrate() {
        val current = feed.value.cached
        if (current != null) {
            feed.value = Resource.Loading(cached = current, fetchedAt = null, stale = true)
        }
        // Best-effort, like the web `try { JSON.parse(localStorage…) } catch { DEFAULTS }`: a read failure
        // degrades to last-known/offline (cached present) or a hard error (no cache), never a crash.
        feed.value =
            runCatching { persistence.read() ?: StatusBarRegistration.DEFAULTS }
                .fold(
                    onSuccess = { Resource.Success(it, fetchedAt = clock(), stale = false) },
                    onFailure = { Resource.Error(cached = current, fetchedAt = clock(), stale = current != null, error = it) },
                )
    }

    /** Persists + broadcasts the show/hide preference (web `setStatusBarPrefs({ enabled })`). */
    fun setEnabled(enabled: Boolean) = update { it.copy(enabled = enabled) }

    /** Persists + broadcasts the icon-only preference (web `setStatusBarPrefs({ iconOnly })`). */
    fun setIconOnly(iconOnly: Boolean) = update { it.copy(iconOnly = iconOnly) }

    private fun update(transform: (StatusBarPreferences) -> StatusBarPreferences) {
        val current = feed.value.cached ?: StatusBarRegistration.DEFAULTS
        val next = transform(current)
        // Best-effort, like the web setter: the change still applies in-session if persistence fails.
        runCatching { persistence.write(next) }
        feed.value = Resource.Success(next, fetchedAt = clock(), stale = false)
    }

    companion object {
        /** Builds a production store over [context]'s [SharedPreferences] (the `localStorage` analogue). */
        fun fromContext(context: Context): StatusBarPrefsStore =
            StatusBarPrefsStore(SharedPreferencesStatusBarPrefsPersistence.fromContext(context))
    }
}

/**
 * Binds the surface to the shared [StatusBarPrefsStore] — the single, process-wide preference store every
 * bar observer shares (so a toggle elsewhere refreshes this shell too). No HTTP and no persistence touch
 * the view.
 *
 * @param store the shared preference store (web `useStatusBarPrefs` + `setStatusBarPrefs`).
 */
class StoreStatusBarSource(
    private val store: StatusBarPrefsStore,
) : StatusBarSource {
    override fun preferences(): Flow<Resource<StatusBarPreferences>> = store.preferences()

    override fun hydrate() = store.hydrate()

    override fun setEnabled(enabled: Boolean) = store.setEnabled(enabled)

    override fun setIconOnly(iconOnly: Boolean) = store.setIconOnly(iconOnly)
}
