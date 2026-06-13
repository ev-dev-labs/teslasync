// The single data port the AIVehiclePaintPreview shared surface binds to — the native analogue of the two data
// hooks the web component composes (web/src/components/ai/AIVehiclePaintPreview.tsx):
//   • the `withAiFeature('vehicle-paint-preview', …)` gate, which reads `useAiEnabled(feature)`, and
//   • `useAiStream({ url: '/ai/vehicles/{vehicleID}/paint-preview/draft', body: { style_hint? } })`, the SSE
//     consumer.
// The view-model depends on this abstraction (a real adapter over the shared AI layer in production, a fake in
// tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// There is deliberately no concrete store binding here: the shared core ships AI-settings + AI-usage stores
// but no AI *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so
// the production adapter is wired by the host from the shared S8 AI-mode gate and the SSE client via
// [aiVehiclePaintPreviewSource] — building the request URL from [paintPreviewDraftPath] and the body from
// [paintPreviewRequestBody]. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivehiclepaintpreview

import kotlinx.coroutines.flow.Flow

/**
 * The seam the [AIVehiclePaintPreviewViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('vehicle-paint-preview')`); [draft] opens the cold draft stream (web `useAiStream`). No HTTP
 * touches the view.
 */
interface AIVehiclePaintPreviewSource {
    /**
     * Stream whether the `vehicle-paint-preview` AI feature is enabled (web `useAiEnabled`). When `false` the
     * surface collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Open a fresh draft stream for [vehicleId] with the optional [styleHint] — the native analogue of the web
     * `useAiStream` POST to `/ai/vehicles/{vehicleID}/paint-preview/draft` (vehicle id in the URL path) with an
     * optional `{ style_hint }` body. The view-model resolves the hint via [normalizeStyleHint] (trimmed,
     * clamped to [PAINT_PREVIEW_STYLE_HINT_MAX_CHARS], `null` when blank) before calling this, so a `null`
     * [styleHint] means the request body omits the field entirely — exactly as the web omits the key. The host
     * adapter builds the path via [paintPreviewDraftPath] and the body via [paintPreviewRequestBody].
     *
     * The returned cold [Flow] emits one [PaintPreviewChunk] per parsed SSE frame and completes when the stream
     * closes. A terminal failure may be signalled either as a terminal [PaintPreviewChunk.Failed] frame or by
     * the flow throwing (the view-model classifies a thrown failure into the same
     * [io.teslasync.android.data.ErrorKind]).
     */
    fun draft(
        vehicleId: Long,
        styleHint: String?,
    ): Flow<PaintPreviewChunk>
}

/**
 * Builds an [AIVehiclePaintPreviewSource] from the two flows a host wires to the shared layer: [aiEnabled] from
 * the shared S8 AI-mode gate, and [draft] from the AI SSE client. This is the production seam — re-collecting
 * [draft] performs a genuine new draft run, which backs the surface's preview/retry affordance (the web
 * `stream.start()`). A test fake implements [AIVehiclePaintPreviewSource] directly instead.
 */
fun aiVehiclePaintPreviewSource(
    aiEnabled: () -> Flow<Boolean>,
    draft: (vehicleId: Long, styleHint: String?) -> Flow<PaintPreviewChunk>,
): AIVehiclePaintPreviewSource =
    object : AIVehiclePaintPreviewSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun draft(
            vehicleId: Long,
            styleHint: String?,
        ): Flow<PaintPreviewChunk> = draft(vehicleId, styleHint)
    }
