// The single data port the DateRangeFilter shared surface binds to — the native analogue of the URL-state
// layer the web component reads and writes (web/src/components/forms/DateRangeFilter.tsx wires its
// `startDate`/`endDate` and `onRangeChange`/`onStartDateChange`/`onEndDateChange` through the host's
// `useUrlBatch()` setter over react-router's `useSearchParams`, persisting the `from`/`to` query params). The
// view (composable) performs NO work of its own; it only renders the projected state the ViewModel derives
// from this seam and routes edits back through it, satisfying the "data flows through the shared state holder"
// contract (P1/S8 boundary, ADR-002). No HTTP touches the view.
//
// The web persistence target is the page URL: the `from`/`to` query params are a single process-wide,
// observable, shareable store — two filters on the same page read/write the same params. This seam is the
// native counterpart of exactly that store: [range] observes the current `[start, end]` selection as a
// cache-then-network [Resource] feed (so the surface can render loading / stale / offline / error around the
// control), and the three setters mutate it atomically (the web `useUrlBatch` batch write). Like the web URL
// layer — and like the accepted ChartHiddenSeriesContext surface's self-contained param store — it is a
// self-contained state holder with no heavier store behind it, so its native counterpart is co-located with
// its sole consumer surface and exposed app-wide through [ProcessDateRangeStore].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DateRangeFilter) cannot form a valid Kotlin package.
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located default
// implementation + process instance alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.daterangefilter

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The seam the [DateRangeFilterViewModel] depends on so it binds to an abstraction (the real process-wide
 * URL-state store ↔ a throwaway test fake), never to a concrete client or the network — the Android analogue
 * of the web `useUrlBatch` / `useSearchParams` URL-state layer that backs the filter (the P1/S8 state-holder
 * boundary for this surface).
 *
 * [range] observes the current selection as a hot cache-then-network [Resource] feed (web reading
 * `from`/`to`); the three setters persist edits atomically (web `useUrlBatch` batch write); [refresh] re-reads
 * the selection (web query-state revalidation), backing the retry / stale auto-refresh affordances. No HTTP
 * touches the view.
 */
interface DateRangeFilterSource {
    /** Observes the current `[start, end]` selection (web reading the `from`/`to` URL params). */
    fun range(): Flow<Resource<DateRangeSelection>>

    /** Persists a new start bound, keeping the current end (web `onStartDateChange` → `useUrlBatch({ from })`). */
    fun setStart(start: String)

    /** Persists a new end bound, keeping the current start (web `onEndDateChange` → `useUrlBatch({ to })`). */
    fun setEnd(end: String)

    /** Persists both bounds atomically (web `onRangeChange` → `useUrlBatch({ from, to })`). */
    fun setRange(
        start: String,
        end: String,
    )

    /** Re-reads the selection (web query-state revalidation); backs retry + the stale chip's auto-refresh. */
    fun refresh()
}

/**
 * The default [DateRangeFilterSource] — a process-wide, in-memory, observable selection store, the native
 * analogue of the single page URL the web filter persists to. The selection is one [MutableStateFlow] stamped
 * with the millisecond it last changed (so [range]'s [Resource.Success.fetchedAt] is stable per value, never
 * a churn of fresh stamps); reads project it and writes update it atomically. Safe to share across surfaces
 * and call from any thread.
 *
 * @param initial the selection a fresh store starts from (default: unset — both bounds blank).
 * @param clock the wall-clock source for freshness stamps; injectable so tests pin time.
 */
class DateRangeParamStore(
    initial: DateRangeSelection = DateRangeSelection.EMPTY,
    private val clock: () -> Long = System::currentTimeMillis,
) : DateRangeFilterSource {
    private val stamped = MutableStateFlow(Stamped(initial, clock()))

    override fun range(): Flow<Resource<DateRangeSelection>> =
        stamped.map { Resource.Success(it.selection, fetchedAt = it.at, stale = false) }

    override fun setStart(start: String) {
        stamped.update { Stamped(it.selection.copy(start = start), clock()) }
    }

    override fun setEnd(end: String) {
        stamped.update { Stamped(it.selection.copy(end = end), clock()) }
    }

    override fun setRange(
        start: String,
        end: String,
    ) {
        stamped.update { Stamped(DateRangeSelection(start, end), clock()) }
    }

    override fun refresh() {
        // Re-stamp the current selection so the feed re-emits a fresh read without mutating the value.
        stamped.update { Stamped(it.selection, clock()) }
    }

    /** The selection paired with the millisecond it last changed — keeps the freshness stamp stable per value. */
    private data class Stamped(
        val selection: DateRangeSelection,
        val at: Long,
    )
}

/**
 * The process-wide date-range selection store — the native analogue of the single page URL every web filter
 * call site shares. The composable binds its [DateRangeFilterViewModel] to this instance by default so two
 * filters on the same screen read/write one selection (cross-surface, restart-stable within the process); a
 * test constructs a throwaway [DateRangeParamStore] so the shared instance is never polluted across cases.
 */
val ProcessDateRangeStore: DateRangeFilterSource = DateRangeParamStore()
