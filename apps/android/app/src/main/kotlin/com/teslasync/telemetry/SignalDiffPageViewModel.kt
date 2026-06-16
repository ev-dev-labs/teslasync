// The state holder backing the SignalDiffPage telemetry surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/telemetry/pages/SignalDiffPage.tsx). It owns the page's local
// interaction state (the selected vehicle, the two `datetime-local` windows, the signal filter, and the category
// chip) plus the multi-select set, and projects the page's five cache-then-network seams onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState].
//
// The resolved vehicle id (web `vehicleId = vehicleIdParam || vehicles?.[0]?.id || 0`) is derived by combining the
// live vehicle list with the interaction selection, so the page self-heals to the first vehicle until the operator
// picks one. The available-signals feed re-collects per vehicle (web `useSignals`) and its names narrow the diff
// fetch (web `signalsCsv`). The diff feed (web `useSignalDiffServer`) re-collects only when the vehicle / window /
// signal-set actually changes — the filter and category are client-side, so changing them never re-fetches. The
// pinned feed re-collects per vehicle (its `context` bucket carries the id); the pin/unpin mutation routes through
// the shared `widget` pin domain. All derivation logic lives in the framework-free model (SignalDiffPageModel.kt);
// this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signaldiff

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.signalcomparecontrols.SignalCompareTime
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.time.ZoneId

/**
 * @param source the P1/S8 data seam (the shared Vehicles + Telemetry + Pinned holders in production ↔ a test fake);
 *   the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + pin events.
 * @param zone the zone the `datetime-local` windows are interpreted in when deriving the ISO instants + span.
 * @param nowMillis the clock the default window resolves against; injectable for deterministic tests/previews.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalDiffPageViewModel(
    private val source: SignalDiffPageSource,
    logger: Logger,
    private val zone: ZoneId = ZoneId.systemDefault(),
    nowMillis: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(defaultInteraction(nowMillis(), zone))
    private val mutableSelection = MutableStateFlow<Set<String>>(emptySet())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web URL-synced vehicle + windows + filter + category). */
    val interaction: StateFlow<SignalDiffInteraction> = mutableInteraction.asStateFlow()

    /** The multi-select set driving the bulk-actions toolbar (web `selectedSignals`). */
    val selection: StateFlow<Set<String>> = mutableSelection.asStateFlow()

    private val vehiclesResource: StateFlow<Resource<List<Vehicle>>> =
        source
            .vehicles()
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), LOADING)

    /** The fleet picker list as cache-then-network UI state (web `useVehicles`). */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> = vehiclesResource.asUiState { it.isEmpty() }

    /**
     * The resolved vehicle the page operates on — the web `vehicleId = vehicleIdParam || vehicles?.[0]?.id || 0`.
     * Re-derived whenever the fleet list or the interaction selection changes; `0` until a vehicle is available.
     */
    val vehicleId: StateFlow<Long> =
        combine(vehiclesResource, mutableInteraction) { vehicles, interaction ->
            resolveVehicleId(interaction.vehicleId, vehicles.cached)
        }.distinctUntilChanged()
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), 0L)

    private val signalsResource: StateFlow<Resource<List<String>>> =
        vehicleId
            .flatMapLatest { id -> if (id > 0L) source.signals(id) else flowOf(LOADING) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), LOADING)

    /** The available-signal-name feed narrowing the diff as UI state (web `useSignals`). */
    val signalsState: StateFlow<UiState<List<String>>> = signalsResource.asUiState { it.isEmpty() }

    /**
     * The server-side snapshot diff as cache-then-network UI state (web `useSignalDiffServer`). Re-collected only
     * when the resolved vehicle, either window, or the available-signal set actually changes ([distinctUntilChanged]
     * over the query) — the client-side filter/category never re-fetch. Gated on a vehicle + both windows (web
     * `enabled: vehicleId > 0 && atAIso && atBIso`); until then it parks on a loading sentinel.
     */
    val diffState: StateFlow<UiState<SignalDiffServerResponse>> =
        combine(vehicleId, mutableInteraction, signalsResource) { id, interaction, signals ->
            DiffFeedQuery(
                vehicleId = id,
                atAIso = isoOrEmpty(interaction.atA),
                atBIso = isoOrEmpty(interaction.atB),
                signalsCsv =
                    signals.cached
                        ?.takeIf { it.isNotEmpty() }
                        ?.joinToString(",")
                        .orEmpty(),
            )
        }.distinctUntilChanged()
            .flatMapLatest { query ->
                if (query.enabled) {
                    source.signalDiff(query.vehicleId, query.atAIso, query.atBIso, query.signalsCsv)
                } else {
                    flowOf(LOADING)
                }
            }.asUiState { it.data.isEmpty() }

    /** The pinned-widget set for the page's vehicle bucket as UI state (web `usePinned('widget', context)`). */
    val pinnedState: StateFlow<UiState<List<PinnedItem>>> =
        vehicleId
            .flatMapLatest { id -> source.pinned(SignalDiffPageRegistration.pinContext(id)) }
            .asUiState { it.isEmpty() }

    /** The window-span stat in seconds, re-derived from the two windows (web `|atBIso - atAIso| / 1000`). */
    val windowSpan: StateFlow<Double?> =
        mutableInteraction
            .map { windowSpanSeconds(isoOrEmpty(it.atA), isoOrEmpty(it.atB)) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    // ── Interaction setters (web URL-state setters + the controlled-prop callbacks) ──────────────────────────────

    /** Select the vehicle to compare (web `setVehicleIdParam`). */
    fun setVehicle(id: Long): Unit = mutableInteraction.update { it.copy(vehicleId = id) }

    /** Set Window A as a `datetime-local` string (web `setAtA`). */
    fun setWindowA(value: String): Unit = mutableInteraction.update { it.copy(atA = value) }

    /** Set Window B as a `datetime-local` string (web `setAtB`). */
    fun setWindowB(value: String): Unit = mutableInteraction.update { it.copy(atB = value) }

    /** Set the signal name filter (web `setSignalFilter`). */
    fun setFilter(value: String): Unit = mutableInteraction.update { it.copy(filter = value) }

    /** Set (or clear, with `null`) the active category chip (web `setActiveCategory`). */
    fun setCategory(value: String?): Unit = mutableInteraction.update { it.copy(category = value) }

    /** Replace the multi-select set (web `setSelectedSignals`). */
    fun setSelection(value: Set<String>) {
        mutableSelection.value = value
    }

    /** Clear the multi-select set (web `onClear`). */
    fun clearSelection() {
        mutableSelection.value = emptySet()
    }

    // ── Pin mutations (web `useTogglePin` + the bulk pin/unpin actions) ──────────────────────────────────────────

    /** Pins ([pin] = true) or unpins ([pin] = false) a single signal in the current vehicle's bucket. */
    fun togglePin(
        signal: String,
        pin: Boolean,
    ) {
        val context = SignalDiffPageRegistration.pinContext(vehicleId.value)
        launch {
            source.togglePin(SignalDiffPageRegistration.pinItemId(signal), pin, context)
            logger.info("signalDiff.togglePin", mapOf("pinned" to pin.toString()))
        }
    }

    /** Bulk-pins every selected signal not already pinned (web bulk `Pin selected`). */
    fun bulkPin(
        signals: Collection<String>,
        alreadyPinned: Set<String>,
    ): Unit = signals.filterNot { alreadyPinned.contains(it) }.forEach { togglePin(it, pin = true) }

    /** Bulk-unpins every selected signal currently pinned (web bulk `Unpin selected`). */
    fun bulkUnpin(
        signals: Collection<String>,
        alreadyPinned: Set<String>,
    ): Unit = signals.filter { alreadyPinned.contains(it) }.forEach { togglePin(it, pin = false) }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalDiffPageOpened(logger)
    }

    private fun isoOrEmpty(localValue: String): String = SignalCompareTime.isoOrEmpty(localValue, zone)

    /**
     * The diff feed parameters (web `useSignalDiffServer` args + its `enabled` gate). Carried as a value object so
     * [distinctUntilChanged] suppresses a re-fetch when only the client-side filter/category changed.
     */
    private data class DiffFeedQuery(
        val vehicleId: Long,
        val atAIso: String,
        val atBIso: String,
        val signalsCsv: String,
    ) {
        val enabled: Boolean get() = vehicleId > 0L && atAIso.isNotBlank() && atBIso.isNotBlank()
    }

    private companion object {
        /** The pre-resolution loading sentinel (web `enabled:false` / cold-start), shared across feeds. */
        val LOADING: Resource<Nothing> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
