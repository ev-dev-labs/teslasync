// Pure, framework-free model + projection + diagnostics for the PlaybackControls shared surface — the
// native analogue of everything the web component derives before returning JSX
// (web/src/components/data-display/PlaybackControls.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// PlaybackControls is the trip-replay control bar. The web component is *controlled*: it receives the
// replay state (`isPlaying/speed/progress/elapsed/total/markers`) as props and emits callbacks. That
// replay state is produced upstream by `useTripReplay` (a virtual-clock engine over the drive's GPS
// timeline) fed by `useDrivePositions(driveId)` (`GET /drives/{id}/positions` → DrivePosition[]). This
// file owns the native port of that engine + the component's own bits:
//   - [ReplayTimeline.fromPositions] reproduces the web `buildTimeline` (offset-from-start map, with
//     unparseable timestamps skipped exactly as the web does) and `indexAtTime` (binary search).
//   - [PlaybackControlsProjection] reproduces the `useTripReplay` clock math (tick advance, seek-to,
//     seek-by-seconds, frame step, progress + `m:ss` formatting) and `PlaybackSpeedMenu`'s `shiftSpeed`/
//     `nextSpeed`, plus the component's keyboard-shortcut switch (`actionForKey`) and toast labels.
//   - [PlaybackControlsState] folds the upstream cache-then-network lifecycle (so every prompt state —
//     loading/empty/error/stale/offline/content — renders from the REAL `Resource` of the positions feed,
//     never fabricated) together with the replay-clock + toast + help + shortcuts sub-state.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PlaybackControls — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.playbackcontrols

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import kotlin.math.roundToLong

/**
 * Canonical metadata for this surface — pinned so the native and web surfaces stay in lockstep.
 * The web replay route is `/drives/{id}/replay`; the positions the bar replays come from the
 * `/drives/{driveID}/positions` feed (web `useDrivePositions`), bound through the shared S8 holder.
 */
object PlaybackControlsRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PlaybackControls"

    /** The ordered replay-speed multipliers (web `REPLAY_SPEEDS = [1, 10, 25, 50, 100]`). */
    val REPLAY_SPEEDS: List<Int> = listOf(1, 10, 25, 50, 100)
}

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

/** A notable moment on the replay timeline — the native port of the web `TimelineMarkerKind`. */
enum class ReplayMarkerKind { Start, Stop, ChargeStart, ChargeStop, FastSegment, RegenPeak, LowSoc, Event }

/**
 * A tick rendered on the scrubber track — the launcher-relevant subset of the web `TimelineMarker`
 * ([at] is the normalized 0..1 position; [kind] selects the tick color; [label] its tooltip).
 */
data class ReplayMarker(
    val at: Double,
    val kind: ReplayMarkerKind,
    val label: String? = null,
)

/**
 * The replay timeline — the ordered list of millisecond offsets from drive start, the native port of the
 * web `useTripReplay` `offsetsRef`/`totalTimeRef`. [totalMs] is the last offset (web
 * `offsets[offsets.length - 1]`); a timeline with no playable duration is [isEmpty].
 *
 * @property offsetsMs millisecond offset of each position from the first parseable timestamp.
 */
data class ReplayTimeline(
    val offsetsMs: List<Long>,
) {
    /** Total replay duration in ms (web `totalTime`) — the last offset, or 0 for an empty track. */
    val totalMs: Long get() = offsetsMs.lastOrNull() ?: 0L

    /** Number of position frames the playhead can step through (web `positions.length`). */
    val frameCount: Int get() = offsetsMs.size

    /** Whether there is nothing playable — no frames, or a zero-length track (web `useTripReplay([])`). */
    val isEmpty: Boolean get() = offsetsMs.isEmpty() || totalMs <= 0L

    /**
     * Default start/end ticks derived from the track (web pages pass richer `markers`; the bar always has
     * its endpoints). Empty for a non-playable track so an empty bar shows no stray ticks.
     */
    fun defaultMarkers(): List<ReplayMarker> =
        if (isEmpty) {
            emptyList()
        } else {
            listOf(
                ReplayMarker(at = 0.0, kind = ReplayMarkerKind.Start),
                ReplayMarker(at = 1.0, kind = ReplayMarkerKind.Stop),
            )
        }

    companion object {
        /** The empty track — nothing loaded yet, or a drive with no positions. */
        val EMPTY: ReplayTimeline = ReplayTimeline(emptyList())

        /**
         * Builds the timeline from the raw `/drives/{id}/positions` JSON — the native port of the web
         * `buildTimeline`: find the first parseable timestamp `t0`, then map every position to `t - t0`
         * (an unparseable timestamp maps to `0`, never poisoning `totalMs`). A bare array (web
         * `DrivePosition[]`) or a `{ positions: [...] }` envelope are both accepted; anything else, or a
         * track with no parseable timestamp at all, yields [EMPTY] (web returns `[]`).
         */
        fun fromPositions(json: JsonElement?): ReplayTimeline {
            val stamps = positionsArray(json)?.map { element -> (element as? JsonObject)?.let(::timestampMillisOf) }.orEmpty()
            val origin = stamps.firstOrNull { it != null }
            return if (origin == null) {
                EMPTY
            } else {
                ReplayTimeline(stamps.map { stamp -> if (stamp != null) stamp - origin else 0L })
            }
        }

        private fun positionsArray(json: JsonElement?): JsonArray? =
            when (json) {
                is JsonArray -> json
                is JsonObject -> json["positions"] as? JsonArray
                else -> null
            }

        private fun timestampMillisOf(obj: JsonObject): Long? = (obj["timestamp"] as? JsonPrimitive)?.contentOrNull?.let(::parseEpochMillis)

        /**
         * Tolerant ISO-8601 → epoch-millis parse (the native `new Date(ts).getTime()`): an offset
         * datetime (`…Z` / `…+02:00`), a UTC instant, then a zoneless local datetime assumed UTC. Returns
         * null on an unparseable value so the caller can skip it (web `Number.isFinite` guard).
         */
        private fun parseEpochMillis(raw: String): Long? =
            runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
                .recoverCatching { Instant.parse(raw).toEpochMilli() }
                .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() }
                .getOrNull()
    }
}

// ------------------------------------------------------------------
// Keyboard shortcuts
// ------------------------------------------------------------------

/**
 * A hardware-keyboard key the replay bar reacts to — the framework-free vocabulary the Compose layer
 * maps its `Key` events onto, so the whole shortcut switch is unit-tested without a UI host. Mirrors the
 * web `keydown` handler's `e.key` cases (`enableKeyboardShortcuts`).
 */
sealed interface ShortcutKey {
    data object Space : ShortcutKey

    data object K : ShortcutKey

    data object ArrowLeft : ShortcutKey

    data object ArrowRight : ShortcutKey

    data object J : ShortcutKey

    data object L : ShortcutKey

    data object Comma : ShortcutKey

    data object Period : ShortcutKey

    data object Home : ShortcutKey

    data object End : ShortcutKey

    data object Plus : ShortcutKey

    data object Minus : ShortcutKey

    /** A `0`–`9` digit → jump to `value × 10%` (web `onSeek(Number(e.key) / 10)`). */
    data class Digit(
        val value: Int,
    ) : ShortcutKey
}

/** What a shortcut does to the replay clock — the native port of the web handler's per-key effect. */
sealed interface ShortcutIntent {
    /** Space / K → play if paused, pause if playing (web `isPlaying ? onPause() : onPlay()`). */
    data object TogglePlay : ShortcutIntent

    /** Arrows / J / L → seek by N seconds, clamped (web `onSeekBy` / progress fallback). */
    data class SeekBy(
        val deltaSeconds: Int,
    ) : ShortcutIntent

    /** Home / End / digit → seek to a normalized 0..1 position (web `onSeek(pct)`). */
    data class SeekToProgress(
        val progress: Double,
    ) : ShortcutIntent

    /** `,` / `.` → step the playhead by N frames (web `onStepFrame`). */
    data class StepFrame(
        val delta: Int,
    ) : ShortcutIntent

    /** `+` / `=` → one speed slot faster (web `shiftSpeed(speed, 1)`). */
    data object SpeedUp : ShortcutIntent

    /** `-` / `_` → one speed slot slower (web `shiftSpeed(speed, -1)`). */
    data object SpeedDown : ShortcutIntent
}

/**
 * The transient confirmation shown after a shortcut fires — the native port of the web `shortcutToast`.
 * The View resolves each case to its label: the named cases through the P1/S10 catalog; the [Skip]/
 * [Percent] cases as the web's language-neutral symbolic strings (`⏪ −5s`, `30%`).
 */
sealed interface ShortcutToast {
    data object Play : ShortcutToast

    data object Pause : ShortcutToast

    data object PrevFrame : ShortcutToast

    data object NextFrame : ShortcutToast

    data object Start : ShortcutToast

    data object End : ShortcutToast

    data object Faster : ShortcutToast

    data object Slower : ShortcutToast

    /** Signed seconds skipped — rendered `⏪ −Ns` / `⏩ +Ns` (web hardcoded symbolic toast). */
    data class Skip(
        val deltaSeconds: Int,
    ) : ShortcutToast

    /** Percent jumped to — rendered `N%` (web `${Math.round(pct * 100)}%`). */
    data class Percent(
        val percent: Int,
    ) : ShortcutToast
}

/** A shortcut's effect + its toast, resolved together so Home (`⏮ start`) and digit-0 (`0%`) stay distinct. */
data class ShortcutAction(
    val intent: ShortcutIntent,
    val toast: ShortcutToast,
)

// ------------------------------------------------------------------
// Clock + surface state
// ------------------------------------------------------------------

/**
 * The live replay-clock state — the native port of the `useTripReplay` `[ReplayState]` the bar renders.
 *
 * @property isPlaying whether the virtual clock is advancing (web `isPlaying`).
 * @property speed the active multiplier from [PlaybackControlsRegistration.REPLAY_SPEEDS] (web `speed`).
 * @property elapsedMs the virtual clock position in ms (web `elapsedRef`/`elapsedTime`).
 * @property currentIndex the position index nearest [elapsedMs] (web `currentIndex`).
 */
data class ReplayClockState(
    val isPlaying: Boolean = false,
    val speed: Int = 1,
    val elapsedMs: Long = 0L,
    val currentIndex: Int = 0,
)

/** The mutually-exclusive primary surface the bar renders — mirrors the data layer's [UiPhase]. */
enum class PlaybackPhase { Loading, Content, Empty, Error }

/**
 * The immutable, UI-thread-free state the ViewModel exposes. It folds the upstream positions-feed
 * lifecycle ([phase]/[stale]/[refreshing]/[errorKind]) — so loading/empty/error/stale/offline all render
 * from the REAL cache-then-network `Resource`, never fabricated — together with the replay-clock state
 * and the component's own [toast]/[helpVisible]/[shortcutsEnabled] bits. Pure data, so the whole surface
 * is exercised off-device.
 */
data class PlaybackControlsState(
    val phase: PlaybackPhase,
    val timeline: ReplayTimeline = ReplayTimeline.EMPTY,
    val clock: ReplayClockState = ReplayClockState(),
    val markers: List<ReplayMarker> = emptyList(),
    val stale: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val shortcutsEnabled: Boolean = false,
    val helpVisible: Boolean = false,
    val toast: ShortcutToast? = null,
) {
    /** Normalized playhead position 0..1 (web `progress`). */
    val progress: Double get() = PlaybackControlsProjection.progressOf(clock.elapsedMs, timeline.totalMs)

    /** Whether the clock is advancing (web `isPlaying`). */
    val isPlaying: Boolean get() = clock.isPlaying

    /** True while a first load is in flight with nothing cached to show. */
    val isLoading: Boolean get() = phase == PlaybackPhase.Loading

    /** True when the interactive bar should render. */
    val isContent: Boolean get() = phase == PlaybackPhase.Content

    /** True when the drive resolved with no playable positions. */
    val isEmpty: Boolean get() = phase == PlaybackPhase.Empty

    /** True on a hard failure with nothing cached to fall back on. */
    val isError: Boolean get() = phase == PlaybackPhase.Error

    /** True when cached positions are shown because the network was unreachable / they are stale. */
    val isOffline: Boolean get() = stale && (phase == PlaybackPhase.Content || phase == PlaybackPhase.Empty)

    /** True when a retry affordance should be offered (hard error, or stale/offline last-known data). */
    val canRetry: Boolean get() = errorKind != null

    companion object {
        /** The pre-collection state: a first load with nothing cached. */
        fun loading(shortcutsEnabled: Boolean = false): PlaybackControlsState =
            PlaybackControlsState(phase = PlaybackPhase.Loading, shortcutsEnabled = shortcutsEnabled)
    }
}

// ------------------------------------------------------------------
// Projection (pure clock + shortcut + classification logic)
// ------------------------------------------------------------------

/**
 * Pure projection for the replay bar — the native port of the `useTripReplay` clock math, the
 * `PlaybackSpeedMenu` speed helpers, the component's keyboard switch, and the error classification. Every
 * function is side-effect-free, so the bar's behavior is verified without Compose, coroutines, or network.
 */
object PlaybackControlsProjection {
    /** The replay clock tick (web `useTripReplay` `TICK_MS` — 20 fps). */
    const val TICK_MS: Long = 50L

    private const val MILLIS_PER_SECOND: Long = 1_000L
    private const val SECONDS_PER_MINUTE: Int = 60
    private const val PERCENT: Int = 100
    private const val MAX_DIGIT: Int = 9

    /** Normalized progress 0..1 (web `totalTime > 0 ? elapsed / totalTime : 0`, clamped). */
    fun progressOf(
        elapsedMs: Long,
        totalMs: Long,
    ): Double = if (totalMs > 0L) (elapsedMs / (totalMs * 1.0)).coerceIn(0.0, 1.0) else 0.0

    /** The index whose offset is closest to [targetMs] — the native port of the web `indexAtTime`. */
    fun indexAtTime(
        offsetsMs: List<Long>,
        targetMs: Long,
    ): Int {
        if (offsetsMs.isEmpty()) return 0
        var lo = 0
        var hi = offsetsMs.lastIndex
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (offsetsMs[mid] < targetMs) lo = mid + 1 else hi = mid
        }
        return if (lo > 0 && targetMs - offsetsMs[lo - 1] < offsetsMs[lo] - targetMs) lo - 1 else lo
    }

    /** The result of one clock tick: the new elapsed position and whether the end was reached. */
    data class ClockTick(
        val elapsedMs: Long,
        val ended: Boolean,
    )

    /**
     * Advances the virtual clock one [TICK_MS] at [speed]× (web `elapsedRef += TICK_MS * speed`),
     * clamping to [totalMs] and flagging [ClockTick.ended] when the end is reached (web "Reached end —
     * stop"). A non-playable track stays put.
     */
    fun advance(
        elapsedMs: Long,
        speed: Int,
        totalMs: Long,
    ): ClockTick {
        if (totalMs <= 0L) return ClockTick(elapsedMs = 0L, ended = true)
        val next = elapsedMs + TICK_MS * speed
        return if (next >= totalMs) ClockTick(totalMs, ended = true) else ClockTick(next, ended = false)
    }

    /** Elapsed ms for a normalized [progress] (web `seekToProgress`). */
    fun seekToProgress(
        progress: Double,
        totalMs: Long,
    ): Long = (progress.coerceIn(0.0, 1.0) * totalMs).roundToLong().coerceIn(0L, totalMs.coerceAtLeast(0L))

    /** Elapsed ms after seeking by [deltaSeconds], clamped to `[0, totalMs]` (web `seekBy`). */
    fun seekBySeconds(
        elapsedMs: Long,
        deltaSeconds: Int,
        totalMs: Long,
    ): Long = (elapsedMs + deltaSeconds * MILLIS_PER_SECOND).coerceIn(0L, totalMs.coerceAtLeast(0L))

    /** The frame index after stepping by [delta], clamped to the track (web `stepFrame`). */
    fun stepFrame(
        currentIndex: Int,
        delta: Int,
        frameCount: Int,
    ): Int = (currentIndex + delta).coerceIn(0, (frameCount - 1).coerceAtLeast(0))

    /** The offset of [index] in [offsetsMs], clamped (web `offsets[clamped]`). */
    fun offsetForIndex(
        offsetsMs: List<Long>,
        index: Int,
    ): Long {
        if (offsetsMs.isEmpty()) return 0L
        return offsetsMs[index.coerceIn(0, offsetsMs.lastIndex)]
    }

    /** Formats a ms position as `m:ss` (web scrubber `ariaValueText`). */
    fun formatClock(ms: Long): String {
        val totalSeconds = (ms.coerceAtLeast(0L) / (MILLIS_PER_SECOND * 1.0)).roundToLong()
        val minutes = totalSeconds / SECONDS_PER_MINUTE
        val seconds = totalSeconds % SECONDS_PER_MINUTE
        return "$minutes:${seconds.toString().padStart(2, '0')}"
    }

    /** Steps [current] by [delta] slots through [PlaybackControlsRegistration.REPLAY_SPEEDS] (web `shiftSpeed`). */
    fun shiftSpeed(
        current: Int,
        delta: Int,
    ): Int {
        val speeds = PlaybackControlsRegistration.REPLAY_SPEEDS
        val index = speeds.indexOf(current).let { if (it == -1) 0 else it }
        return speeds[(index + delta).coerceIn(0, speeds.lastIndex)]
    }

    /** The next-fastest speed, wrapping to the slowest (web `nextSpeed`). */
    fun nextSpeed(current: Int): Int {
        val speeds = PlaybackControlsRegistration.REPLAY_SPEEDS
        val index = speeds.indexOf(current).let { if (it == -1) 0 else it }
        return speeds[(index + 1) % speeds.size]
    }

    /**
     * Resolves a [ShortcutKey] (with the Shift modifier and the pre-toggle [wasPlaying] state) into the
     * effect + toast to apply — the native port of the web `keydown` switch. Returns null for an
     * out-of-range digit so a stray key never seeks.
     */
    fun actionForKey(
        key: ShortcutKey,
        shift: Boolean,
        wasPlaying: Boolean,
    ): ShortcutAction? =
        when (key) {
            ShortcutKey.Space, ShortcutKey.K ->
                ShortcutAction(ShortcutIntent.TogglePlay, if (wasPlaying) ShortcutToast.Pause else ShortcutToast.Play)
            is ShortcutKey.Digit -> digitAction(key.value)
            else -> staticAction(key, shift)
        }

    private fun staticAction(
        key: ShortcutKey,
        shift: Boolean,
    ): ShortcutAction? =
        when (key) {
            ShortcutKey.ArrowLeft -> skipAction(if (shift) -30 else -5)
            ShortcutKey.ArrowRight -> skipAction(if (shift) 30 else 5)
            ShortcutKey.J -> skipAction(-10)
            ShortcutKey.L -> skipAction(10)
            ShortcutKey.Comma -> ShortcutAction(ShortcutIntent.StepFrame(-1), ShortcutToast.PrevFrame)
            ShortcutKey.Period -> ShortcutAction(ShortcutIntent.StepFrame(1), ShortcutToast.NextFrame)
            ShortcutKey.Home -> ShortcutAction(ShortcutIntent.SeekToProgress(0.0), ShortcutToast.Start)
            ShortcutKey.End -> ShortcutAction(ShortcutIntent.SeekToProgress(1.0), ShortcutToast.End)
            ShortcutKey.Plus -> ShortcutAction(ShortcutIntent.SpeedUp, ShortcutToast.Faster)
            ShortcutKey.Minus -> ShortcutAction(ShortcutIntent.SpeedDown, ShortcutToast.Slower)
            else -> null
        }

    private fun skipAction(deltaSeconds: Int): ShortcutAction =
        ShortcutAction(ShortcutIntent.SeekBy(deltaSeconds), ShortcutToast.Skip(deltaSeconds))

    private fun digitAction(value: Int): ShortcutAction? {
        if (value !in 0..MAX_DIGIT) return null
        val fraction = value / ((MAX_DIGIT + 1) * 1.0)
        return ShortcutAction(ShortcutIntent.SeekToProgress(fraction), ShortcutToast.Percent((fraction * PERCENT).roundToLong().toInt()))
    }

    /** Maps the data layer's [UiPhase] onto the bar's [PlaybackPhase]. */
    fun playbackPhase(phase: UiPhase): PlaybackPhase =
        when (phase) {
            UiPhase.Loading -> PlaybackPhase.Loading
            UiPhase.Content -> PlaybackPhase.Content
            UiPhase.Empty -> PlaybackPhase.Empty
            UiPhase.Error -> PlaybackPhase.Error
        }

    /**
     * Classifies the positions-feed failure into the shared [QueryErrorKind] recovery bucket (web
     * `QueryError`): a circuit-open fault is transient "waiting"; a network/timeout fault is "offline";
     * otherwise the HTTP status decides.
     */
    fun queryErrorKindFor(
        errorKind: ErrorKind?,
        httpStatus: Int?,
    ): QueryErrorKind {
        val waiting = errorKind == ErrorKind.CircuitOpen
        val online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout
        return classifyQueryError(status = httpStatus, online = online, transientWaiting = waiting)
    }
}

// ------------------------------------------------------------------
// Strings + diagnostics
// ------------------------------------------------------------------

/**
 * Localized labels the surface folds in — built from `stringResource` at the render boundary (tests pass
 * a deterministic instance), keeping the projection a pure, locale-stable function. Every string resolves
 * through the P1/S10 catalog; the error/empty recovery copy is owned by the shared QueryError/EmptyState.
 */
data class PlaybackControlsStrings(
    val reset: String,
    val play: String,
    val pause: String,
    val stop: String,
    val speedLabel: String,
    val progressLabel: String,
    val helpLabel: String,
    val helpTitle: String,
    val rowPlayPause: String,
    val rowSkip5: String,
    val rowSkip10: String,
    val rowFrame: String,
    val rowStartEnd: String,
    val rowPercent: String,
    val rowSpeed: String,
    val emptyMessage: String,
    val resourceName: String,
    val offlineLabel: String,
    val loadingLabel: String,
    val retryLabel: String,
)

/**
 * The PII-safe diagnostics this surface emits (P1/S11). Every event carries only the surface [SLUG] —
 * never a drive id, position, or any user data — so a diagnostics line can never leak which drive the
 * user is replaying or where they are.
 */
object PlaybackControlsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = PlaybackControlsRegistration.SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val PLAY: String = "playbackControls.play"
    private const val PAUSE: String = "playbackControls.pause"
    private const val STOP: String = "playbackControls.stop"
    private const val SEEK: String = "playbackControls.seek"
    private const val SPEED: String = "playbackControls.speed"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one mandated `view.opened` diagnostic for this surface (P1/S11). Call once on first composition. */
    fun recordViewOpened(logger: Logger) = logger.info(VIEW_OPENED, surfaceFields())

    /** Records a play action (web `onPlay`). Slug only. */
    fun recordPlay(logger: Logger) = logger.info(PLAY, surfaceFields())

    /** Records a pause action (web `onPause`). Slug only. */
    fun recordPause(logger: Logger) = logger.info(PAUSE, surfaceFields())

    /** Records a stop/reset action (web `onStop`). Slug only. */
    fun recordStop(logger: Logger) = logger.info(STOP, surfaceFields())

    /** Records a seek action (web `onSeek`). Slug only — never the position. */
    fun recordSeek(logger: Logger) = logger.info(SEEK, surfaceFields())

    /** Records a speed change (web `onSpeedChange`). Slug only. */
    fun recordSpeed(logger: Logger) = logger.info(SPEED, surfaceFields())

    private fun surfaceFields(): Map<String, String> = mapOf(SURFACE_KEY to SLUG)
}
