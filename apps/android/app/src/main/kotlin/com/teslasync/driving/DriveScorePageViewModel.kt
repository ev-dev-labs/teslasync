// The state holder backing the DriveScorePage driving surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/driving/pages/DriveScorePage.tsx). It projects the two reads
// (`useDrives` primary + `useDriveScore` overlay) onto the shared lifecycle-aware [UiState] surface, scoped to the
// global active vehicle (web `useSelectedVehicle`), and folds the page's date-range filter + the locally-derived score
// aggregates into a single [DriveScoreData] (all decode/derivation lives in the framework-free model). The display
// preferences (distance + speed unit + precision + locale) are derived from the live `/settings` document
// (web `useUnits`). This holder performs no HTTP — it only drives the [DriveScorePageSource] seam.
//
// UI-only state — the date [range] (web `RangePicker`), the table [sortField]/[sortDir] (web `handleSort`) and the
// [page] (web `currentPage`) — lives here so it survives recomposition; the range feeds the data projection (it filters
// the drives) while sort + pagination are applied by the view over the full scored list the data carries. The page is
// reset to 1 on a vehicle change (web `useEffect([vehicleId])`), on a range change (web `handleDateApply`) and on a
// re-sort, exactly as the web does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivescore

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.rangepicker.RangePickerValue
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import java.time.ZoneId

/**
 * @param source the P1/S8 data seam (the shared Driving repository + the real Settings holder + the app-scoped
 *   active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `driveScore.refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param now wall-clock seam for the default range + the period-stats `now` boundary; injectable for tests.
 * @param zone time-zone seam for the date math; injectable for tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveScorePageViewModel(
    private val source: DriveScorePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val zone: ZoneId = ZoneId.systemDefault(),
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val mutableRange = MutableStateFlow(RangePickerValue(defaultStartDate(now(), zone), defaultEndDate(now(), zone)))

    /** The committed date-range filter (web `startDate`/`endDate`). */
    val range: StateFlow<RangePickerValue> = mutableRange.asStateFlow()

    private val mutableSortField = MutableStateFlow(SortField.Date)

    /** The active table sort column (web `sortField`). */
    val sortField: StateFlow<SortField> = mutableSortField.asStateFlow()

    private val mutableSortDir = MutableStateFlow(SortDir.Desc)

    /** The active table sort direction (web `sortDir`). */
    val sortDir: StateFlow<SortDir> = mutableSortDir.asStateFlow()

    private val mutablePage = MutableStateFlow(1)

    /** The current 1-based table page (web `currentPage`). */
    val page: StateFlow<Int> = mutablePage.asStateFlow()

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    private val drivesFeed =
        scopedVehicleId.flatMapLatest { id -> id.activeId()?.let(source::drives) ?: EMPTY_DRIVES_FEED }

    private val scoreFeed =
        scopedVehicleId.flatMapLatest { id -> id.activeId()?.let(source::driveScore) ?: EMPTY_SCORE_FEED }

    /**
     * The primary surface: the fully-derived [DriveScoreData] as cache-then-network UI state. Re-collected when the
     * active vehicle changes, the range changes or refresh bumps; an empty scored-drive set resolves to the empty
     * surface (web `scoredDrives.length === 0`). The `/drives/score` overlay folds in via [parseDriveScore].
     */
    val state: StateFlow<UiState<DriveScoreData>> =
        combine(drivesFeed, scoreFeed, mutableRange) { drives, score, rng ->
            val (start, end) = rangeBounds(rng.start, rng.end)
            drives.mapData { list -> buildDriveScoreData(list, parseDriveScore(score.valueOrNull()), start, end, now(), zone) }
        }.asUiState(isEmpty = { it.isEmpty })

    /** The live display preferences (distance + speed unit + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<DriveScoreDisplayPrefs> =
        source
            .settings()
            .map { resource -> DriveScoreDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = DriveScoreDisplayPrefs.DEFAULT,
            )

    init {
        // Reset pagination when the global vehicle changes (web `useEffect([vehicleId])`). The selection is a
        // StateFlow, so it already conflates to distinct values.
        source.selectedVehicleId()
            .onEach { mutablePage.value = 1 }
            .launchIn(stateScope)
    }

    /** Commits a new date-range filter and returns to the first table page (web `RangePicker onChange` + `handleDateApply`). */
    fun setRange(value: RangePickerValue) {
        mutableRange.value = value
        mutablePage.value = 1
    }

    /**
     * Applies the table sort for [field] (web `handleSort`): the same column toggles direction, a new column sorts
     * descending; either way pagination returns to the first page.
     */
    fun onSort(field: SortField) {
        if (mutableSortField.value == field) {
            mutableSortDir.update { if (it == SortDir.Asc) SortDir.Desc else SortDir.Asc }
        } else {
            mutableSortField.value = field
            mutableSortDir.value = SortDir.Desc
        }
        mutablePage.value = 1
    }

    /** Moves the table to [value] (clamped by the view's page count) (web `setCurrentPage`). */
    fun setPage(value: Int) {
        mutablePage.value = value
    }

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("driveScore.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id, distance, address or score payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDriveScoreOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payloads so a null scope resolves to the empty surface rather than a fetch. */
        private val EMPTY_DRIVES_FEED: Flow<Resource<List<io.teslasync.shared.core.api.generated.Drive>>> =
            flowOf(Resource.Success(emptyList(), 0L, false))
        private val EMPTY_SCORE_FEED: Flow<Resource<kotlinx.serialization.json.JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
