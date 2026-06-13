// The single data port the LiveStaleDataBanner shared surface binds to — the native analogue of the web
// `useLiveConnection` hook the banner watches. The web `LiveStaleDataBanner` reads the app-global live-data
// pipeline; this surface binds the Android counterpart, the app-scoped
// `io.teslasync.android.data.live.LiveSessionStore` (ADR-009), through this seam. The view-model depends on this
// abstraction (a real adapter over the shared live layer in production, a fake in tests), never on a concrete
// store or the SSE client, so the view performs NO HTTP and opens no stream itself (P1/S8 boundary, ADR-002).
//
// Only the wire-health status crosses this seam — the single signal the web banner reacts to. No vehicle id and
// no signal payload are ever projected here, so a stale-data warning can never leak which session it annotates.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/LiveStaleDataBanner) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livestaledatabanner

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.live.LiveSessionStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The seam the [LiveStaleDataBannerViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store or the SSE client. [status] is the cold, lifecycle-aware live wire-health feed
 * (web `useLiveConnection().status`); the banner reacts only to its `disconnected` runs, never to any signals. No
 * HTTP touches the view.
 */
fun interface LiveStaleDataBannerSource {
    /**
     * The live pipeline's wire health as a stream of PII-free [LiveConnectionStatus]es. Collecting it (via the
     * ViewModel) opens the shared gated SSE subscription; the last observer leaving closes it — the platform
     * live-layer contract (ADR-009).
     */
    fun status(): Flow<LiveConnectionStatus>
}

/**
 * Binds the surface to the app-scoped **S8** [LiveSessionStore] — the single live pipeline holder every live
 * surface shares (ADR-009), the Android `useLiveConnection` port. Each session frame's wire-health status is
 * projected onto the PII-free [LiveConnectionStatus] the banner folds; the merged per-vehicle signals never leave
 * the store. No HTTP touches the view.
 */
fun LiveSessionStore.asLiveStaleDataBannerSource(): LiveStaleDataBannerSource {
    val store = this
    return LiveStaleDataBannerSource { store.state.map { it.status } }
}

/**
 * Builds a [LiveStaleDataBannerSource] from a single wire-health feed provider — the host wiring seam used when a
 * caller already has the status flow in hand (and the test double used to drive each wire state deterministically).
 * Mirrors the contract of the store adapter above.
 */
fun liveStaleDataBannerSource(status: () -> Flow<LiveConnectionStatus>): LiveStaleDataBannerSource = LiveStaleDataBannerSource { status() }
