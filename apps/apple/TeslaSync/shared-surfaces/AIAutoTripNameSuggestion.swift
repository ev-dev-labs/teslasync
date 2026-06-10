//
//  AIAutoTripNameSuggestion.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  The auto trip-name suggestion surface — the SwiftUI parity of
//  `components/ai/AIAutoTripNameSuggestion.tsx`. The web component is an `AIFeatureCard` driven by
//  `useAiStream`, wrapped by `withAiFeature('auto-trip-naming', …)`: it POSTs an empty body to
//  `/ai/trips/{tripID}/name/draft` and renders the streamed, propose-only name suggestion. This
//  native surface reproduces that composition — the Helix-branded feature card (title + badge +
//  description + Ask Helix button + streaming output panel) — binding through `AITripNameModel`
//  (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • gatedOff   — web `withAiFeature` off → no AI surface renders (ADR-015 AI-Off contract).
//    • loading    — parent context resolving → skeleton card chrome.
//    • idle       — resolved, nothing requested yet → friendly idle output, never a blank box.
//    • thinking   — stream open, first delta pending → Helix thinking indicator.
//    • suggestion — streamed / final propose-only name.
//    • error      — stream failed → `QueryError` peer with retry.
//    • stale / offline — the orthogonal `connection` axis → freshness chip + one-shot auto-refresh.
//

import SwiftUI

// MARK: - AIAutoTripNameSuggestion (the shared surface)

/// The auto trip-name suggestion surface — the SwiftUI parity of
/// `components/ai/AIAutoTripNameSuggestion.tsx`. Renders every state plus the P4 leaf freshness
/// states, binding through `AITripNameModel`.
public struct AIAutoTripNameSuggestion: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AITripNameEndpoint.surfaceSlug

    @State private var model: AITripNameModel

    public init(model: AITripNameModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production context source + the real `URLSession` SSE
    /// stream driver — the parity of the web `<AIAutoTripNameSuggestion tripId={…}>` mount. `tripId`
    /// is the bound trip (web `canStart = !!tripId`); `featureEnabled` is the AI gate
    /// (web `useAiEnabled('auto-trip-naming')`).
    public init(
        tripID: String?,
        featureEnabled: Bool = true,
        baseURL: URL = LiveAITripNameStreamDriver.defaultBaseURL
    ) {
        _model = State(initialValue: AITripNameModel(
            source: LiveAITripNameSource(featureEnabled: featureEnabled, tripID: tripID),
            streamDriver: LiveAITripNameStreamDriver(baseURL: baseURL)
        ))
    }

    public var body: some View {
        ZStack {
            if case .gatedOff = model.phase {
                // Faithful `withAiFeature` / ADR-015 AI-Off parity: the gate's purpose is that no
                // AI surface leaks when the feature is off, so the surface collapses to nothing.
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
            AITripNameFeatureCard(
                resolved: model.resolved,
                onGenerate: { model.generate() },
                onCancel: { model.cancel() },
                onRetry: { model.retry() }
            )
            if model.connection != .live {
                AITripNameFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}
