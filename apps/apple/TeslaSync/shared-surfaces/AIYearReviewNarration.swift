//
//  AIYearReviewNarration.swift
//  TeslaSync — P4 shared surface · 0061 · AIYearReviewNarration (Apple)
//
//  The Helix year-in-review narration card — the SwiftUI parity of
//  web/src/components/ai/AIYearReviewNarration.tsx. It is `withAiFeature('yir-narration')` in the web
//  source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/analytics/year-in-review/narrate (body `{ vehicle_id: vehicleId ?? 0, year: defaultYear }`
//  where defaultYear is the previous calendar year) and renders the shared `AIFeatureCard` (title
//  "Helix narration", a description, the Ask-Helix button, the "Helix" badge) feeding `AiOutputPanel`.
//  This surface reproduces that composition natively, bound through `YearReviewNarrationModel`
//  (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no narration has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIYearReviewNarration (the shared surface)

/// The Helix year-in-review narration card — the SwiftUI parity of `AIYearReviewNarration.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `YearReviewNarrationModel`.
public struct AIYearReviewNarration: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIYearReviewNarration"

    @State private var model: YearReviewNarrationModel

    public init(model: YearReviewNarrationModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.isGated {
                // Web `withAiFeature` off → the whole surface is withdrawn.
                EmptyView()
            } else {
                card
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension AIYearReviewNarration {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                YearReviewNarrationConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: YearReviewNarrationStrings.string(
                "yearReview.aiNarration.title",
                "Helix narration"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: YearReviewNarrationStrings.string(
                "yearReview.aiNarration.title",
                "Helix narration"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            YearReviewNarrationHelixBadge(
                label: YearReviewNarrationStrings.string("yearReview.aiNarration.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            YearReviewNarrationFreshnessChip(connection: model.connection)
            YearReviewNarrationRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIYearReviewNarration {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            YearReviewNarrationLoadingView()
        case let .error(message):
            YearReviewNarrationGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                YearReviewNarrationReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
