// The data seam the LiveLogsPage admin surface binds to, plus its production binding over the shared SSE
// transport. The view (composable) performs NO HTTP and frames NO SSE itself — it collects state from the
// view-model, which drives this seam, reproducing the web page's single `useLogStream` subscription
// (web/src/api/hooks/useLogStream.ts ▸ GET /admin/logs/stream).
//
// The live framing + rolling-buffer rules already live in the shared KMP holder
// (io.teslasync.shared.core.presentation.logstream.LogStreamStore — the cross-platform `useLogStream` port).
// This seam is the narrow indirection so the view-model depends on an abstraction (the real Ktor-backed
// transport ↔ a scripted test fake), never on a concrete transport or the network. [logStream] mints ONE
// holder per (level, grep) bound to the caller's [CoroutineScope]; the view-model (re)mints it when those
// server-side filters change — exactly the web hook's effect-restart on `level`/`grep`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.livelogs

import io.teslasync.shared.core.net.sse.SseTransport
import io.teslasync.shared.core.presentation.logstream.LogStreamLevel
import io.teslasync.shared.core.presentation.logstream.LogStreamStore
import kotlinx.coroutines.CoroutineScope

/**
 * The single seam the [LiveLogsPageViewModel] depends on so it binds to an abstraction (the shared SSE
 * transport in production, a scripted fake in tests), never to concrete networking. [logStream] returns a
 * fresh [LogStreamStore] — the shared `useLogStream` port — for the given server-side [level] + [grep],
 * bound to [scope] so the view-model tears the subscription down by cancelling that scope.
 */
fun interface LiveLogsSource {
    /** Mints a live log-tail holder for the [level] + [grep] filters, streaming on [scope]. */
    fun logStream(
        level: LogStreamLevel,
        grep: String,
        scope: CoroutineScope,
    ): LogStreamStore
}

/**
 * Binds the surface to the shared **S6** [SseTransport] — the same authenticated Ktor transport the app's
 * live `/events` pipe streams through (built once in the auth/networking graph and exposed on the data
 * container). Each [LiveLogsSource.logStream] constructs a [LogStreamStore] over it for the
 * `/admin/logs/stream` path; reusing the one transport keeps the bearer + 401-refresh wiring centralised. No
 * HTTP touches the view.
 *
 * @param nowMillis client clock stamped onto each event's `receivedAt`; injectable for deterministic tests.
 */
fun SseTransport.asLiveLogsSource(nowMillis: () -> Long = { System.currentTimeMillis() }): LiveLogsSource {
    val transport = this
    return LiveLogsSource { level, grep, scope ->
        LogStreamStore(
            transport = transport,
            scope = scope,
            level = level,
            grep = grep,
            nowMillis = nowMillis,
        )
    }
}
