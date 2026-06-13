// The single data port the OfflineBanner shared surface binds to — the native analogue of the web source the
// surface reflects (web/src/components/feedback/OfflineBanner.tsx: `useOnlineStatus()`, a boolean over
// `navigator.onLine` + the resilience status broadcaster). `navigator.onLine` has no literal native counterpart
// (no KMP online observer, and this surface may not add one), so the surface binds the one WIRED cross-cutting
// service-reachability signal — the app-scoped live-data pipeline (`io.teslasync.android.data.live.LiveSessionStore`,
// ADR-009, the same feed `LiveIndicator` / `ServiceStatus` bind) — through this seam. The view-model depends on
// this abstraction (a real adapter over the shared live layer in production, a fake in tests), never on a
// concrete store or the SSE client, so the view performs NO HTTP and opens no stream itself (P1/S8 boundary,
// ADR-002).
//
// The wire-health contract is preserved end to end: every emission's connection status flows through unchanged
// onto the PII-free [OfflineBannerSnapshot] — exactly the signal the surface projects into its banner. No vehicle
// id and no signal payload ever cross this seam. [reconnect] is the banner's retry affordance, forwarded to the
// live layer's own reconnect (web "New requests will retry when you reconnect").
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for
// the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.offlinebanner

import io.teslasync.android.data.live.LiveSessionStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The seam the [OfflineBannerViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store or the SSE client. [connection] is the cold, lifecycle-aware live wire-health feed;
 * the surface projects only its status, never any signals. [reconnect] forwards the banner's retry affordance to
 * the live layer. No HTTP touches the view.
 */
interface OfflineBannerSource {
    /**
     * The live pipeline's wire-health as a stream of PII-free [OfflineBannerSnapshot]s. Collecting it (via the
     * ViewModel) opens the shared gated SSE subscription; the last observer leaving closes it — the platform
     * live-layer contract (ADR-009).
     */
    fun connection(): Flow<OfflineBannerSnapshot>

    /** Forces a fresh connection now (the banner's retry affordance); a no-op while gated closed. */
    fun reconnect()
}

/**
 * Binds the surface to the app-scoped **S8** [LiveSessionStore] — the single live pipeline holder every live
 * surface shares (ADR-009), the native service-reachability source. Each session frame's connection status is
 * projected onto the PII-free [OfflineBannerSnapshot] the surface renders; the merged per-vehicle signals never
 * leave the store. [reconnect] forwards to the store's own reconnect. No HTTP touches the view.
 */
fun LiveSessionStore.asOfflineBannerSource(): OfflineBannerSource {
    val store = this
    return object : OfflineBannerSource {
        override fun connection(): Flow<OfflineBannerSnapshot> =
            store.state.map { session -> OfflineBannerSnapshot(status = session.status) }

        override fun reconnect() = store.reconnect()
    }
}

/**
 * Builds an [OfflineBannerSource] from a wire-health [feed] provider (+ an optional [onReconnect]) — the host
 * wiring seam used when a caller already has the connection flow in hand, and the test double used to drive each
 * wire state deterministically. Mirrors the contract of the store adapter above.
 */
fun offlineBannerSource(
    onReconnect: () -> Unit = {},
    feed: () -> Flow<OfflineBannerSnapshot>,
): OfflineBannerSource =
    object : OfflineBannerSource {
        override fun connection(): Flow<OfflineBannerSnapshot> = feed()

        override fun reconnect() = onReconnect()
    }
