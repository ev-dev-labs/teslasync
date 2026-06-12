// UI-thread-free state holder backing the Recently Viewed feature view — the native counterpart to the
// web component's `useRecentPages` hook composition
// (web/src/features/dashboard/components/RecentlyViewedWidget.tsx). It binds the read-only client-side
// [RecentPagesStore] (P1/S8) and re-shares it as a single [RecentlyViewedUiState] stream, exposing the
// PII-safe `view.opened` diagnostic. The view never performs HTTP or touches storage — it only collects
// [state] and calls [recordViewOpened].
//
// The web source is backed by a synchronous client store, so it renders exactly two branches — a
// populated list and a non-actionable empty hint (there is no network fetch, hence no error / stale /
// offline branch in the source to reproduce). The native store reads persistence off the main thread, so
// a brief [Loading] frame precedes the resolved list/empty — the one honest native-idiomatic addition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RecentlyViewedWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentlyviewed

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * The mutually-exclusive surface the Recently Viewed view renders. [Loading] is the pre-resolution frame
 * while the client store is first read; [Empty] is the resolved no-entries hint (web `entries.length === 0`);
 * [Content] carries the newest-first, capped entries the row list is projected from (web `entries.map`).
 */
sealed interface RecentlyViewedUiState {
    /** First read of the client store is in flight — render skeleton chrome. */
    data object Loading : RecentlyViewedUiState

    /** The store resolved with no entries — render the friendly empty hint, never a blank box. */
    data object Empty : RecentlyViewedUiState

    /** The store resolved with [entries] (already newest-first + capped to the display limit). */
    data class Content(
        val entries: List<RecentPageEntry>,
    ) : RecentlyViewedUiState
}

/**
 * Lifecycle-aware state holder backing the Compose [RecentlyViewedWidget]. It consumes the read-only
 * [RecentPagesStore] (P1/S8) and re-shares it as a single [RecentlyViewedUiState] stream
 * (loading → content / empty), exposing the PII-safe `view.opened` diagnostic.
 *
 * It owns no networking and no storage access. [state] maps the live recent-pages feed onto the render
 * surface (applying the newest-first + [limit] slice via [RecentlyViewedProjection.visible]) and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic with the surface
 * [RecentlyViewedRegistration.SLUG] (P1/S11).
 *
 * @param store the read-only recent-pages seam (a SharedPreferences-backed adapter in production, a fake
 *   in tests). The view-model owns no persistence — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened`.
 * @param limit the maximum number of rows to show (web `RECENT_PAGES_DISPLAY_LIMIT`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class RecentlyViewedWidgetViewModel(
    store: RecentPagesStore,
    logger: Logger,
    private val limit: Int = RecentlyViewedRegistration.DISPLAY_LIMIT,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The recent pages as UI state: [RecentlyViewedUiState.Loading] until the client store first
     * resolves, then [RecentlyViewedUiState.Empty] (no entries) or [RecentlyViewedUiState.Content]
     * (newest-first, capped to [limit]). Collected only while the UI observes it (`WhileSubscribed`).
     */
    val state: StateFlow<RecentlyViewedUiState> =
        store
            .recentPages()
            .map { entries -> entries.toUiState() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = RecentlyViewedUiState.Loading,
            )

    private fun List<RecentPageEntry>.toUiState(): RecentlyViewedUiState {
        val visible = RecentlyViewedProjection.visible(this, limit)
        return if (visible.isEmpty()) RecentlyViewedUiState.Empty else RecentlyViewedUiState.Content(visible)
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Recent-page paths/titles are privacy-sensitive, so the diagnostic carries nothing beyond the
     * slug — a diagnostics line can never leak a user's browsing history. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to RecentlyViewedRegistration.SLUG))
    }

    private companion object {
        const val EVENT_VIEW_OPENED = "view.opened"
        const val FIELD_SURFACE = "surface"
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
