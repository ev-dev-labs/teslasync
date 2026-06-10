//
//  AIIncidentTimelineSummarizer.swift
//  TeslaSync — P4 shared surface · 0022 · AIIncidentTimelineSummarizer (Apple)
//
//  The Helix incident-timeline summarizer card — the SwiftUI parity of
//  web/src/components/ai/AIIncidentTimelineSummarizer.tsx. It is
//  `withAiFeature('incident-timeline-summarizer')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/system/incidents/{incidentID}/summarize (empty `{}` body) and renders the shared
//  `AIFeatureCard` (title "Helix timeline summary", a description, the Ask-Helix button, the "Helix"
//  badge) feeding `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `IncidentSummarizerModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no summary has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIIncidentTimelineSummarizer (the shared surface)

/// The Helix incident-timeline summarizer card — the SwiftUI parity of
/// `AIIncidentTimelineSummarizer.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `IncidentSummarizerModel`.
public struct AIIncidentTimelineSummarizer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIIncidentTimelineSummarizer"

    @State private var model: IncidentSummarizerModel

    public init(model: IncidentSummarizerModel) {
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

private extension AIIncidentTimelineSummarizer {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                IncidentSummarizerConnectivityBanner(connection: model.connection)
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
            Text(verbatim: IncidentSummarizerStrings.string(
                "incidentTimeline.aiSummary.title",
                "Helix timeline summary"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: IncidentSummarizerStrings.string(
                "incidentTimeline.aiSummary.title",
                "Helix timeline summary"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            IncidentSummarizerHelixBadge(
                label: IncidentSummarizerStrings.string("incidentTimeline.aiSummary.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            IncidentSummarizerFreshnessChip(connection: model.connection)
            IncidentSummarizerRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIIncidentTimelineSummarizer {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            IncidentSummarizerLoadingView()
        case let .error(message):
            IncidentSummarizerGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                IncidentSummarizerReadyView(ready: ready) { model.summarize() }
            }
        }
    }
}
