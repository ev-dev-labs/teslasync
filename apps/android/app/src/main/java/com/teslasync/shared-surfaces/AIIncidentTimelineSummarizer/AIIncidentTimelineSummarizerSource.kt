// The single data port the AIIncidentTimelineSummarizer shared surface binds to — the native analogue of the
// two data hooks the web component composes (web/src/components/ai/AIIncidentTimelineSummarizer.tsx):
//   • the `withAiFeature('incident-timeline-summarizer', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/system/incidents/{incidentId}/summarize', body: {} })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores but
// no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the
// production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiIncidentTimelineSummarizerSource]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiincidenttimelinesummarizer

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIIncidentTimelineSummarizerViewModel] binds to so it depends on an abstraction (real adapter ↔
 * test fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('incident-timeline-summarizer')`); [summarize] opens the cold summarize stream (web
 * `useAiStream`). No HTTP touches the view.
 */
interface AIIncidentTimelineSummarizerSource {
    /**
     * Stream whether the `incident-timeline-summarizer` AI feature is enabled (web `useAiEnabled`). When `false`
     * the surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh summarize stream for [incidentId] — the native analogue of the web `useAiStream` POST to
     * `/ai/system/incidents/{incidentId}/summarize` with an EMPTY body (the incident id rides the URL path, not
     * the body; there is no user-supplied question). The returned cold [Flow] emits one [AiSummaryChunk] per
     * parsed SSE frame and completes when the stream closes. A terminal failure may be signalled either as a
     * terminal [AiSummaryChunk.Failed] frame or by the flow throwing (the view-model classifies a thrown failure
     * into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun summarize(incidentId: Long): Flow<AiSummaryChunk>
}

/**
 * Builds an [AIIncidentTimelineSummarizerSource] from the two flows a host wires to the shared layer:
 * [aiEnabled] from the shared S8 AI-mode gate, and [summarize] from the AI SSE client. This is the production
 * seam — re-collecting [summarize] performs a genuine new generation, which backs the surface's summarize/retry
 * affordance (the web `stream.start()`). A test fake implements [AIIncidentTimelineSummarizerSource] directly
 * instead.
 */
fun aiIncidentTimelineSummarizerSource(
    aiEnabled: () -> Flow<Boolean>,
    summarize: (incidentId: Long) -> Flow<AiSummaryChunk>,
): AIIncidentTimelineSummarizerSource =
    object : AIIncidentTimelineSummarizerSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun summarize(incidentId: Long): Flow<AiSummaryChunk> = summarize(incidentId)
    }
