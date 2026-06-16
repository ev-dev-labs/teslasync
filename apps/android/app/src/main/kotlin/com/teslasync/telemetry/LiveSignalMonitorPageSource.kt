// The data seam the LiveSignalMonitorPage surface binds to, plus its production binding over the app-scoped
// shared live pipeline. The view (composable) performs NO HTTP — it only collects connection state from the
// view-model, which drives this seam, reproducing the web page's `useLiveSignalStream` connection slice
// (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx → web/src/features/telemetry/hooks/
// useLiveSignalStream.ts). The live tail's own firehose is owned by the sibling `LiveSignalTail` feature view,
// which binds the same shared `LiveSessionStore`; this seam exposes only the page-header connection flag so the
// single SSE stream (ADR-009) is never opened twice.
//
// `MatchingDeclarationName` is suppressed for the co-located production binding helper. `InvalidPackageDeclaration`
// is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from the `io.teslasync.android.*`
// package the rest of the app uses.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.livesignalmonitor

import io.teslasync.android.data.live.LiveSessionStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The single seam the [LiveSignalMonitorPageViewModel] depends on so it binds to an abstraction (the shared
 * app-scoped live pipeline in production, a fake in tests), never to a concrete store or the network. The one
 * read is the live wire's connection slice (the web `useLiveSignalStream` `connected`); [reconnect] backs the
 * stale/offline retry, forwarding to the shared stream so a stuck wire reopens with a refreshed credential.
 */
interface LiveSignalMonitorPageSource {
    /** The shared live pipeline's connection slice (web `useLiveSignalStream` over the single SSE stream). */
    fun connection(): Flow<LiveMonitorConnection>

    /** Forces a fresh connection (the page's stale/offline retry); forwards to the shared stream. */
    fun reconnect()
}

/**
 * Binds the surface to the shared **S8** app-scoped [LiveSessionStore] — the single SSE stream (ADR-009) every
 * live surface observes. Collecting the feed opens the gated subscription (foreground + auth + observed);
 * [reconnect] forwards to the store. The live values flow through unchanged so the view-model renders the wire
 * health honestly (Connected / Reconnecting / Disconnected / Unknown + the stale tier). No HTTP touches the view.
 */
fun liveSignalMonitorPageSource(store: LiveSessionStore): LiveSignalMonitorPageSource =
    object : LiveSignalMonitorPageSource {
        override fun connection(): Flow<LiveMonitorConnection> =
            store.state.map { session ->
                LiveMonitorConnection(
                    status = session.status,
                    isStale = session.isStale,
                    lastMessageAtMillis = session.lastMessageAtMillis,
                )
            }

        override fun reconnect() = store.reconnect()
    }
