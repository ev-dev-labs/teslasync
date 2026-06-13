// The single data port the withAiFeature shared surface binds to — the native analogue of the visibility gate
// the web higher-order component composes (web/src/components/ai/withAiFeature.tsx). The web wrapper reads
// `useAiEnabled(feature)` and renders `null` unless it is true; this seam is that gate, narrowed to the one
// boolean the surface needs, parameterised by the bound feature id. The view-model depends on this abstraction
// (a real adapter over the shared AI/settings layer in production, a fake in tests), never on a concrete store
// or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: `useAiEnabled` derives from the general settings
// document (web `useSettings`), and folding that document into the gate boolean is the host's job — it wires
// [withAiFeatureSource] from the shared S8 AI-mode + `ai_features` gate using [evaluateAiEnabled] (the pure port
// of `useAiEnabled`), exactly as the sibling AIChatbotIndicator / AINLSearch surfaces wire their gate. A test
// fake implements [WithAiFeatureSource] directly. The surface carries no other data dependency — the inner
// content is supplied by the caller, not by this port.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/withAiFeature) cannot form a valid Kotlin package; `ktlint:standard:filename`
// and `MatchingDeclarationName` are suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.withaifeature

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [WithAiFeatureViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled(feature)` resolved through the `withAiFeature` HOC); when it emits `false` the surface collapses
 * to nothing, mirroring the HOC returning `null`. No HTTP touches the view.
 */
interface WithAiFeatureSource {
    /**
     * Stream whether [feature] is enabled end-to-end (web `useAiEnabled(feature)`). The flow is fail-closed: it
     * should emit `false` (the surface stays hidden) until settings resolve and the feature is explicitly opted
     * in, then `true`. Re-emits whenever the AI mode or the per-feature flag changes.
     */
    fun aiEnabled(feature: String): Flow<Boolean>
}

/**
 * Builds a [WithAiFeatureSource] from the per-feature gate flow a host wires to the shared layer — typically
 * derived from the shared S8 AI-mode + `ai_features` gate via [evaluateAiEnabled] (the pure port of the web
 * `useAiEnabled(feature)` predicate). This is the production seam; a test fake implements [WithAiFeatureSource]
 * directly instead.
 */
fun withAiFeatureSource(aiEnabled: (String) -> Flow<Boolean>): WithAiFeatureSource =
    object : WithAiFeatureSource {
        override fun aiEnabled(feature: String): Flow<Boolean> = aiEnabled(feature)
    }
