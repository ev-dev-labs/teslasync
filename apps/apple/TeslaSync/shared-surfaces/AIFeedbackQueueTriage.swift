//
//  AIFeedbackQueueTriage.swift
//  TeslaSync — P4 shared surface · 0019 · AIFeedbackQueueTriage (Apple)
//
//  The Helix feedback-queue triage advisor — the SwiftUI parity of
//  web/src/components/ai/AIFeedbackQueueTriage.tsx. It is `withAiFeature('feedback-queue-triage')` in
//  the web source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection
//  streams from POST /ai/feedback/triage/draft (`{ feedback_id: haveFeedback ? feedbackId : 0 }`) and
//  renders the shared `AIFeatureCard` (title "Helix triage advisor", a redacted-envelope description,
//  the Ask-Helix button, the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that
//  composition natively, bound through `FeedbackTriageModel` (P1/S8); no networking lives here.
//
//  Propose-only: the web source references `useUpdateFeedback` ONLY in comments to state that the
//  advisor never calls the feedback mutation — the operator's manual triage controls remain the sole
//  write path. The native surface preserves that contract (it binds the stream + i18n, never mutates).
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no proposal has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIFeedbackQueueTriage (the shared surface)

/// The Helix feedback-queue triage advisor — the SwiftUI parity of `AIFeedbackQueueTriage.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `FeedbackTriageModel`.
public struct AIFeedbackQueueTriage: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIFeedbackQueueTriage"

    @State private var model: FeedbackTriageModel

    public init(model: FeedbackTriageModel) {
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

private extension AIFeedbackQueueTriage {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                FeedbackTriageConnectivityBanner(connection: model.connection)
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
            Text(verbatim: FeedbackTriageStrings.string(
                "feedbackTriage.aiAdvisor.title",
                "Helix triage advisor"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: FeedbackTriageStrings.string(
                "feedbackTriage.aiAdvisor.title",
                "Helix triage advisor"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            FeedbackTriageHelixBadge(
                label: FeedbackTriageStrings.string("feedbackTriage.aiAdvisor.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            FeedbackTriageFreshnessChip(connection: model.connection)
            FeedbackTriageRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIFeedbackQueueTriage {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            FeedbackTriageLoadingView()
        case let .error(message):
            FeedbackTriageGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                FeedbackTriageReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
