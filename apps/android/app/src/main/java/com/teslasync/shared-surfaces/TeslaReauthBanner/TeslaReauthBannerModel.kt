// Pure, framework-free model + projection + app-level signal bus for the TeslaReauthBanner shared surface — the
// native analogue of web/src/components/feedback/TeslaReauthBanner.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web component is a
// sticky, non-blocking banner recovering the Tesla third-party OAuth grant (the refresh token's hard 8-week TTL).
// It owns a single local `visible` flag driven by two document-level CustomEvents and two user actions:
//   • `teslasync:tesla-auth-expired`   → `setVisible(true)`  (a Tesla-backed call 401'd with TESLA_TOKEN_EXPIRED);
//   • `teslasync:tesla-auth-recovered` → `setVisible(false)` AND `drainQueuedTeslaMutations()` (replay the commands
//                                         the user attempted while disconnected);
//   • Reconnect CTA → `navigate('/tesla-account')`;
//   • Dismiss (X)  → `setVisible(false)` locally (NO recovered event, NO drain);
//   • `if (!visible) return null` — when hidden it contributes zero layout, never a blank box.
// A fresh `expired` event after a dismiss re-shows the banner (each event sets `visible = true` unconditionally).
//
// HOW THAT MAPS ONTO NATIVE (P1/S8, ADR-002). The web is driven by an app-GLOBAL `document` event target plus the
// `teslaAuthRecovery.ts` replay queue — both EXTERNAL to the component, which only subscribes + presents. Neither
// was ported to the shared core, and the native Authentik [io.teslasync.android.auth.AuthController] is the
// *SessionExpiredModal* analogue (a hard sign-in blocker), explicitly DISTINCT from this partial-failure banner. So
// this surface owns the faithful native analogue of that global event bus + recovery queue, [TeslaReauthBus]: an
// app-scoped hot event stream ([notifyExpired]/[notifyRecovered]) and a best-effort mutation replay queue
// ([enqueueMutation]/[drainQueuedMutations]). The external producers (a future 401 interceptor; the tesla-account
// screen on a successful reconnect) call into the SAME process-global [TeslaReauthBus.global] the surface observes —
// exactly as the web's `resilientFetch` / `TeslaAccountSection` dispatch onto `document`.
//
// The web's generic loading/empty/error/stale template states do NOT independently apply to a binary event banner
// (it cannot "load", is never an empty collection, cannot "error", and has no freshness window). They fold onto the
// two honest web branches this file reproduces: Dormant ([TeslaReauthRender.showBanner] == false, web
// `if (!visible) return null`) and Expired (the visible banner). Everything below is framework-free so the whole
// contract is covered by the JVM unit gate without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a hyphen
// segment is illegal in a package identifier), so the package intentionally diverges from the path — exactly as the
// sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslareauthbanner

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Canonical registry metadata for the TeslaReauthBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`TeslaReauthBanner`); [ID] is
 * the stable `viewModel` key the host binds the surface with.
 */
object TeslaReauthBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "tesla-reauth-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TeslaReauthBanner"
}

/**
 * The two app-level signals the banner reacts to — the native analogue of the web's two document CustomEvents. A
 * discrete event stream (not a polled status) so a repeated [Expired] re-shows the banner after a dismiss, exactly
 * like the web where each `teslasync:tesla-auth-expired` sets `visible = true` unconditionally.
 */
enum class TeslaReauthEvent {
    /** The Tesla grant lapsed (web `teslasync:tesla-auth-expired`) — show the banner. */
    Expired,

    /** The user re-authorized (web `teslasync:tesla-auth-recovered`) — hide the banner and replay queued mutations. */
    Recovered,
}

/**
 * The fully-resolved render state the composable paints — the native mirror of the web `if (!visible) return null`
 * decision. Pure, so the composable only resolves the localized strings + tone from it.
 *
 * @property showBanner whether the warning banner is shown; when false the surface contributes zero layout.
 */
data class TeslaReauthRender(
    val showBanner: Boolean,
) {
    /** Whether the surface is dormant — the web hidden branch (`if (!visible) return null`). */
    val dormant: Boolean get() = !showBanner

    companion object {
        /** The hidden surface — the cold-start / dismissed / recovered state (web `visible === false`). */
        val Hidden: TeslaReauthRender = TeslaReauthRender(showBanner = false)

        /** The visible warning banner — the web `visible === true` branch. */
        val Visible: TeslaReauthRender = TeslaReauthRender(showBanner = true)
    }
}

/**
 * Pure projection of the banner's visibility into the [TeslaReauthRender], plus the pure event → visibility rule the
 * ViewModel applies. Framework-free so the whole decision contract is covered by the JVM unit gate without a Compose
 * host — these per-branch functions double as the surface's state "snapshot".
 */
object TeslaReauthBannerProjection {
    /** Folds the local `visible` flag into the render state (web `if (!visible) return null`). */
    fun render(visible: Boolean): TeslaReauthRender = if (visible) TeslaReauthRender.Visible else TeslaReauthRender.Hidden

    /**
     * The visibility an [event] forces — the native mirror of the web event handlers: an [TeslaReauthEvent.Expired]
     * shows the banner (`setVisible(true)`), a [TeslaReauthEvent.Recovered] hides it (`setVisible(false)`). The
     * Recovered side effect (the mutation drain) is performed by the ViewModel, not this pure function.
     */
    fun visibilityAfter(event: TeslaReauthEvent): Boolean = event == TeslaReauthEvent.Expired
}

/**
 * The app-scoped Tesla-grant signal bus — the faithful native analogue of the web's GLOBAL `document` event target
 * plus the `web/src/lib/teslaAuthRecovery.ts` replay queue, neither of which was ported to the shared core. It is
 * deliberately self-contained (no Authentik coupling: that is the [io.teslasync.android.auth.AuthController]'s hard
 * blocker, a different concern): the surface observes [events], and the EXTERNAL producers the web also relies on —
 * a future Tesla-401 interceptor and the tesla-account reconnect screen — call [notifyExpired] / [notifyRecovered] /
 * [enqueueMutation] on the SAME process-global [global] instance. No PII ever crosses this seam; the queued
 * closures own their own payloads and their own error handling.
 */
class TeslaReauthBus {
    private val mutableEvents =
        MutableSharedFlow<TeslaReauthEvent>(
            replay = 0,
            extraBufferCapacity = EVENT_BUFFER,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

    /** The hot stream of grant signals the surface subscribes to (web `document` listeners). Never replayed. */
    val events: SharedFlow<TeslaReauthEvent> = mutableEvents.asSharedFlow()

    // Best-effort replay closures captured while the grant was down (web `queueTeslaMutation`). Thread-safe so a
    // producer on any dispatcher can enqueue while the surface drains on recovery.
    private val queue = ConcurrentLinkedQueue<suspend () -> Unit>()

    /** Signals that the Tesla grant lapsed (web `dispatchEvent('teslasync:tesla-auth-expired')`). */
    fun notifyExpired() {
        mutableEvents.tryEmit(TeslaReauthEvent.Expired)
    }

    /** Signals that the user re-authorized (web `dispatchEvent('teslasync:tesla-auth-recovered')`). */
    fun notifyRecovered() {
        mutableEvents.tryEmit(TeslaReauthEvent.Recovered)
    }

    /** Captures a command the user attempted while disconnected, to replay on recovery (web `queueTeslaMutation`). */
    fun enqueueMutation(replay: suspend () -> Unit) {
        queue.add(replay)
    }

    /**
     * Replays — best effort, in order — every mutation captured while the grant was down, then clears the queue (web
     * `drainQueuedTeslaMutations`). A throwing replay is isolated so one failure never aborts the rest; each closure
     * surfaces its own error through its normal path, exactly as the web comment notes.
     */
    suspend fun drainQueuedMutations() {
        while (true) {
            val replay = queue.poll() ?: break
            runCatching { replay() }
        }
    }

    /** The number of mutations still queued for replay — the test seam (web `_peekTeslaAuthRecoveryQueueSize`). */
    fun queuedMutationCount(): Int = queue.size

    /** Clears any queued replay closures without running them — the test reset seam (web `_resetTeslaAuthRecoveryQueue`). */
    fun resetQueue() {
        queue.clear()
    }

    companion object {
        private const val EVENT_BUFFER = 16

        /**
         * The process-global bus the production surface observes and external producers dispatch onto — the native
         * mirror of the web's single global `document` event target. Lazily built so it costs nothing until used.
         */
        val global: TeslaReauthBus by lazy { TeslaReauthBus() }
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [TeslaReauthBannerRegistration.SLUG]
 * (P1/S11) — never a vehicle id, token, or mutation payload, so a diagnostics line can never leak a user's session.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordTeslaReauthBannerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TeslaReauthBannerRegistration.SLUG))
}
