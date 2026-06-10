//
//  AIMqttSseInspectorExplanations.swift
//  TeslaSync — P4 shared surface · 0028 · AIMqttSseInspectorExplanations (Apple)
//
//  The Helix MQTT/SSE inspector explainer card — the SwiftUI parity of
//  web/src/components/ai/AIMqttSseInspectorExplanations.tsx. It is
//  `withAiFeature('mqtt-sse-inspector-explanations')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from
//  POST /ai/system/streams/explain (a `{from_unix, to_unix}` window body) and renders the shared
//  `AIFeatureCard` (title "Helix stream explainer", a description, the Explain-streams button, the
//  "Helix" badge, and the `emptyHint` shown when no valid window is in scope) feeding `AiOutputPanel`.
//  This surface reproduces that composition natively, bound through `MqttSseExplainerModel` (P1/S8);
//  no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no explanation has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + the header window hint (when no valid window) + Explain-streams
//                button + output panel (empty / no-window / thinking / prose / error), plus the
//                orthogonal connectivity axis (live / stale / offline) driving the header freshness
//                chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIMqttSseInspectorExplanations (the shared surface)

/// The Helix MQTT/SSE inspector explainer card — the SwiftUI parity of
/// `AIMqttSseInspectorExplanations.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `MqttSseExplainerModel`.
public struct AIMqttSseInspectorExplanations: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIMqttSseInspectorExplanations"

    @State private var model: MqttSseExplainerModel

    public init(model: MqttSseExplainerModel) {
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

private extension AIMqttSseInspectorExplanations {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                MqttSseExplainerConnectivityBanner(connection: model.connection)
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
            Text(verbatim: MqttSseExplainerStrings.string(
                "mqttSseInspector.aiExplainer.title",
                "Helix stream explainer"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: MqttSseExplainerStrings.string(
                "mqttSseInspector.aiExplainer.title",
                "Helix stream explainer"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            MqttSseExplainerHelixBadge(
                label: MqttSseExplainerStrings.string("mqttSseInspector.aiExplainer.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            MqttSseExplainerFreshnessChip(connection: model.connection)
            MqttSseExplainerRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIMqttSseInspectorExplanations {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            MqttSseExplainerLoadingView()
        case let .error(message):
            MqttSseExplainerGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                MqttSseExplainerReadyView(ready: ready) { model.explain() }
            }
        }
    }
}
