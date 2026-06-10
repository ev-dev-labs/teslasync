//
//  AILogTraceSummarization.swift
//  TeslaSync — P4 shared surface · 0026 · AILogTraceSummarization (Apple)
//
//  The Helix log/trace summarization card — the SwiftUI parity of
//  web/src/components/ai/AILogTraceSummarization.tsx. It is
//  `withAiFeature('log-trace-summarization')` in the web source (a `useAiEnabled` gate; disabled ⇒
//  the HOC renders `null`); the InnerSection streams from POST /ai/system/logs/summarize (the body
//  carries the in-scope window so the LLM cannot widen it) and renders the shared `AIFeatureCard`
//  (title "Helix log/trace summary", a description, the Ask-Helix button, the "Helix" badge) feeding
//  `AiOutputPanel`. This surface reproduces that composition natively, bound through
//  `LogTraceSummaryModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no summary has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale transition.
//
//  The card never replaces the deterministic live-log stream rendered by the LiveLogs surface; like
//  the web source it adds an opt-in, read-only summary section alongside the canonical log tail.
//

import SwiftUI

// MARK: - AILogTraceSummarization (the shared surface)

/// The Helix log/trace summarization card — the SwiftUI parity of `AILogTraceSummarization.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `LogTraceSummaryModel`.
public struct AILogTraceSummarization: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AILogTraceSummarization"

    @State private var model: LogTraceSummaryModel

    public init(model: LogTraceSummaryModel) {
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

private extension AILogTraceSummarization {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                LogTraceSummaryConnectivityBanner(connection: model.connection)
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
            Text(verbatim: LogTraceSummaryStrings.string(
                "liveLogs.aiSummary.title",
                "Helix log/trace summary"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: LogTraceSummaryStrings.string(
                "liveLogs.aiSummary.title",
                "Helix log/trace summary"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            LogTraceSummaryHelixBadge(
                label: LogTraceSummaryStrings.string("liveLogs.aiSummary.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            LogTraceSummaryFreshnessChip(connection: model.connection)
            LogTraceSummaryRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AILogTraceSummarization {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            LogTraceSummaryLoadingView()
        case let .error(message):
            LogTraceSummaryGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                LogTraceSummaryReadyView(ready: ready) { model.summarize() }
            }
        }
    }
}
