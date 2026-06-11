//
//  AIAlertTuningSuggestions.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The Helix alert-tuning card — the SwiftUI parity of
//  web/src/components/ai/AIAlertTuningSuggestions.tsx. It is
//  `withAiFeature('alert-tuning-suggestions')` in the web source (a `useAiEnabled` gate; disabled ⇒
//  the HOC renders `null`); the InnerSection streams from POST /ai/alerts/rules/{ruleId}/tune/draft
//  and renders the shared `AIFeatureCard` (title "Suggest lower-noise tuning", a description, the
//  Suggest button, the "Helix" badge) feeding `AiOutputPanel`, plus a captured-proposal block (the
//  "Apply to form" button + the "Proposed patch" preview). This surface reproduces that composition
//  natively, bound through `AlertTuningSuggestionsModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no patch has been proposed, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Suggest button + (captured proposal + Apply button) + output panel
//                (empty / thinking / prose / error), plus the orthogonal connectivity axis (live /
//                stale / offline) driving the header freshness chip + banner with a one-shot
//                auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIAlertTuningSuggestions (the shared surface)

/// The Helix alert-tuning card — the SwiftUI parity of `AIAlertTuningSuggestions.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `AlertTuningSuggestionsModel`.
public struct AIAlertTuningSuggestions: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIAlertTuningSuggestions"

    @State private var model: AlertTuningSuggestionsModel

    public init(model: AlertTuningSuggestionsModel) {
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

private extension AIAlertTuningSuggestions {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                AlertTuningConnectivityBanner(connection: model.connection)
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
            Text(verbatim: AlertTuningStrings.string(
                "notifications.alertStudio.aiTuning.title",
                "Suggest lower-noise tuning"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: AlertTuningStrings.string(
                "notifications.alertStudio.aiTuning.title",
                "Suggest lower-noise tuning"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            AlertTuningHelixBadge(
                label: AlertTuningStrings.string("notifications.alertStudio.aiTuning.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            AlertTuningFreshnessChip(connection: model.connection)
            AlertTuningRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIAlertTuningSuggestions {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            AlertTuningLoadingView()
        case let .error(message):
            AlertTuningGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                AlertTuningReadyView(
                    ready: ready,
                    onSuggest: { model.suggest() },
                    onApply: { model.apply() }
                )
            }
        }
    }
}
