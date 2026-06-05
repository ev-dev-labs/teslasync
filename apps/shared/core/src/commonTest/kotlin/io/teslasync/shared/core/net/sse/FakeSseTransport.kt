package io.teslasync.shared.core.net.sse

import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * One scripted action a [FakeSseTransport] connection performs, in order.
 */
internal sealed interface SseStep {
    /** Emit a raw text chunk (may contain partial or multiple frames). */
    data class Emit(
        val chunk: String,
    ) : SseStep

    /** Suspend for [millis] of virtual time before the next step. */
    data class Wait(
        val millis: Long,
    ) : SseStep

    /** Throw [error], simulating a transport failure (client reconnects). */
    data class Fail(
        val error: Throwable,
    ) : SseStep

    /** End the flow normally, simulating the server closing the stream (client reconnects). */
    data object Complete : SseStep

    /** Stay open until the collector cancels (simulates a live, silent connection). */
    data object Hang : SseStep
}

/** Records one [SseTransport.open] invocation for assertions. */
internal data class OpenRecord(
    val path: String,
    val lastEventId: String?,
)

/**
 * A scriptable, in-memory [SseTransport] for deterministic SSE client tests — no real
 * network, no real clock. [script] returns the steps for each connection attempt,
 * keyed by the zero-based attempt index and the resume id the client supplied.
 *
 * Tracks every [open] (for `Last-Event-ID` resume assertions) and the number of live
 * connections (for cancellation-closes-the-stream assertions).
 */
internal class FakeSseTransport(
    private val script: (attempt: Int, lastEventId: String?) -> List<SseStep>,
) : SseTransport {
    val opens: MutableList<OpenRecord> = mutableListOf()
    var activeConnections: Int = 0
        private set

    override fun open(request: SseRequest): Flow<String> {
        val attempt = opens.size
        opens.add(OpenRecord(request.path, request.lastEventId))
        val steps = script(attempt, request.lastEventId)
        return flow {
            activeConnections += 1
            try {
                for (step in steps) {
                    when (step) {
                        is SseStep.Emit -> emit(step.chunk)
                        is SseStep.Wait -> delay(step.millis)
                        is SseStep.Fail -> throw step.error
                        SseStep.Complete -> return@flow
                        SseStep.Hang -> awaitCancellation()
                    }
                }
            } finally {
                activeConnections -= 1
            }
        }
    }
}
