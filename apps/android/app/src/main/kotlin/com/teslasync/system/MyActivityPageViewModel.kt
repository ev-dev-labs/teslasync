// The state holder backing the MyActivityPage system surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/system/pages/MyActivityPage.tsx). It owns the page's one
// piece of local interaction state (the committed date range, web `useUrlString('start'/'end')` seeded from the
// 30-day default) and projects the single read (`useMyRecentActivity`) onto the shared lifecycle-aware [UiState]
// surface (loading → empty → success → error, plus stale/offline). The feed re-collects whenever the range
// changes or the refresh trigger bumps (the web query re-keying on its params + the error-surface `refetch`). All
// derivation logic — the default range, the params projection, the 503/401 status guards — lives in the
// framework-free model (MyActivityPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.myactivity

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.rangepicker.RangePickerValue
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.UserActivityEntry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import java.time.ZoneId

/**
 * @param source the P1/S8 data seam (the real shared User/Account holder ↔ a test fake); the view never performs
 *   HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `myActivity.refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param now wall-clock seam for the default range; injectable for tests.
 * @param zone time-zone seam for the default range's date math; injectable for tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MyActivityPageViewModel(
    private val source: MyActivityPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    now: () -> Long = { System.currentTimeMillis() },
    zone: ZoneId = ZoneId.systemDefault(),
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val mutableRange = MutableStateFlow(defaultActivityRange(now(), zone))

    /** The committed date-range filter (web `start`/`end` URL state, seeded from the 30-day default). */
    val range: StateFlow<RangePickerValue> = mutableRange.asStateFlow()

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]: loading (first activity load with nothing
     * cached) → empty (no rows in the window, web `entries.length === 0`) → content (the audit feed) → error (a
     * read failure, whose [UiState.httpStatus] carries the 503 / 401 the view branches the explanatory surfaces
     * on). Re-collected whenever the range changes (a new params key) or the refresh trigger bumps (the web
     * `refetch`).
     */
    val uiState: StateFlow<UiState<List<UserActivityEntry>>> =
        combine(mutableRange, refreshTrigger) { range, _ -> range }
            .flatMapLatest { range -> source.myRecentActivity(activityParamsFor(range)) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Commits a new date-range filter (web `RangePicker onChange` → `setRangeBatch`); the feed re-reads. */
    fun setRange(value: RangePickerValue) {
        mutableRange.value = value
    }

    /** Re-runs the cache-then-network activity load — the web error-surface `refetch()` affordance. */
    fun refresh() {
        logger.info("myActivity.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface — re-runs the load. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMyActivityPageOpened(logger)
    }

    companion object {
        /** Wire the surface from a host-supplied [source]. The holder runs on `viewModelScope`. */
        fun create(
            source: MyActivityPageSource,
            logger: Logger,
        ): MyActivityPageViewModel = MyActivityPageViewModel(source = source, logger = logger)
    }
}
