// The UI-thread-free state holder backing the SignalLogViewerPage telemetry surface (P1/S8) — the native counterpart of
// the web page's React state + TanStack-Query hooks (web/src/features/telemetry/pages/SignalLogViewerPage.tsx). It owns
// the page's deferred-query client state (selected signals, date window, per-page, page, "has queried yet"), projects
// the `useSignals` catalog read and the deferred per-signal `/signals/{id}/{sig}/history` fan-out onto the shared
// lifecycle-aware [UiState] surface, all scoped to the global active vehicle (web `useSelectedVehicle`). All
// decode/derivation/slicing logic lives in the framework-free model (SignalLogViewerPageModel.kt); this holder is the
// thin orchestration layer and performs no HTTP of its own — it only collects the injected [source] feeds and runs the
// merge.
//
// The catalog feed re-collects whenever the active vehicle changes (web `useSignals(vehicleId)`); its loading/error are
// folded into the selector's option list exactly as the web page does (`availableSignals ?? []`, no inline error). The
// history query is deferred: it runs only on [query] (web `enabled: queryKey !== null`), fans out one request per
// selected signal over the shared repository, merges + sorts the rows newest-first, and the page is then paginated
// purely locally by re-slicing the fetched batch ([setPage] never refetches — the web `allRows.slice(...)`). Switching
// the active vehicle resets the deferred query (its results belonged to the old vehicle) while keeping the user's
// selection + range.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signallogviewer

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.signalhistorytable.SignalLogEntry
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

/**
 * State holder backing the Compose [SignalLogViewerPage] — the Android port of the web page's deferred signal-history
 * query. It exposes one lifecycle-aware [StateFlow] of [SignalLogViewerUiState] folding the active-vehicle scope, the
 * `useSignals` catalog, the query controls, and the locally-sliced result page; and it owns the interaction setters
 * (selection / range / per-page / page / [query] / [retry]). The view renders no data of its own — every branch derives
 * from [state]; the SignalHistoryTable feature view renders the bound result `UiState`'s loading / empty / error /
 * content states.
 *
 * @param source the P1/S8 data seam (the shared telemetry repository + the app-scoped active-vehicle selection in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `query` + `refresh`.
 * @param zone the device zone used to convert the inclusive date window to the `from`/`to` ISO instants (S5); injectable
 *   for deterministic tests.
 * @param today the "now" date seeding the default `today` range window (web `useRangeState` default preset);
 *   injectable for tests.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalLogViewerPageViewModel(
    private val source: SignalLogViewerPageSource,
    logger: Logger,
    private val zone: ZoneId = ZoneId.systemDefault(),
    today: LocalDate = LocalDate.now(),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val seedDate: LocalDate = today
    private val mutableControls = MutableStateFlow(SignalLogViewerControls.initial(seedDate))
    private val queryPhase = MutableStateFlow<SignalLogQueryPhase>(SignalLogQueryPhase.NotQueried)
    private var queryJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The `GET /signals/{id}/available` catalog as the selector's option list (web `useSignals`). Re-collected on
     * vehicle change; its cache-then-network lifecycle is folded to the last-known list (web `availableSignals ?? []`),
     * so a still-loading or failed catalog simply yields the prior/empty options without an inline error.
     */
    private val availableSignals: StateFlow<List<String>> =
        source
            .selectedVehicleId()
            .flatMapLatest { id ->
                val vehicleId = id?.takeIf { it > 0L }
                if (vehicleId == null) flowOf(emptyList()) else source.signals(vehicleId).map { it.cached ?: emptyList() }
            }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /** The single render-ready page state — the Compose surface collects exactly this (web's composed render value). */
    val state: StateFlow<SignalLogViewerUiState> =
        combine(
            source.selectedVehicleId(),
            availableSignals,
            mutableControls,
            queryPhase,
        ) { vehicleId, signals, controls, phase ->
            SignalLogViewerUiState(
                vehicleId = vehicleId,
                availableSignals = signals,
                selectedSignals = controls.selectedSignals,
                from = controls.from,
                to = controls.to,
                perPage = controls.perPage,
                page = controls.page,
                hasQueried = controls.hasQueried,
                results = projectResults(phase, controls.selectedSignals, controls.page, controls.perPage),
                errorMessage = signalLogErrorMessage(phase),
            )
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = SignalLogViewerUiState.initial(seedDate),
        )

    init {
        // A vehicle switch invalidates the deferred query (those results belonged to the old vehicle), the same way the
        // web `useQuery` keys on `vehicleId`. Reset the query + pagination but keep the user's selection + range.
        launch {
            source
                .selectedVehicleId()
                .map { it?.takeIf { v -> v > 0L } }
                .distinctUntilChanged()
                .drop(1)
                .collect { resetQuery() }
        }
    }

    /** Replaces the selected-signal list (web `SignalSelector` `onChange` → `setSelectedSignals`). */
    fun setSelectedSignals(signals: List<String>) {
        mutableControls.update { it.copy(selectedSignals = signals) }
    }

    /** Applies a new inclusive `[from, to]` window (web `RangePicker` `onChange` / `setRange`); swaps if inverted. */
    fun setRange(
        from: LocalDate,
        to: LocalDate,
    ) {
        val ordered = if (from.isAfter(to)) to to from else from to to
        mutableControls.update { it.copy(from = ordered.first, to = ordered.second) }
    }

    /** Changes the local page size and returns to page 1 (web `setPerPage(...)` + `setPage(1)`). No refetch. */
    fun setPerPage(perPage: Int) {
        mutableControls.update { it.copy(perPage = perPage, page = 1) }
    }

    /** Moves to a 1-based page by re-slicing the already-fetched batch locally (web `onPageChange`). No refetch. */
    fun setPage(page: Int) {
        mutableControls.update { it.copy(page = page.coerceAtLeast(1)) }
    }

    /**
     * Runs the deferred history query (web `handleQuery`): resets to page 1, marks the page queried, and fans out one
     * `/signals/{id}/{sig}/history?from=&to=` request per selected signal, merging the rows newest-first. A no-op when
     * no vehicle is selected or no signal is chosen (web `if (!canQuery) return`). Any per-signal failure with no cached
     * fallback surfaces as the error state (web `Promise.all` rejection → `dataError`).
     */
    fun query() {
        val controls = mutableControls.value
        val vehicleId = currentVehicleId() ?: return
        if (controls.selectedSignals.isEmpty()) return
        logger.info("signalLog.query")
        mutableControls.update { it.copy(page = 1, hasQueried = true) }
        queryJob?.cancel()
        queryJob =
            stateScope.launch {
                queryPhase.value = SignalLogQueryPhase.Loading
                val (fromIso, toIso) = signalLogIsoRange(controls.from, controls.to, zone)
                try {
                    val rows = fetchAll(vehicleId, controls.selectedSignals, fromIso, toIso)
                    queryPhase.value = SignalLogQueryPhase.Loaded(rows)
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (error: Throwable) {
                    queryPhase.value = SignalLogQueryPhase.Failed(error)
                }
            }
    }

    /** Re-runs the last query — wired to the result table's hard-error retry affordance (web `refetch`). */
    fun retry() {
        logger.info("signalLog.refresh")
        query()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id or signal content. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalLogViewerPageOpened(logger)
    }

    private suspend fun fetchAll(
        vehicleId: Long,
        signals: List<String>,
        fromIso: String,
        toIso: String,
    ): List<SignalLogEntry> = mergeSignalLogRows(signals.map { signal -> fetchSignal(vehicleId, signal, fromIso, toIso) })

    /** Awaits the terminal (success/error) emission for one signal's window and adapts it; rethrows a hard failure. */
    private suspend fun fetchSignal(
        vehicleId: Long,
        signal: String,
        fromIso: String,
        toIso: String,
    ): List<SignalLogEntry> =
        when (val resource = source.signalHistory(vehicleId, signal, fromIso, toIso).first { it.isTerminal() }) {
            is Resource.Success -> adaptSignalHistory(resource.data)
            is Resource.Error -> resource.cached?.let(::adaptSignalHistory) ?: throw resource.error
            is Resource.Loading -> resource.cached?.let(::adaptSignalHistory) ?: emptyList()
        }

    private fun resetQuery() {
        queryJob?.cancel()
        queryJob = null
        queryPhase.value = SignalLogQueryPhase.NotQueried
        mutableControls.update { it.copy(page = 1, hasQueried = false) }
    }

    /** A positive selection, or null when nothing is selected (web `vehicleId > 0`). */
    private fun currentVehicleId(): Long? = source.selectedVehicleId().value?.takeIf { it > 0L }

    private companion object {
        /** Keep a feed's upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}

/** Whether a cache-then-network [Resource] has reached a terminal (success/error) emission. */
private fun Resource<*>.isTerminal(): Boolean = this is Resource.Success || this is Resource.Error
