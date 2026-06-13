// The single data port the AIChatbotIndicator shared surface binds to — the native analogue of the visibility
// gate the web component composes (web/src/components/ai/AIChatbotIndicator.tsx). The web surface is
// `withAiFeature('chatbot-llm', InnerIndicator)`; the HOC reads `useAiEnabled('chatbot-llm')` and renders `null`
// unless it is true. This seam is that gate, narrowed to the one boolean the surface needs. The view-model
// depends on this abstraction (a real adapter over the shared AI/settings layer in production, a fake in tests),
// never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: `useAiEnabled` derives from the general settings
// document (web `useSettings`), and folding that document into the gate boolean is the host's job — it wires
// [aiChatbotIndicatorSource] from the shared S8 AI-mode + ai_features gate using [evaluateChatbotLlmGate] (the
// pure port of `useAiEnabled`), exactly as the sibling AIAnomalyExplanations surface wires its `aiEnabled` flow.
// A test fake implements [AIChatbotIndicatorSource] directly. The surface carries no other data dependency — the
// badge's strings come from the P1/S10 i18n catalog, not from this port.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces/AIChatbotIndicator) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichatbotindicator

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIChatbotIndicatorViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [featureEnabled] is the AI-feature gate (web
 * `useAiEnabled('chatbot-llm')` resolved through the `withAiFeature` HOC); when it emits `false` the surface
 * collapses to nothing, mirroring the HOC returning `null`. No HTTP touches the view.
 */
interface AIChatbotIndicatorSource {
    /**
     * Stream whether the `chatbot-llm` AI feature is enabled end-to-end (web `useAiEnabled('chatbot-llm')`). The
     * flow is fail-closed: it should emit `false` (the surface stays hidden) until settings resolve and the
     * feature is explicitly opted in, then `true`. Re-emits whenever the AI mode or the per-feature flag changes.
     */
    fun featureEnabled(): Flow<Boolean>
}

/**
 * Builds an [AIChatbotIndicatorSource] from the gate flow a host wires to the shared layer — typically derived
 * from the shared S8 AI-mode + `ai_features` gate via [evaluateChatbotLlmGate] (the pure port of the web
 * `useAiEnabled('chatbot-llm')` predicate). This is the production seam; a test fake implements
 * [AIChatbotIndicatorSource] directly instead.
 */
fun aiChatbotIndicatorSource(featureEnabled: () -> Flow<Boolean>): AIChatbotIndicatorSource =
    object : AIChatbotIndicatorSource {
        override fun featureEnabled(): Flow<Boolean> = featureEnabled()
    }
