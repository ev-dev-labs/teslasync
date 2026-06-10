//
//  AITripPostcardShareCardImageGeneration.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  The trip postcard / share-card image-prompt drafter — the SwiftUI parity of
//  `components/ai/AITripPostcardShareCardImageGeneration.tsx`. The web component is an `AIFeatureCard`
//  driven by `useAiStream`, wrapped by `withAiFeature('trip-postcard-share-card-image-generation',
//  …)`: it POSTs a `{ trip_id, style_hint? }` body to `/ai/share-cards/trip-image/draft` and renders
//  the streamed, propose-only image prompt + preview spec. This native surface reproduces that
//  composition — the Helix-branded feature card (title + badge + description + Ask Helix button +
//  streaming output panel) — binding through `AIPostcardModel` (P1/S8); no networking lives in the
//  view. Helix drafts only; the existing per-trip Share workflow remains the publishing path.
//
//  States (every one renders — no hidden surface):
//    • gatedOff   — web `withAiFeature` off → no AI surface renders (ADR-015 AI-Off contract).
//    • loading    — parent context resolving → skeleton card chrome.
//    • idle       — resolved, nothing requested yet → friendly idle output, never a blank box.
//    • thinking   — stream open, first delta pending → Helix thinking indicator.
//    • draft      — streamed / final propose-only share-card draft.
//    • error      — stream failed → `QueryError` peer with retry.
//    • stale / offline — the orthogonal `connection` axis → freshness chip + one-shot auto-refresh.
//

import SwiftUI

// MARK: - AITripPostcardShareCardImageGeneration (the shared surface)

/// The trip postcard / share-card image-prompt drafter — the SwiftUI parity of
/// `components/ai/AITripPostcardShareCardImageGeneration.tsx`. Renders every state plus the P4 leaf
/// freshness states, binding through `AIPostcardModel`.
public struct AITripPostcardShareCardImageGeneration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AIPostcardEndpoint.surfaceSlug

    @State private var model: AIPostcardModel

    public init(model: AIPostcardModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production context source + the real `URLSession` SSE stream
    /// driver — the parity of the web `<AITripPostcardShareCardImageGeneration tripId={…}
    /// styleHint={…}>` mount. `tripID` is the selected trip (web `canStart = numericTripId > 0`);
    /// `styleHint` is the optional style stance; `featureEnabled` is the AI gate (web
    /// `useAiEnabled('trip-postcard-share-card-image-generation')`).
    public init(
        tripID: Int?,
        styleHint: String? = nil,
        featureEnabled: Bool = true,
        baseURL: URL = LiveAIPostcardStreamDriver.defaultBaseURL
    ) {
        _model = State(initialValue: AIPostcardModel(
            source: LiveAIPostcardSource(
                featureEnabled: featureEnabled,
                tripID: tripID,
                styleHint: styleHint
            ),
            streamDriver: LiveAIPostcardStreamDriver(baseURL: baseURL)
        ))
    }

    public var body: some View {
        ZStack {
            if case .gatedOff = model.phase {
                // Faithful `withAiFeature` / ADR-015 AI-Off parity: the gate's purpose is that no AI
                // surface leaks when the feature is off, so the surface collapses to nothing.
                EmptyView()
            } else {
                content
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AIPostcardFeatureCard(
                resolved: model.resolved,
                onGenerate: { model.generate() },
                onCancel: { model.cancel() },
                onRetry: { model.retry() }
            )
            if model.connection != .live {
                AIPostcardFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
