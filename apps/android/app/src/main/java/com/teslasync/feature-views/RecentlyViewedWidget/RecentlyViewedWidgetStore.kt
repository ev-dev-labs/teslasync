// The data port the [RecentlyViewedWidgetViewModel] binds to (P1/S8 state-holder seam) plus its
// production implementation. The web widget reads a privacy-sensitive client-side LRU and re-renders live
// via `subscribeRecentPages` (web/src/lib/recentPages.ts); there is no HTTP and no backend sync. The
// native analogue is this read-only store over the same client-side persistence: a [Flow] that emits the
// current entries immediately and re-emits whenever the persisted list changes. The view never touches
// storage — it only collects the view-model that re-shares this seam.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentlyViewedWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentlyviewed

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.flowOn

/**
 * Streams the recently-viewed entries the widget projects into its rows — the native analogue of the web
 * `getRecentPages()` snapshot + `subscribeRecentPages()` subscription folded into one reactive feed. A
 * single-method seam so the view-model depends on an abstraction (real persistence ↔ a test fake), never
 * on a concrete store or Android framework type.
 */
fun interface RecentPagesStore {
    /** The recent-page entries: the current list first, then a fresh list on every persisted change. */
    fun recentPages(): Flow<List<RecentPageEntry>>
}

/**
 * The production [RecentPagesStore], backed by the client-side [SharedPreferences] the recent-pages list
 * is persisted in (the native counterpart of the web `localStorage` store — privacy-sensitive, on-device
 * only, never synced to the backend). It emits the decoded list immediately on collection and re-emits
 * whenever the stored value changes (the native analogue of the web same-tab + cross-tab change events),
 * decoding through the pure [RecentPagesCodec]. Reads run on [ioDispatcher] so the first decode never
 * blocks the main thread.
 *
 * The recorder that writes visits is a navigation-host concern (out of this surface's scope), exactly as
 * the web records page views from its route effect, not from this widget; until a visit is recorded the
 * store yields an empty list and the surface shows its friendly empty hint.
 */
class SharedPreferencesRecentPagesStore(
    context: Context,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : RecentPagesStore {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(RecentlyViewedRegistration.PREFS_NAME, Context.MODE_PRIVATE)

    override fun recentPages(): Flow<List<RecentPageEntry>> =
        callbackFlow {
            fun emitCurrent() {
                trySend(RecentPagesCodec.decode(prefs.getString(RecentlyViewedRegistration.STORAGE_KEY, null)))
            }
            val listener =
                SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
                    if (key == null || key == RecentlyViewedRegistration.STORAGE_KEY) emitCurrent()
                }
            emitCurrent()
            prefs.registerOnSharedPreferenceChangeListener(listener)
            awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
        }.flowOn(ioDispatcher).conflate()
}
