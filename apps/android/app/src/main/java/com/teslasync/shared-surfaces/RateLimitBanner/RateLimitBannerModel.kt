// Pure, framework-free model + countdown reducer + surface classifier + data-port seam for the
// RateLimitBanner shared surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/RateLimitBanner.tsx) before it paints its sticky banner. No Compose, no
// Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A self-owned status banner. Unlike the equally-presentational sibling AiLimitBanner (whose parent owns
//     the data), this banner OWNS its visibility: it subscribes to two app-global signals dispatched by the
//     resilient HTTP client (web `resilientFetch`, web/src/lib/resilience.ts) and drives its own countdown.
//       – `teslasync:rate-limited`  — HTTP 429, detail `{ scope, retryAfterSec }`  → a Clock-iconed amber
//          "Too many requests — pausing for {n}s".
//       – `teslasync:upstream-down` — HTTP 503 `code: UPSTREAM_BREAKER_OPEN`, detail `{ upstream,
//          retryAfterSec }` → an AlertCircle-iconed amber "Tesla upstream unavailable — retry in {n}s".
//   • `state == null` → the web returns `null` (renders nothing). Native mirror: [RateLimitSurface.Hidden].
//   • `state != null` → the banner is shown; a live countdown ticks once per second, the "Retry now" action
//     stays disabled while `remaining > 0` and enables when it reaches zero, and a dismiss (✕) clears the
//     banner. On retry the web clears the banner AND invalidates every TanStack query so pages refetch
//     (`qc.invalidateQueries()`); the native [RateLimitBannerSource.retryAll] is that argument-less refresh.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing — it IS the terminal notice that an upstream call was already rate-limited or
// fast-failed. Its real, fully reproduced states are the Hidden surface and the Visible surface's branches
// (kind × counting-down/retry-ready), each reduced here and asserted in the off-device test. The one state
// the surface owns over time, the countdown, is reduced by [remainingSeconds] so the per-tick transition is
// verified without a Compose clock.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RateLimitBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AiLimitBanner / RouteAnnouncer surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ratelimitbanner

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** One countdown second, in milliseconds — the web `setInterval(…, 1000)` cadence + the `* 1000` window math. */
private const val MILLIS_PER_SECOND: Long = 1_000L

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no scope, upstream name, or
 * retry timing, so a diagnostics line can never leak which endpoint the operator was throttled on.
 */
const val RATE_LIMIT_BANNER_SLUG: String = "RateLimitBanner"

/**
 * Which transient-waiting condition tripped the banner — the native mirror of the web `State.kind`
 * (`'rate-limited' | 'upstream-down'`). Drives the icon + copy; both render with the same amber "wait and try
 * again" treatment (web `isTransientWaiting`).
 */
enum class RateLimitKind {
    /** HTTP 429 — the client is being throttled for a path scope (web `teslasync:rate-limited`). */
    RateLimited,

    /** HTTP 503 `UPSTREAM_BREAKER_OPEN` — the Tesla upstream breaker tripped (web `teslasync:upstream-down`). */
    UpstreamDown,
}

/**
 * The payload of one resilience signal the surface reacts to — the native mirror of the two web CustomEvent
 * `detail` objects dispatched by `resilientFetch`. Carried verbatim from the HTTP layer; the banner never
 * fetches it.
 *
 * @property kind which condition tripped (429 vs 503 breaker-open).
 * @property retryAfterSeconds the `Retry-After` window in seconds; `< 0` is clamped to `0` by [stateFromSignal]
 *   (a non-positive window means "retry is already available"). Drives the live countdown.
 * @property scope the rate-limited path scope (e.g. `/vehicles`), present for [RateLimitKind.RateLimited].
 *   Carried for parity + diagnostics context; the banner copy is scope-agnostic, exactly like the web.
 * @property upstream the upstream name (e.g. `tesla`), present for [RateLimitKind.UpstreamDown]. Carried for
 *   parity; not rendered, mirroring the web banner.
 */
data class RateLimitSignal(
    val kind: RateLimitKind,
    val retryAfterSeconds: Int,
    val scope: String? = null,
    val upstream: String? = null,
)

/**
 * The banner's live visibility state — the native mirror of the web `State` (`{ kind, scope?, upstream?,
 * expiresAt }`). A `null` value means the banner is hidden (web `state === null`). [expiresAtMillis] is an
 * absolute wall-clock deadline so the per-second countdown is a pure function of "now" ([remainingSeconds]).
 */
data class RateLimitState(
    val kind: RateLimitKind,
    val expiresAtMillis: Long,
    val scope: String? = null,
    val upstream: String? = null,
)

/**
 * Fold a fresh [signal] into the live [RateLimitState] at [nowMillis] — the native mirror of the web
 * `onLimited` / `onUpstream` handlers (`expiresAt = Date.now() + Math.max(0, retryAfterSec) * 1000`). A
 * negative `Retry-After` is clamped to zero so the deadline never lands in the past.
 */
fun stateFromSignal(
    signal: RateLimitSignal,
    nowMillis: Long,
): RateLimitState {
    val safeSeconds = signal.retryAfterSeconds.coerceAtLeast(0)
    return RateLimitState(
        kind = signal.kind,
        expiresAtMillis = nowMillis + safeSeconds * MILLIS_PER_SECOND,
        scope = signal.scope,
        upstream = signal.upstream,
    )
}

/**
 * Seconds remaining until [expiresAtMillis], measured from [nowMillis] — the native mirror of the web
 * `Math.max(0, Math.ceil((expiresAt - now) / 1000))`. Saturates at zero once the deadline passes so the
 * countdown never goes negative; rounds up so a partial final second still shows "1s", not "0s".
 */
fun remainingSeconds(
    expiresAtMillis: Long,
    nowMillis: Long,
): Int {
    val diff = expiresAtMillis - nowMillis
    if (diff <= 0L) return 0
    return ((diff + MILLIS_PER_SECOND - 1L) / MILLIS_PER_SECOND).toInt()
}

/**
 * Whether the "Retry now" action is tappable — the native mirror of the web `disabled={remaining > 0}` (the
 * action enables only once the countdown has fully elapsed).
 */
fun isRetryEnabled(remainingSeconds: Int): Boolean = remainingSeconds <= 0

/**
 * The render-ready classification of the banner — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device.
 */
sealed interface RateLimitSurface {
    /** `state == null` → the banner renders nothing (web returns `null`). */
    data object Hidden : RateLimitSurface

    /**
     * `state != null` → the banner is shown. Carries everything the render layer needs: the [kind] (icon +
     * copy selector), the live [remainingSeconds], and whether [retryEnabled].
     */
    data class Visible(
        val kind: RateLimitKind,
        val remainingSeconds: Int,
        val retryEnabled: Boolean,
    ) : RateLimitSurface
}

/**
 * Select the render-ready [RateLimitSurface] for [state] at the current [nowMillis]. Pure (no Compose/clock):
 * the composable supplies the live wall-clock. A `null` [state] collapses to [RateLimitSurface.Hidden] (web
 * `null`); otherwise the kind, clamped countdown, and retry-enablement are reduced into
 * [RateLimitSurface.Visible].
 */
fun classify(
    state: RateLimitState?,
    nowMillis: Long,
): RateLimitSurface {
    if (state == null) return RateLimitSurface.Hidden
    val remaining = remainingSeconds(state.expiresAtMillis, nowMillis)
    return RateLimitSurface.Visible(
        kind = state.kind,
        remainingSeconds = remaining,
        retryEnabled = isRetryEnabled(remaining),
    )
}

/**
 * The data-port seam the surface binds to (P1/S8 state-holder layer) — the native analogue of the two browser
 * primitives the web banner owns: the document-level CustomEvent bus (`teslasync:rate-limited` /
 * `teslasync:upstream-down`) and the TanStack `useQueryClient`. The view never performs HTTP nor touches the
 * platform event bus directly (ADR-002); it observes [signals] and asks the seam to [retryAll]. Production
 * composition wires a concrete adapter over the shared resilient-HTTP signal source + the cache-invalidation
 * entry; previews and tests use [InMemoryRateLimitBannerSource].
 */
interface RateLimitBannerSource {
    /**
     * The hot stream of resilience signals — one emission per web CustomEvent. The composable folds each into
     * its live [RateLimitState]; the stream itself is cold-to-the-view (collected for the surface's lifetime).
     */
    val signals: Flow<RateLimitSignal>

    /**
     * Clear the in-flight short-circuit and refetch everything — the native mirror of the web
     * `qc.invalidateQueries()` fired by "Retry now". Argument-less by design (it invalidates the whole feed,
     * exactly like the web), and `suspend` so the production adapter can await the cache flush.
     */
    suspend fun retryAll()
}

/**
 * An in-memory [RateLimitBannerSource] for previews and tests — push signals through [emit] / [tryEmit] and
 * assert the recorded [retryCalls]. Backed by a buffered [MutableSharedFlow] so a `tryEmit` before any
 * collector still enqueues. Single-writer by design, like the web component itself.
 */
class InMemoryRateLimitBannerSource(
    bufferCapacity: Int = DEFAULT_BUFFER,
) : RateLimitBannerSource {
    private val mutableSignals = MutableSharedFlow<RateLimitSignal>(extraBufferCapacity = bufferCapacity)
    private var recordedRetryCalls = 0

    override val signals: Flow<RateLimitSignal> = mutableSignals.asSharedFlow()

    /** The number of [retryAll] invocations received (test assertion seam). */
    val retryCalls: Int get() = recordedRetryCalls

    /** Suspends until [signal] is delivered to (or buffered for) collectors — the fresh-event path. */
    suspend fun emit(signal: RateLimitSignal) {
        mutableSignals.emit(signal)
    }

    /** Non-suspending enqueue of [signal]; returns whether it was accepted into the buffer. */
    fun tryEmit(signal: RateLimitSignal): Boolean = mutableSignals.tryEmit(signal)

    override suspend fun retryAll() {
        recordedRetryCalls += 1
    }

    private companion object {
        const val DEFAULT_BUFFER = 8
    }
}

/**
 * Adapt an arbitrary signal [stream] + a [retry] action into a [RateLimitBannerSource]. The production
 * composition (the DI container, outside this surface's scope) calls this to bridge the shared resilient-HTTP
 * signal source to the surface — realizing the web "document events + `invalidateQueries`" pair without the
 * view ever depending on either concrete primitive.
 */
fun rateLimitBannerSource(
    stream: Flow<RateLimitSignal>,
    retry: suspend () -> Unit,
): RateLimitBannerSource =
    object : RateLimitBannerSource {
        override val signals: Flow<RateLimitSignal> = stream

        override suspend fun retryAll() {
            retry()
        }
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the scope,
 * the upstream name, or the retry timing — so a diagnostics line can never leak the operator's throttle state.
 */
object RateLimitBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = RATE_LIMIT_BANNER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
