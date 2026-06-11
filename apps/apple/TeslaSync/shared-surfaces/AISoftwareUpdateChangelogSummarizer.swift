//
//  AISoftwareUpdateChangelogSummarizer.swift
//  TeslaSync — P4 shared surface · 0048 · AISoftwareUpdateChangelogSummarizer (Apple)
//
//  The Helix software-update changelog summarizer card — the SwiftUI parity of
//  web/src/components/ai/AISoftwareUpdateChangelogSummarizer.tsx. It is
//  `withAiFeature('software-update-changelog-summarizer')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/software-updates/summarize (body `{ vehicle_id }`) and renders the shared `AIFeatureCard`
//  (title "Summarize my software update history", a description, the optional "Pick a vehicle above"
//  empty hint, the Ask-Helix button labelled "Summarize updates", the "Helix" badge) feeding
//  `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `SoftwareUpdateSummarizerModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no vehicle is selected the header empty hint renders, and when on with a
//                vehicle but no summary generated the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + optional empty hint + Ask-Helix button + output panel (empty /
//                thinking / prose / error), plus the orthogonal connectivity axis (live / stale /
//                offline) driving the header freshness chip + banner with a one-shot auto-refresh on
//                the stale transition.
//

import SwiftUI

// MARK: - AISoftwareUpdateChangelogSummarizer (the shared surface)

/// The Helix software-update changelog summarizer card — the SwiftUI parity of
/// `AISoftwareUpdateChangelogSummarizer.tsx`. Renders every state from the web source plus the P4
/// leaf freshness states, binding through `SoftwareUpdateSummarizerModel`.
public struct AISoftwareUpdateChangelogSummarizer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AISoftwareUpdateChangelogSummarizer"

    @State private var model: SoftwareUpdateSummarizerModel

    public init(model: SoftwareUpdateSummarizerModel) {
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

private extension AISoftwareUpdateChangelogSummarizer {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                SoftwareUpdateSummarizerConnectivityBanner(connection: model.connection)
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
            Text(verbatim: SoftwareUpdateSummarizerStrings.string(
                "softwareUpdates.aiNarration.title",
                "Summarize my software update history"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: SoftwareUpdateSummarizerStrings.string(
                "softwareUpdates.aiNarration.title",
                "Summarize my software update history"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            SoftwareUpdateSummarizerHelixBadge(
                label: SoftwareUpdateSummarizerStrings.string(
                    "softwareUpdates.aiNarration.badge",
                    "Helix"
                )
            )
            Spacer(minLength: TSSpacing.sm)
            SoftwareUpdateSummarizerFreshnessChip(connection: model.connection)
            SoftwareUpdateSummarizerRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AISoftwareUpdateChangelogSummarizer {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            SoftwareUpdateSummarizerLoadingView()
        case let .error(message):
            SoftwareUpdateSummarizerGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                SoftwareUpdateSummarizerReadyView(ready: ready) { model.summarize() }
            }
        }
    }
}
