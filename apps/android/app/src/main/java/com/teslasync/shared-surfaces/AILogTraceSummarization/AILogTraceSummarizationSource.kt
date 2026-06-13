// The single data port the AILogTraceSummarization shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AILogTraceSummarization.tsx):
//   • the `withAiFeature('log-trace-summarization', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/system/logs/summarize', body: { from_unix, to_unix, vehicle_id? } })`, the SSE
//     consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiLogTraceSummarizationSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailogtracesummarization

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AILogTraceSummarizationViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('log-trace-summarization')`); [summarize] opens the cold summarize stream (web `useAiStream`).
 * No HTTP touches the view.
 */
interface AILogTraceSummarizationSource {
    /**
     * Stream whether the `log-trace-summarization` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh summarize stream for the log/trace window [[fromUnix], [toUnix]] (Unix seconds), optionally
     * narrowed to [vehicleId] — the native analogue of the web `useAiStream` POST to `/ai/system/logs/summarize`
     * with `{ from_unix, to_unix, vehicle_id? }`. A `null` [vehicleId] omits the field so the backend treats it
     * as "all vehicles". The returned cold [Flow] emits one [AiSummaryChunk] per parsed SSE frame and completes
     * when the stream closes. A terminal failure may be signalled either as a terminal [AiSummaryChunk.Failed]
     * frame or by the flow throwing (the view-model classifies a thrown failure into the same
     * [io.teslasync.android.data.ErrorKind]).
     */
    fun summarize(
        fromUnix: Long,
        toUnix: Long,
        vehicleId: Long?,
    ): Flow<AiSummaryChunk>
}

/**
 * Builds an [AILogTraceSummarizationSource] from the two flows a host wires to the shared layer: [aiEnabled]
 * from the shared S8 AI-mode gate, and [summarize] from the AI SSE client. This is the production seam — re-
 * collecting [summarize] performs a genuine new summarization, which backs the surface's summarize/retry
 * affordance (the web `stream.start()`). A test fake implements [AILogTraceSummarizationSource] directly
 * instead.
 */
fun aiLogTraceSummarizationSource(
    aiEnabled: () -> Flow<Boolean>,
    summarize: (fromUnix: Long, toUnix: Long, vehicleId: Long?) -> Flow<AiSummaryChunk>,
): AILogTraceSummarizationSource =
    object : AILogTraceSummarizationSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun summarize(
            fromUnix: Long,
            toUnix: Long,
            vehicleId: Long?,
        ): Flow<AiSummaryChunk> = summarize(fromUnix, toUnix, vehicleId)
    }
