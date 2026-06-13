// The single data port the TeslaReauthBanner shared surface binds to — the native analogue of the app-global signals
// behind web/src/components/feedback/TeslaReauthBanner.tsx (the two `document` CustomEvents + `drainQueuedTeslaMutations`).
// The view-model depends on THIS abstraction (a real adapter over the process-global [TeslaReauthBus] in production, a
// fake in tests), never on a concrete bus, so the view performs NO HTTP and opens no stream itself (P1/S8 boundary,
// ADR-002). [events] is the hot grant-signal stream the surface observes; [drainQueuedMutations] is the recovery
// replay the surface fires when it consumes a [TeslaReauthEvent.Recovered] (web `drainQueuedTeslaMutations`). No
// vehicle id, token, or mutation payload ever crosses this seam.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the
// co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslareauthbanner

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [TeslaReauthBannerViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete bus. [events] is the hot stream of grant signals (web `document` listeners);
 * [drainQueuedMutations] forwards the banner's recovery replay to the queued-mutation layer (web
 * `drainQueuedTeslaMutations`). No HTTP touches the view.
 */
interface TeslaReauthBannerSource {
    /**
     * The Tesla-grant signals as a hot stream of [TeslaReauthEvent]s (web `teslasync:tesla-auth-expired` /
     * `teslasync:tesla-auth-recovered`). Collected by the ViewModel for the surface's lifetime.
     */
    fun events(): Flow<TeslaReauthEvent>

    /**
     * Replays — best effort — the mutations captured while the grant was down, then clears them. Fired by the
     * ViewModel when it consumes a [TeslaReauthEvent.Recovered] (web `drainQueuedTeslaMutations`).
     */
    suspend fun drainQueuedMutations()
}

/**
 * Binds the surface to a [TeslaReauthBus] — the app-scoped Tesla-grant signal bus every producer shares. Each bus
 * event flows through unchanged onto the surface, and the banner's recovery replay forwards to the bus's own queue
 * drain. Production passes [TeslaReauthBus.global]; no HTTP touches the view.
 */
fun TeslaReauthBus.asTeslaReauthBannerSource(): TeslaReauthBannerSource {
    val bus = this
    return object : TeslaReauthBannerSource {
        override fun events(): Flow<TeslaReauthEvent> = bus.events

        override suspend fun drainQueuedMutations() = bus.drainQueuedMutations()
    }
}

/**
 * Builds a [TeslaReauthBannerSource] from an [events] provider (+ an optional [onDrain]) — the host wiring seam used
 * when a caller already holds the signal flow, and the test double used to drive each event deterministically.
 * Mirrors the contract of the bus adapter above.
 */
fun teslaReauthBannerSource(
    onDrain: suspend () -> Unit = {},
    events: () -> Flow<TeslaReauthEvent>,
): TeslaReauthBannerSource =
    object : TeslaReauthBannerSource {
        override fun events(): Flow<TeslaReauthEvent> = events()

        override suspend fun drainQueuedMutations() = onDrain()
    }
