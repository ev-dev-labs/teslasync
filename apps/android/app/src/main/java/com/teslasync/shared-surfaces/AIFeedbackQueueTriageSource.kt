// The single data port the AIFeedbackQueueTriage shared surface binds to — the native analogue of the two
// data hooks the web component composes (web/src/components/ai/AIFeedbackQueueTriage.tsx):
//   • the `withAiFeature('feedback-queue-triage', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/feedback/triage/draft', body: { feedback_id } })`, the SSE consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here the way AnomalyInlineRowSource binds VehiclesStore /
// AnomaliesStore: the shared core ships AI-settings + AI-usage stores but no AI *streaming* store yet (the
// streaming atoms are the out-of-scope P3 component-library bundle), so the production adapter is wired by the
// host from the shared S8 AI-mode gate and the SSE client via [aiFeedbackQueueTriageSource]. A test fake stands
// in for the whole domain.
//
// The advisor is propose-only (web safety contract): this port never exposes a mutation. The deterministic
// manual triage write path (useUpdateFeedback) stays entirely on the parent FeedbackQueuePage and is out of
// this surface's scope — the draft stream is informational input to the operator, never a write.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeedbackqueuetriage

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIFeedbackQueueTriageViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('feedback-queue-triage')`); [draftTriage] opens the cold draft stream (web `useAiStream`). No
 * HTTP touches the view.
 */
interface AIFeedbackQueueTriageSource {
    /**
     * Stream whether the `feedback-queue-triage` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh draft stream for [feedbackId] — the native analogue of the web `useAiStream` POST to
     * `/ai/feedback/triage/draft` with the in-scope `{feedback_id}` body (the redacted envelope is assembled
     * server-side from that id alone, so the LLM cannot widen its scope). The returned cold [Flow] emits one
     * [AiStreamChunk] per parsed SSE frame and completes when the stream closes. A terminal failure may be
     * signalled either as a terminal [AiStreamChunk.Failed] frame or by the flow throwing (the view-model
     * classifies a thrown failure into the same [io.teslasync.android.data.ErrorKind]).
     */
    fun draftTriage(feedbackId: Long): Flow<AiStreamChunk>
}

/**
 * Builds an [AIFeedbackQueueTriageSource] from the two flows a host wires to the shared layer: [aiEnabled] from
 * the shared S8 AI-mode gate, and [draftTriage] from the AI SSE client. This is the production seam — re-
 * collecting [draftTriage] performs a genuine new draft, which backs the surface's suggest/retry affordance
 * (the web `stream.start()`). A test fake implements [AIFeedbackQueueTriageSource] directly instead.
 */
fun aiFeedbackQueueTriageSource(
    aiEnabled: () -> Flow<Boolean>,
    draftTriage: (feedbackId: Long) -> Flow<AiStreamChunk>,
): AIFeedbackQueueTriageSource =
    object : AIFeedbackQueueTriageSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun draftTriage(feedbackId: Long): Flow<AiStreamChunk> = draftTriage(feedbackId)
    }
