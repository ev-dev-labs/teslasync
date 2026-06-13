// Pure, framework-free progress-controller + boundary classifier + diagnostics for the
// SuspenseProgressBoundary shared surface — the native analogue of every decision the web source makes
// before any pixels are drawn. No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :app/:android testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • web/src/components/feedback/SuspenseProgressBoundary.tsx is a STRUCTURAL Suspense→progress bridge.
//     It wraps `<Suspense>` and, while the lazy child is resolving (its fallback is mounted), it activates
//     a process-wide progress controller; when the child resolves (fallback unmounts) it deactivates it.
//     It renders no chrome of its own — the caller supplies the `fallback`, and a single top-of-viewport
//     bar (web `<TopProgress>`) reflects the controller. So there is no data port to bind (no P1/S8 state
//     holder, no Source/ViewModel) and no anonymous "empty / error / stale / offline" data-states to
//     invent: modelling any would add behaviour the spec does not have (honesty covenant: no scope
//     narrowing, no silent drift). The faithful, fully reproduced states are the two render phases —
//     [BoundaryPhase.Loading] (fallback shown, controller active) and [BoundaryPhase.Loaded] (child shown,
//     controller idle) — plus the controller's own active/idle + trickle progression, all reduced here.
//   • web/src/lib/globalProgress.ts is the bridge target this surface ports verbatim: a stacking active
//     count, an idempotent stop, and an asymptotic "trickle" that advances progress toward 80% so the bar
//     keeps moving even when the underlying work reports no granular progress. The numeric contract
//     (TRICKLE_TARGET / TRICKLE_INITIAL / TRICKLE_INTERVAL_MS / the 15%-of-remaining step) is preserved
//     exactly and asserted in the off-device test; the per-tick advance is reduced by [nextTrickleProgress]
//     so the asymptote is verified without a Compose clock.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SuspenseProgressBoundary — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and PascalCase segments are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling AiLimitBanner surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.suspenseprogressboundary

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no payload of any kind, so
 * a diagnostics line from this surface can never leak what the operator was loading.
 */
const val SUSPENSE_PROGRESS_BOUNDARY_SLUG: String = "SuspenseProgressBoundary"

/** The percentage value representing a full bar — the scale the web `progress` field uses (0..100). */
const val PROGRESS_FULL: Float = 100f

/**
 * Asymptotic ceiling the trickle approaches but never reaches without an explicit stop — the web
 * `TRICKLE_TARGET`. The bar parks here (≈80%) until the last consumer stops, then snaps to 0.
 */
const val TRICKLE_TARGET: Float = 80f

/** Initial jump on the first `start` so the bar is immediately visible — the web `TRICKLE_INITIAL`. */
const val TRICKLE_INITIAL: Float = 8f

/** Tick cadence driving the asymptotic trickle, in milliseconds — the web `TRICKLE_INTERVAL_MS`. */
const val TRICKLE_INTERVAL_MS: Long = 120L

/** Fraction of the remaining gap consumed each tick — the web `remaining * 0.15`. */
const val TRICKLE_STEP_FRACTION: Float = 0.15f

/** Floor on a single tick's advance so the bar always moves forward — the web `Math.max(1, …)`. */
const val TRICKLE_MIN_STEP: Float = 1f

/**
 * An immutable snapshot of the global progress channel — the native mirror of the web globalProgress
 * `{ activeCount, progress }` plus the derived `active` edge the listeners receive.
 *
 * @property active whether at least one consumer is currently in flight (web `activeCount > 0`).
 * @property progress the trickle position on a 0..[PROGRESS_FULL] scale (web `progress`).
 * @property activeCount the number of stacked, not-yet-stopped consumers (web `activeCount`).
 */
data class GlobalProgressState(
    val active: Boolean,
    val progress: Float,
    val activeCount: Int,
) {
    /** The 0..1 fraction the determinate bar renders — see [progressFraction]. */
    val fraction: Float get() = progressFraction(progress)

    companion object {
        /** The resting state: no consumers, no progress (web initial `activeCount = 0`, `progress = 0`). */
        val Idle: GlobalProgressState = GlobalProgressState(active = false, progress = 0f, activeCount = 0)
    }
}

/**
 * Reduce a `start` — increments the stacked consumer count and, on the first consumer (web `activeCount === 1`),
 * seeds the bar at [TRICKLE_INITIAL] so it is immediately visible. Pure; the timer that follows lives in the
 * Compose layer.
 */
fun progressStart(state: GlobalProgressState): GlobalProgressState {
    val count = state.activeCount + 1
    val progress = if (count == 1) TRICKLE_INITIAL else state.progress
    return GlobalProgressState(active = count > 0, progress = progress, activeCount = count)
}

/**
 * Reduce a `stop` — decrements the consumer count (saturating at zero so a double-stop can never underflow,
 * web `Math.max(0, activeCount - 1)`) and, when the last consumer leaves, snaps progress back to 0.
 */
fun progressStop(state: GlobalProgressState): GlobalProgressState {
    val count = (state.activeCount - 1).coerceAtLeast(0)
    val progress = if (count == 0) 0f else state.progress
    return GlobalProgressState(active = count > 0, progress = progress, activeCount = count)
}

/**
 * The pure trickle step — advances [progress] by 15% of the remaining gap to [TRICKLE_TARGET] (never less than
 * [TRICKLE_MIN_STEP]) and never past the target, mirroring the web
 * `Math.min(TARGET, progress + Math.max(1, remaining * 0.15))`. At or beyond the target it holds.
 */
fun nextTrickleProgress(progress: Float): Float {
    if (progress >= TRICKLE_TARGET) return progress
    val remaining = TRICKLE_TARGET - progress
    val step = (remaining * TRICKLE_STEP_FRACTION).coerceAtLeast(TRICKLE_MIN_STEP)
    return (progress + step).coerceAtMost(TRICKLE_TARGET)
}

/**
 * Reduce one trickle tick — advances the bar while a consumer is active and below the target, and is a no-op
 * once idle or parked at the target (web: the interval early-returns when `activeCount === 0` or
 * `progress >= TARGET`). Returns the same instance when nothing changes so the controller can skip a publish.
 */
fun progressTick(state: GlobalProgressState): GlobalProgressState {
    if (state.activeCount == 0) return state
    val next = nextTrickleProgress(state.progress)
    return if (next == state.progress) state else state.copy(progress = next)
}

/** Map a 0..[PROGRESS_FULL] progress value to the 0..1 fraction the determinate [TopProgress] bar consumes. */
fun progressFraction(progress: Float): Float = (progress / PROGRESS_FULL).coerceIn(0f, 1f)

/**
 * A listener on the global progress channel — the native mirror of the web `GlobalProgressListener`
 * `(active, progress) => void`. Invoked on every state change and once, immediately, on subscribe (replay).
 */
typealias GlobalProgressListener = (active: Boolean, progress: Float) -> Unit

/**
 * The process-wide "is the app busy?" channel — a faithful port of the web `globalProgress` singleton
 * (web/src/lib/globalProgress.ts). Multiple concurrent [start]s stack; the channel stays active until the last
 * paired stop fires. Every state change is fanned out to the [subscribe]rs, and a listener mounted mid-flight
 * is replayed the current state immediately so it never misses the active edge.
 *
 * The asymptotic trickle is advanced by [tick] — the Compose [GlobalProgressBar] drives it on the
 * [TRICKLE_INTERVAL_MS] cadence (the web `setInterval`), keeping this class free of any timer so its full
 * behaviour is deterministic and unit-tested off-device. All mutation is guarded by a lock so the
 * boundary (which may start/stop from any composition) and the bar (which ticks/subscribes) never race.
 */
class GlobalProgressController {
    private val lock = Any()
    private val listeners = LinkedHashSet<GlobalProgressListener>()
    private var state: GlobalProgressState = GlobalProgressState.Idle

    /** The current channel state. */
    fun snapshot(): GlobalProgressState = synchronized(lock) { state }

    /**
     * Registers a consumer and returns its paired stop. The returned stop is idempotent (web's closure-local
     * `stopped` guard): calling it more than once — StrictMode double-invocation, a defensive `finally` chain,
     * a `DisposableEffect` that disposes twice — decrements the count exactly once.
     */
    fun start(): () -> Unit {
        mutate { progressStart(it) }
        var stopped = false
        return {
            val changed =
                synchronized(lock) {
                    if (stopped) {
                        false
                    } else {
                        stopped = true
                        state = progressStop(state)
                        true
                    }
                }
            if (changed) publish()
        }
    }

    /** Advances the trickle one step. A no-op while idle or parked at [TRICKLE_TARGET]; see [progressTick]. */
    fun tick() {
        val changed =
            synchronized(lock) {
                val next = progressTick(state)
                if (next == state) {
                    false
                } else {
                    state = next
                    true
                }
            }
        if (changed) publish()
    }

    /**
     * Subscribes [listener] to channel changes and replays the current state to it immediately (web's
     * subscribe-time replay), so a bar mounted while the channel is already active paints at once. Returns an
     * unsubscribe handle.
     */
    fun subscribe(listener: GlobalProgressListener): () -> Unit {
        val current =
            synchronized(lock) {
                listeners.add(listener)
                state
            }
        notify(listener, current)
        return { synchronized(lock) { listeners.remove(listener) } }
    }

    /** Test-only: returns the channel to [GlobalProgressState.Idle] and drops every listener. */
    fun resetForTests() {
        synchronized(lock) {
            state = GlobalProgressState.Idle
            listeners.clear()
        }
    }

    private fun mutate(reduce: (GlobalProgressState) -> GlobalProgressState) {
        synchronized(lock) { state = reduce(state) }
        publish()
    }

    private fun publish() {
        val current: GlobalProgressState
        val targets: List<GlobalProgressListener>
        synchronized(lock) {
            current = state
            // Snapshot to a fresh list — a listener may add/remove during dispatch (web `Array.from`).
            targets = listeners.toList()
        }
        targets.forEach { notify(it, current) }
    }

    private fun notify(
        listener: GlobalProgressListener,
        current: GlobalProgressState,
    ) {
        // A listener throwing must never break the channel for the others (web's per-listener try/catch).
        runCatching { listener(current.active, current.progress) }
    }
}

/**
 * The default, process-wide progress channel every [SuspenseProgressBoundary] and [GlobalProgressBar] share
 * unless a test injects its own — the native analogue of the web `export const globalProgress`.
 */
val GlobalProgress: GlobalProgressController = GlobalProgressController()

/**
 * The two mutually-exclusive render phases of the boundary — the faithful, complete state set of the web
 * Suspense wrapper (suspended vs resolved). Switched on by the composable; classified by [boundaryPhase].
 */
enum class BoundaryPhase {
    /** The lazy child is still resolving: the caller's `fallback` is shown and the channel is active. */
    Loading,

    /** The lazy child has resolved: its real content is shown and the channel has been released. */
    Loaded,
}

/** Classify the boundary's render phase from the parent's `loading` flag (web: fallback mounted vs not). */
fun boundaryPhase(loading: Boolean): BoundaryPhase = if (loading) BoundaryPhase.Loading else BoundaryPhase.Loaded

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — no route, no
 * chunk name, no timing — so a diagnostics line can never reveal what the operator was navigating to.
 */
object SuspenseProgressBoundaryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SUSPENSE_PROGRESS_BOUNDARY_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
