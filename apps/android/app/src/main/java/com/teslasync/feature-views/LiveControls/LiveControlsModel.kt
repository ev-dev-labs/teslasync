// Pure, framework-free model + projection for the FSM-debugger Live/Freeze/Step controls feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/system/components/state-machine/LiveControls.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is a purely controlled toolbar: it receives `isLive`, the buffer-`windowMinutes` choice, the
// step-validity flags (`canStepPrev` / `canStepNext`), and the three buffer counts (`windowCount` / `totalCount`
// and the @deprecated single-scope `bufferCount` fallback), plus the change callbacks, and renders the
// Live/Freeze segmented pair, the prev/next steppers, the Window select, a Clear-buffer action, and a right-hand
// counter whose copy distinguishes the Window-dropdown slice from the underlying 24 h fetch. This file owns the
// pure parts: the window-option ladder (verbatim web `WINDOW_OPTIONS`), the count fold
// (`windowCount ?? bufferCount ?? 0` / `totalCount ?? bufferCount ?? 0` with the `dual` flag), the
// "outside the window" derivation (`max(0, total - inWindow)`), the dual-vs-single counter classifier
// (web `dual && outside > 0`), the empty-buffer test, the controlled window value mapping, the i18n
// resource-name constants for every `t(key, default)` the web calls, the localized-strings holder, and the
// top-level lifecycle classifier the composable switches on so each branch is testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveControls — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view + dashboard-widget surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livecontrols

import kotlin.math.max

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object LiveControlsRegistration {
    /** Stable surface id. */
    const val ID: String = "live-controls"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / fleet data. */
    const val SLUG: String = "LiveControls"
}

/** Minutes-per-hour, used to fold the 120-minute option onto the web "2 h" label. */
const val MINUTES_PER_HOUR: Int = 60

/**
 * The buffer-observation windows — the verbatim web `WINDOW_OPTIONS` ladder (5 / 10 / 30 minutes, then the
 * 2-hour slice). [minutes] is the controlled value the web `Select` round-trips as a string
 * (`value={String(windowMinutes)}` / `onWindowChange(Number(e.target.value))`); declaration order IS the web
 * option order so [WINDOW_OPTIONS] renders the same sequence.
 */
enum class LiveWindow(
    val minutes: Int,
) {
    W5M(5),
    W10M(10),
    W30M(30),
    W2H(120),
    ;

    /** The exact string the controlled `Select` value uses — web `String(windowMinutes)`. */
    val wire: String get() = minutes.toString()

    /** Whether this window is labelled in hours (web "2 h") rather than minutes (web "5 min"). */
    val isHours: Boolean get() = minutes >= MINUTES_PER_HOUR

    /** The hours component of this window (e.g. 120 → 2) — only meaningful when [isHours]. */
    val hours: Int get() = minutes / MINUTES_PER_HOUR

    companion object {
        /** The ladder entry whose [minutes] equals [value], or `null` for a value outside the ladder. */
        fun fromMinutes(value: Int): LiveWindow? = entries.firstOrNull { it.minutes == value }

        /** The ladder entry whose [wire] equals [value], or `null` for an unparseable / off-ladder token. */
        fun fromWire(value: String): LiveWindow? = value.toIntOrNull()?.let(::fromMinutes)
    }
}

/** The window option order — the native mirror of the web `WINDOW_OPTIONS` constant. */
val WINDOW_OPTIONS: List<LiveWindow> = LiveWindow.entries.toList()

/**
 * One fully projected, render-ready select option — the native analogue of a single web `SelectOption`
 * (`value` / `label`). Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class LiveControlsOption(
    val value: String,
    val label: String,
)

/**
 * The resolved buffer counts the toolbar reflects — the native mirror of the web component's
 * `inWindow` / `total` / `dual` derivation. [inWindow] is the count inside the active Window-dropdown slice,
 * [total] is the count fetched over the last 24 h, and [dual] records whether the caller supplied the new
 * scoped props (so the counter uses the dual copy) rather than only the @deprecated single-scope `bufferCount`.
 */
data class BufferCounts(
    val inWindow: Int,
    val total: Int,
    val dual: Boolean,
)

/** Which counter copy the right-hand label uses — web `dual && outside > 0 ? bufferedDual : buffered`. */
enum class CounterStyle { Dual, Single }

/** The control highlighted in the Live/Freeze segmented pair (the web `aria-pressed` target). */
enum class StreamMode { Live, Frozen }

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The toolbar has no feed of its own —
 * its counts arrive as props — so a host normally supplies [Ready]; [Loading] and [Error] are the lifecycle
 * chrome the shared feature-view contract (P1/S8) carries while the transition buffer is first loading or has
 * hard-failed, reproduced for full state coverage, never faked from a fetch the view performs itself.
 */
enum class LiveControlsSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [LiveControlsSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready toolbar). Kept framework-free so each
 * branch is asserted off-device. Empty / stale / offline are sub-states of [Ready] (an empty-buffer hint and a
 * freshness chip), exactly as the web toolbar always renders its controls.
 */
fun liveControlsSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): LiveControlsSurfaceState =
    when {
        isLoading -> LiveControlsSurfaceState.Loading
        isError -> LiveControlsSurfaceState.Error
        else -> LiveControlsSurfaceState.Ready
    }

/**
 * The pure projection the composable renders — the native mirror of the web component's inline derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object LiveControlsProjection {
    /**
     * Folds the three controlled count props into [BufferCounts] exactly like the web source:
     * `inWindow = windowCount ?? bufferCount ?? 0`, `total = totalCount ?? bufferCount ?? 0`, and
     * `dual = totalCount != null || windowCount != null`. Reproduces the @deprecated single-scope fallback so a
     * caller mid-migration (only `bufferCount`) drives both counts and the single-scope copy.
     */
    fun resolveCounts(
        windowCount: Int?,
        totalCount: Int?,
        bufferCount: Int?,
    ): BufferCounts =
        BufferCounts(
            inWindow = windowCount ?: bufferCount ?: 0,
            total = totalCount ?: bufferCount ?: 0,
            dual = totalCount != null || windowCount != null,
        )

    /** Transitions fetched but outside the active Window slice — web `Math.max(0, total - inWindow)`. */
    fun outsideCount(counts: BufferCounts): Int = max(0, counts.total - counts.inWindow)

    /** Whether the dual-scope counter copy applies — web `dual && outside > 0`. */
    fun isDualCounter(counts: BufferCounts): Boolean = counts.dual && outsideCount(counts) > 0

    /** Which counter copy the label uses — the pure mirror of the web ternary. */
    fun counterStyle(counts: BufferCounts): CounterStyle = if (isDualCounter(counts)) CounterStyle.Dual else CounterStyle.Single

    /**
     * Whether the transition buffer is empty (nothing in the window and nothing in 24 h). The web has no empty
     * branch — it just shows "0 buffered" — but the shared feature-view contract (P1/S8) requires a friendly,
     * always-visible empty hint, so the surface adds one without ever hiding the controls.
     */
    fun isBufferEmpty(counts: BufferCounts): Boolean = counts.inWindow == 0 && counts.total == 0

    /**
     * Builds the window select options — web `WINDOW_OPTIONS.map(...)`. [labelOf] resolves each window's display
     * label (web "5 min" / "2 h"); the projection stays pure by deferring the localized label to the caller.
     */
    fun windowOptions(labelOf: (LiveWindow) -> String): List<LiveControlsOption> =
        WINDOW_OPTIONS.map { window -> LiveControlsOption(value = window.wire, label = labelOf(window)) }

    /** The controlled window select value — web `value={String(windowMinutes)}`. */
    fun windowSelectedValue(windowMinutes: Int): String = windowMinutes.toString()

    /**
     * Maps a chosen window select [value] back to the callback argument — web
     * `onWindowChange(Number(e.target.value))`: the parsed minutes, or `null` for an unparseable token (so the
     * composable can drop it rather than dispatch a bogus window).
     */
    fun parseWindowSelection(value: String): Int? = value.toIntOrNull()

    /** The highlighted control in the Live/Freeze pair — web `aria-pressed={isLive}` / `aria-pressed={!isLive}`. */
    fun streamMode(isLive: Boolean): StreamMode = if (isLive) StreamMode.Live else StreamMode.Frozen
}

// ── i18n resource-name constants (P1/S10) ────────────────────────────────────────────────────────────────────
// Each web `debugger.controls.*` / `debugger.window.*` / `debugger.timeline.*` key maps to a `translation_*`
// resource present in values/, values-ar/, and values-he/. The composable resolves them at the Compose boundary
// via compile-time `R.string` references; these constants document the mapping and are asserted by name in the
// unit gate so a key rename is caught off-device.

/** Resource name for the web `debugger.controls.live` Live-button label. */
const val KEY_LIVE: String = "translation_debugger_controls_live"

/** Resource name for the web `debugger.controls.freeze` Freeze-button label. */
const val KEY_FREEZE: String = "translation_debugger_controls_freeze"

/** Resource name for the web `debugger.controls.stepPrev` accessible name of the previous-step button. */
const val KEY_STEP_PREV: String = "translation_debugger_controls_stepPrev"

/** Resource name for the web `debugger.controls.stepNext` accessible name of the next-step button. */
const val KEY_STEP_NEXT: String = "translation_debugger_controls_stepNext"

/** Resource name for the web `debugger.controls.window` Window caption + select accessible name. */
const val KEY_WINDOW: String = "translation_debugger_controls_window"

/** Resource name for the web `debugger.controls.clear` Clear-buffer label. */
const val KEY_CLEAR: String = "translation_debugger_controls_clear"

/** Resource name for the web `debugger.controls.buffered` single-scope counter copy ("{{n}} buffered"). */
const val KEY_BUFFERED: String = "translation_debugger_controls_buffered"

/** Resource name for the web `debugger.controls.bufferedDual` dual-scope counter copy. */
const val KEY_BUFFERED_DUAL: String = "translation_debugger_controls_bufferedDual"

/** Resource name for the web `debugger.controls.bufferedTooltip` counter hover/long-press explanation. */
const val KEY_BUFFERED_TOOLTIP: String = "translation_debugger_controls_bufferedTooltip"

/** Resource name for the minutes window-option label (web "5 min") — `%1$s min`. */
const val KEY_WINDOW_MINUTES: String = "translation_debugger_window_minutes"

/** Resource name for the hours window-option label (web "2 h") — `%1$s h`. */
const val KEY_WINDOW_HOURS: String = "translation_debugger_window_hours"

/**
 * Resource name for the always-visible empty-buffer hint. Reuses the FSM debugger's existing
 * `debugger.timeline.empty` copy ("No transitions in window"), which fits an empty transition buffer exactly, so
 * the surface adds no new microcopy while honouring the "never a blank box" contract.
 */
const val KEY_EMPTY: String = "translation_debugger_timeline_empty"

/**
 * The already-localized strings the toolbar renders, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the surface carries no English literal. [live] / [freeze] are the segmented-pair
 * labels; [stepPrev] / [stepNext] are the icon-button accessible names (web `aria-label`); [window] is the
 * caption + select accessible name; [clear] is the Clear-buffer label; [emptyHint] is the empty-state message.
 */
data class LiveControlsStrings(
    val live: String,
    val freeze: String,
    val stepPrev: String,
    val stepNext: String,
    val window: String,
    val clear: String,
    val emptyHint: String,
)

/**
 * Accessibility coverage helper: the accessible names of every interactive control the toolbar exposes, in
 * render order (Live, Freeze, previous step, next step, Window select, Clear). The composable wires each name
 * onto its control (visible label or `contentDescription`); the unit gate asserts the fold is complete and
 * blank-free so TalkBack always has a name to announce — the off-device half of the a11y-label requirement.
 */
fun interactiveAccessibleNames(strings: LiveControlsStrings): List<String> =
    listOf(
        strings.live,
        strings.freeze,
        strings.stepPrev,
        strings.stepNext,
        strings.window,
        strings.clear,
    )
