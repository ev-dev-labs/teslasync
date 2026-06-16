// The state holder backing the TripReplayPage driving surface (P1/S8) — the native counterpart of the web page's React
// state + the `useDrive` hook + the `useTripReplay` playback engine (web/src/features/trips/pages/TripReplayPage.tsx). It
// owns the page's single source of truth for "where on the trip are we?" — the [PlaybackState] cursor — and projects the
// `GET /drives/{id}/` read onto the shared lifecycle-aware [UiState] surface, deriving the live display preferences from
// the `/settings` document (web `useUnits`). All decode/derivation logic lives in the framework-free model
// (TripReplayPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The drive feed is keyed on the route's drive id (the view-model is constructed per drive), so positions load once. The
// replay clock is the unit-tested [PlaybackState] machine from the maps layer (the same one `RoutePlayback` uses),
// advanced by a start/stop ticker that only runs while playing — so the page's scrubber, the map playhead marker, the
// elevation cursor, and the speed+power chart cursor all stay in lockstep off one `currentIndex`, and there is no
// always-on loop to leak in tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.tripreplay

import io.teslasync.android.components.maps.PlaybackState
import io.teslasync.android.components.maps.playbackPause
import io.teslasync.android.components.maps.playbackPlay
import io.teslasync.android.components.maps.playbackSeek
import io.teslasync.android.components.maps.playbackSetSpeed
import io.teslasync.android.components.maps.playbackStop
import io.teslasync.android.components.maps.playbackTick
import io.teslasync.android.components.maps.playbackTotalMs
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * @param source the P1/S8 data seam (the real shared driving repository + the shared settings holder in production ↔ a
 *   test fake); the view never performs HTTP.
 * @param driveId the drive id from the `/drives/{id}/replay` route argument; scopes the single drive-detail read.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TripReplayPageViewModel(
    private val source: TripReplayPageSource,
    private val driveId: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutablePlayback = MutableStateFlow(PlaybackState())
    private var tickJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The `GET /drives/{id}/` feed as cache-then-network UI state (web `useDrive`). Re-collected on retry; an absent /
     * positionless payload resolves to [io.teslasync.android.data.UiPhase.Empty] so the body shows the `replay.noGps`
     * empty surface (the web `positions.length === 0 && !isLoading` guard) while the header still renders any drive info.
     */
    val driveState: StateFlow<UiState<DriveReplay>> =
        refreshTrigger
            .flatMapLatest { source.drive(driveId).map { it.mapResource(::parseDriveReplay) } }
            .asUiState(isEmpty = { it.positions.isEmpty() })

    /** The replay cursor — the single source of truth threaded through the map marker, scrubber, and chart cursors. */
    val playback: StateFlow<PlaybackState> = mutablePlayback.asStateFlow()

    /** The total replay span in ms (web `replay.totalTime`); drives the scrubber's progress + elapsed/total readout. */
    val totalMs: StateFlow<Long> =
        driveState
            .map { playbackTotalMs(currentOffsets(it)) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), 0L)

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric defaults. */
    val displayPrefs: StateFlow<UnitPref> =
        source
            .settings()
            .map { UnitPreferences.fromSettings(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UnitPreferences.fromSettings(null))

    /** Starts playback; rewinds first if the cursor is at the end (web `controls.play`). */
    fun play() {
        mutablePlayback.update { playbackPlay(it, currentOffsets()) }
        startTicker()
    }

    /** Pauses without moving the cursor (web `controls.pause`). */
    fun pause() {
        mutablePlayback.update { playbackPause(it) }
        tickJob?.cancel()
    }

    /** Stops and rewinds the cursor to the start (web `controls.stop`). */
    fun stop() {
        mutablePlayback.update { playbackStop(it) }
        tickJob?.cancel()
    }

    /** Sets the replay rate, clamped to a supported value (web `controls.setSpeed`). */
    fun setSpeed(speed: Int) {
        mutablePlayback.update { playbackSetSpeed(it, speed) }
    }

    /** Jumps the cursor to a `[0,1]` progress of the total span (web `controls.seekToProgress`). */
    fun seekToProgress(progress: Float) {
        mutablePlayback.update { playbackSeek(it, currentOffsets(), progress) }
    }

    /**
     * Jumps the cursor to a specific sample [index] — the web `handleSeekToIndex` shared by the map polyline click, the
     * elevation profile, and the speed+power chart click. A no-op when no positions are loaded.
     */
    fun seekToIndex(index: Int) {
        val offsets = currentOffsets()
        if (offsets.isEmpty()) return
        val clamped = index.coerceIn(0, offsets.lastIndex)
        mutablePlayback.update { it.copy(elapsedMs = offsets[clamped], index = clamped) }
    }

    /** Re-runs the cache-then-network drive load (the error-surface retry). */
    fun refresh() {
        logger.info("replay.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTripReplayPageOpened(logger)
    }

    private fun startTicker() {
        if (tickJob?.isActive == true) return
        tickJob =
            stateScope.launch {
                while (mutablePlayback.value.playing) {
                    delay(TICK_MS.toLong())
                    mutablePlayback.update { playbackTick(it, currentOffsets(), TICK_MS) }
                }
            }
    }

    private fun currentOffsets(): List<Long> = currentOffsets(driveState.value)

    private fun currentOffsets(state: UiState<DriveReplay>): List<Long> =
        routeOffsets(state.data?.positions ?: emptyList())

    private companion object {
        /** Replay clock tick cadence in ms (matches the maps `RoutePlayback` `TICK_MS`). */
        private const val TICK_MS = 50
    }
}
