// The data port the TourLauncher misc surface binds to — the native analogue of the web localStorage tour
// layer the component reads (web/src/features/onboarding/TourLauncher.tsx via web/src/lib/tourRegistry.ts:
// `isTourCompleted`, `resetAllTours`, `markTourListSeen`; the P1/S8 state-holder boundary). The view never
// touches persistence itself, and a test fake stands in for the whole layer so the surface is verified
// off-device.
//
// The web data is SYNCHRONOUS local state (a static registry + localStorage flags), not a cache-then-network
// feed — so, exactly like the sibling synchronous surfaces (LegacyAlertsRedirect's `useLocation`, QuickNav's
// `useTranslation`), there is no loading / error / stale / offline lifecycle to model here (covenant: no
// silent drift). The holder exposes the current completion snapshot as a hot [StateFlow] that simply re-emits
// after a reset or an external completion write, mirroring the web component re-rendering on the
// `TOUR_START_EVENT`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/misc-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located persistence
// port + binding adapter.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.tourlauncher

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** SharedPreferences file name backing the launcher's tour-completion flags (the web localStorage analogue). */
const val TOUR_LAUNCHER_PREFS_NAME: String = "teslasync.tours"

/**
 * The single seam the [TourLauncherViewModel] depends on, so it binds to an abstraction (real store ↔ test
 * fake) rather than to concrete persistence. [completions] streams the current per-tour completion snapshot
 * (web `isTourCompleted` reads); [resetAll] clears every stored tour flag (web `resetAllTours`); [markListSeen]
 * records that the launcher has been opened (web `markTourListSeen`); [refresh] re-reads persistence so a
 * completion written elsewhere (the tour player) surfaces when the launcher re-opens (web `TOUR_START_EVENT`
 * re-render). No HTTP — the data is local.
 */
interface TourLauncherSource {
    /** The current completion snapshot as a hot flow; re-emits after [resetAll] or [refresh]. */
    fun completions(): StateFlow<TourCompletions>

    /** Web `resetAllTours()`: clear every stored tour completion flag (+ the legacy + list-seen keys). */
    fun resetAll()

    /** Web `markTourListSeen()`: record that the launcher has been opened at least once. */
    fun markListSeen()

    /** Re-read the completion snapshot from persistence (web re-render on `TOUR_START_EVENT`). */
    fun refresh()
}

/**
 * The minimal key/value persistence the [TourLauncherStore] needs — a tiny port over the platform store so the
 * store's projection + reset logic is verified off-device with an in-memory fake (the production binding wraps
 * Android [SharedPreferences]; the JVM unit gate cannot exercise real `SharedPreferences`).
 */
interface TourCompletionPersistence {
    /** Every stored string entry (the web localStorage snapshot the registry reads). */
    fun snapshot(): Map<String, String>

    /** Write [value] under [key] (web `localStorage.setItem`). */
    fun setValue(
        key: String,
        value: String,
    )

    /** Remove every stored key matching [predicate] (web `localStorage.removeItem` over the tour key space). */
    fun removeKeys(predicate: (String) -> Boolean)
}

/**
 * Android [SharedPreferences]-backed [TourCompletionPersistence]. A thin, side-effect-only adapter: it never
 * holds derived state (the store owns the projected snapshot), so all interesting logic stays in the
 * off-device-tested store + model. Only string entries are surfaced — the completion + list-seen flags the
 * registry stores are all strings.
 */
class SharedPreferencesTourCompletionPersistence(
    private val prefs: SharedPreferences,
) : TourCompletionPersistence {
    override fun snapshot(): Map<String, String> =
        prefs.all.entries
            .mapNotNull { (key, value) -> (value as? String)?.let { key to it } }
            .toMap()

    override fun setValue(
        key: String,
        value: String,
    ) {
        prefs.edit().putString(key, value).apply()
    }

    override fun removeKeys(predicate: (String) -> Boolean) {
        val editor = prefs.edit()
        prefs.all.keys
            .filter(predicate)
            .forEach(editor::remove)
        editor.apply()
    }
}

/**
 * The shared **S8** state holder for the launcher's persisted tour state — the native port of the web
 * `tourRegistry` localStorage layer. It projects the raw persisted entries onto a [TourCompletions] snapshot
 * (via the off-device-tested [TourCompletions.fromStorage]) and exposes it as a hot [StateFlow] so every
 * observing launcher re-renders together; [resetAll] / [markListSeen] mutate persistence and re-project. No
 * HTTP — the data is entirely local.
 */
class TourLauncherStore(
    private val persistence: TourCompletionPersistence,
) : TourLauncherSource {
    private val state = MutableStateFlow(read())

    override fun completions(): StateFlow<TourCompletions> = state.asStateFlow()

    override fun resetAll() {
        persistence.removeKeys(TourStorage::isOwnedKey)
        state.value = read()
    }

    override fun markListSeen() {
        persistence.setValue(TourStorage.LIST_SEEN_KEY, TourStorage.SEEN_VALUE)
    }

    override fun refresh() {
        state.value = read()
    }

    private fun read(): TourCompletions = TourCompletions.fromStorage(persistence.snapshot())
}

/**
 * Binds the surface to a SharedPreferences-backed [TourLauncherStore] — the production wiring the composable's
 * default source uses. A host (or the surface's `rememberTourLauncherSource`) passes the app's tour
 * preferences; tests inject a fake [TourLauncherSource] instead.
 */
fun bindTourLauncherSource(prefs: SharedPreferences): TourLauncherSource =
    TourLauncherStore(SharedPreferencesTourCompletionPersistence(prefs))
