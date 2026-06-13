// UI-thread-free state holder backing the PlaybackControls surface — the native port of the state the web
// component owns across its hook composition (web/src/components/data-display/PlaybackControls.tsx +
// web/src/hooks/useTripReplay.ts). It binds the replay timeline through the shared S8 [ReplayTimelineSource]
// (no HTTP touches the view, ADR-002), runs the virtual replay clock (the native `useTripReplay` engine),
// owns the inline shortcut [ShortcutToast] + the keyboard-help visibility, and emits the one PII-safe
// `view.opened` diagnostic (P1/S11). The view never performs HTTP or timing — it only collects [state] and
// forwards the bar's actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PlaybackControls) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.playbackcontrols

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * State holder for the trip-replay control bar.
 *
 * The replay timeline is folded from the shared [ReplayTimelineSource] (web `useDrivePositions`) through the
 * data layer's `Resource → UiState` contract, so the surface renders the real loading/empty/error/stale/
 * offline lifecycle. On top of it the holder runs the virtual replay clock — [play]/[pause]/[stop]/[setSpeed]/
 * [seekToProgress]/[seekBySeconds]/[stepFrame] reproduce the `useTripReplay` controls 1:1 — and the keyboard
 * surface ([onShortcut] applies a resolved [ShortcutAction] + flashes its toast, [setHelpVisible] toggles the
 * cheatsheet). A new timeline (a different drive's positions) resets the clock so the bar never shows a
 * playhead computed for another drive. [onViewOpened] emits the single PII-safe `view.opened` diagnostic.
 *
 * @param source the replay-timeline seam (an S8 `DrivingStore` adapter in production, a fake/static in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action events.
 * @param shortcutsEnabled web `enableKeyboardShortcuts` — gates the keyboard handler + the help affordance.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class PlaybackControlsViewModel(
    private val source: ReplayTimelineSource,
    logger: Logger,
    private val shortcutsEnabled: Boolean = true,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val timelineUi = MutableStateFlow(UiState.loading<ReplayTimeline>())
    private val clockState = MutableStateFlow(ReplayClockState())
    private val toastState = MutableStateFlow<ShortcutToast?>(null)
    private val helpState = MutableStateFlow(false)

    private var collectionJob: Job? = null
    private var tickerJob: Job? = null
    private var toastJob: Job? = null
    private var timelineSignature: List<Long>? = null
    private var viewOpenedRecorded = false

    /** The folded replay-bar state (lifecycle ⊕ clock ⊕ toast ⊕ help), driven by every source/action change. */
    private val mutableState =
        MutableStateFlow(fold(timelineUi.value, clockState.value, toastState.value, helpState.value))

    /** The live replay-bar state the view collects; `.value` is always the latest folded snapshot. */
    val state: StateFlow<PlaybackControlsState> = mutableState.asStateFlow()

    init {
        startCollecting()
        // Re-fold the snapshot whenever the timeline lifecycle, clock, toast, or help visibility changes.
        stateScope.launch {
            combine(timelineUi, clockState, toastState, helpState) { ui, clock, toast, help ->
                fold(ui, clock, toast, help)
            }.collect { mutableState.value = it }
        }
    }

    // ── Transport control (web useTripReplay controls) ─────────────────────────

    /** Web `play()`: resume the clock, restarting from 0 if it sat at the end. No-op on a non-playable track. */
    fun play() {
        val timeline = currentTimeline()
        if (timeline.isEmpty) return
        PlaybackControlsDiagnostics.recordPlay(logger)
        clockState.update { current ->
            val atEnd = current.elapsedMs >= timeline.totalMs
            current.copy(isPlaying = true, elapsedMs = if (atEnd) 0L else current.elapsedMs)
        }
        startTicker()
    }

    /** Web `pause()`: halt the clock in place. */
    fun pause() {
        if (!clockState.value.isPlaying) return
        PlaybackControlsDiagnostics.recordPause(logger)
        tickerJob?.cancel()
        clockState.update { it.copy(isPlaying = false) }
    }

    /** Web `isPlaying ? onPause() : onPlay()` — the Play/Pause button + the Space/K shortcut. */
    fun togglePlay() {
        if (clockState.value.isPlaying) pause() else play()
    }

    /** Web `stop()`: pause and rewind to the start (the Reset + Stop buttons both call this). */
    fun stop() {
        PlaybackControlsDiagnostics.recordStop(logger)
        tickerJob?.cancel()
        clockState.update { it.copy(isPlaying = false, elapsedMs = 0L, currentIndex = 0) }
    }

    /** Web `setSpeed(speed)`: select an explicit multiplier. */
    fun setSpeed(speed: Int) {
        PlaybackControlsDiagnostics.recordSpeed(logger)
        clockState.update { it.copy(speed = speed) }
    }

    /** Web `PlaybackSpeedMenu` click: cycle to the next-fastest speed, wrapping around. */
    fun cycleSpeed() {
        setSpeed(PlaybackControlsProjection.nextSpeed(clockState.value.speed))
    }

    /** Web `setSpeedRelative(delta)`: step the speed slot, clamped. */
    fun speedRelative(delta: Int) {
        setSpeed(PlaybackControlsProjection.shiftSpeed(clockState.value.speed, delta))
    }

    /** Web `onSeek(progress)` / `seekToProgress`: jump to a normalized 0..1 position. */
    fun seekToProgress(progress: Double) {
        PlaybackControlsDiagnostics.recordSeek(logger)
        applySeek(PlaybackControlsProjection.seekToProgress(progress, currentTimeline().totalMs))
    }

    /** Web `seekBy(deltaSeconds)`: jump by N seconds, clamped to the track. */
    fun seekBySeconds(deltaSeconds: Int) {
        PlaybackControlsDiagnostics.recordSeek(logger)
        val totalMs = currentTimeline().totalMs
        applySeek(PlaybackControlsProjection.seekBySeconds(clockState.value.elapsedMs, deltaSeconds, totalMs))
    }

    /** Web `stepFrame(delta)`: step the playhead by N position frames, clamped. */
    fun stepFrame(delta: Int) {
        val timeline = currentTimeline()
        clockState.update { current ->
            val index = PlaybackControlsProjection.stepFrame(current.currentIndex, delta, timeline.frameCount)
            current.copy(currentIndex = index, elapsedMs = PlaybackControlsProjection.offsetForIndex(timeline.offsetsMs, index))
        }
    }

    // ── Keyboard surface (web enableKeyboardShortcuts) ─────────────────────────

    /** Applies a resolved [ShortcutAction] (effect + toast) — the native port of the web `keydown` handler. */
    fun onShortcut(action: ShortcutAction) {
        when (val intent = action.intent) {
            ShortcutIntent.TogglePlay -> togglePlay()
            is ShortcutIntent.SeekBy -> seekBySeconds(intent.deltaSeconds)
            is ShortcutIntent.SeekToProgress -> seekToProgress(intent.progress)
            is ShortcutIntent.StepFrame -> stepFrame(intent.delta)
            ShortcutIntent.SpeedUp -> speedRelative(1)
            ShortcutIntent.SpeedDown -> speedRelative(-1)
        }
        flashToast(action.toast)
    }

    /** Toggles the keyboard-shortcut cheatsheet (web `Tooltip` help popover). */
    fun setHelpVisible(visible: Boolean) {
        helpState.value = visible
    }

    /** Re-collects the timeline feed after a failure — backs the error/offline surface's retry affordance. */
    fun retry() {
        collectionJob?.cancel()
        startCollecting()
    }

    /** Emits the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        PlaybackControlsDiagnostics.recordViewOpened(logger)
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private fun startCollecting() {
        collectionJob =
            stateScope.launch {
                source.timeline().collect { resource ->
                    val ui = resource.toUiState { it.isEmpty }
                    onTimelineResolved(ui.data)
                    timelineUi.value = ui
                }
            }
    }

    private fun onTimelineResolved(timeline: ReplayTimeline?) {
        val signature = timeline?.offsetsMs
        if (signature == timelineSignature) return
        // A new drive's timeline arrived — discard any clock state computed for the previous track.
        timelineSignature = signature
        tickerJob?.cancel()
        clockState.update { it.copy(isPlaying = false, elapsedMs = 0L, currentIndex = 0) }
    }

    private fun startTicker() {
        tickerJob?.cancel()
        tickerJob =
            stateScope.launch {
                while (isActive && clockState.value.isPlaying) {
                    delay(PlaybackControlsProjection.TICK_MS)
                    val timeline = currentTimeline()
                    val tick = PlaybackControlsProjection.advance(clockState.value.elapsedMs, clockState.value.speed, timeline.totalMs)
                    val index = PlaybackControlsProjection.indexAtTime(timeline.offsetsMs, tick.elapsedMs)
                    clockState.update { it.copy(elapsedMs = tick.elapsedMs, currentIndex = index, isPlaying = it.isPlaying && !tick.ended) }
                    if (tick.ended) break
                }
            }
    }

    private fun flashToast(toast: ShortcutToast) {
        toastState.value = toast
        toastJob?.cancel()
        toastJob =
            stateScope.launch {
                delay(TOAST_VISIBLE_MILLIS)
                toastState.value = null
            }
    }

    private fun currentTimeline(): ReplayTimeline = timelineUi.value.data ?: ReplayTimeline.EMPTY

    private fun applySeek(elapsedMs: Long) {
        val index = PlaybackControlsProjection.indexAtTime(currentTimeline().offsetsMs, elapsedMs)
        clockState.update { it.copy(elapsedMs = elapsedMs, currentIndex = index) }
    }

    private fun fold(
        ui: UiState<ReplayTimeline>,
        clock: ReplayClockState,
        toast: ShortcutToast?,
        help: Boolean,
    ): PlaybackControlsState {
        val timeline = ui.data ?: ReplayTimeline.EMPTY
        return PlaybackControlsState(
            phase = PlaybackControlsProjection.playbackPhase(ui.phase),
            timeline = timeline,
            clock = clock,
            markers = timeline.defaultMarkers(),
            stale = ui.stale,
            refreshing = ui.refreshing,
            errorKind = ui.errorKind,
            httpStatus = ui.httpStatus,
            shortcutsEnabled = shortcutsEnabled,
            helpVisible = help,
            toast = toast,
        )
    }

    companion object {
        /** Inline shortcut toast visibility window (web `setTimeout(..., 900)`). */
        private const val TOAST_VISIBLE_MILLIS = 900L

        /**
         * Wires the surface from the shared S8 [DrivingStore] for a specific drive (the web replay route's
         * `:id` param) — `driving.asReplayTimelineSource(driveId)` binds the `drivePositions` feed.
         */
        fun create(
            driving: DrivingStore,
            driveId: String,
            logger: Logger,
            shortcutsEnabled: Boolean = true,
        ): PlaybackControlsViewModel =
            PlaybackControlsViewModel(
                source = driving.asReplayTimelineSource(driveId),
                logger = logger,
                shortcutsEnabled = shortcutsEnabled,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            driving: DrivingStore,
            driveId: String,
            logger: Logger,
            shortcutsEnabled: Boolean = true,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { create(driving, driveId, logger, shortcutsEnabled) }
            }
    }
}
