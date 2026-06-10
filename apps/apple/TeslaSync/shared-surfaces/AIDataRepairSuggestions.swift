//
//  AIDataRepairSuggestions.swift
//  TeslaSync — P4 shared surface · 0015 · AIDataRepairSuggestions (Apple)
//
//  The Helix data-repair-suggestions card — the SwiftUI parity of
//  web/src/components/ai/AIDataRepairSuggestions.tsx. It is
//  `withAiFeature('data-repair-suggestions')` in the web source (a `useAiEnabled` gate; disabled ⇒
//  the HOC renders `null`); the InnerSection streams from POST /ai/system/data-repair/draft (body
//  `{}` — the backend loads the in-scope stale-session inventory itself) and renders the shared
//  `AIFeatureCard` (title "Helix repair suggestions", a propose-only description, the Ask-Helix
//  button "Draft repair plan", the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces
//  that composition natively, bound through `DataRepairSuggestionsModel` (P1/S8); no networking
//  lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no plan has been drafted, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//
//  AI-safety alignment with the web source: the LLM is propose-only (I8) — the drafted plan renders
//  here and the user applies it via the canonical Save / Close / Discard button on the baseline
//  form below; this section never replaces the deterministic stale-session list (I3); and the
//  `withAiFeature` gate withdraws the whole surface in off mode (I5).
//

import SwiftUI

// MARK: - AIDataRepairSuggestions (the shared surface)

/// The Helix data-repair-suggestions card — the SwiftUI parity of `AIDataRepairSuggestions.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `DataRepairSuggestionsModel`.
public struct AIDataRepairSuggestions: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIDataRepairSuggestions"

    @State private var model: DataRepairSuggestionsModel

    public init(model: DataRepairSuggestionsModel) {
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

private extension AIDataRepairSuggestions {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                DataRepairConnectivityBanner(connection: model.connection)
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
            Text(verbatim: DataRepairSuggestionsStrings.string(
                "dataRepair.aiSuggestions.title",
                "Helix repair suggestions"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: DataRepairSuggestionsStrings.string(
                "dataRepair.aiSuggestions.title",
                "Helix repair suggestions"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            DataRepairHelixBadge(
                label: DataRepairSuggestionsStrings.string("dataRepair.aiSuggestions.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            DataRepairFreshnessChip(connection: model.connection)
            DataRepairRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIDataRepairSuggestions {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            DataRepairLoadingView()
        case let .error(message):
            DataRepairGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                DataRepairReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
