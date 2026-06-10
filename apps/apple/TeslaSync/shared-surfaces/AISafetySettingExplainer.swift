//
//  AISafetySettingExplainer.swift
//  TeslaSync — P4 shared surface · 0045 · AISafetySettingExplainer (Apple)
//
//  The Helix safety-setting explainer card — the SwiftUI parity of
//  web/src/components/ai/AISafetySettingExplainer.tsx. It is
//  `withAiFeature('safety-setting-explainer')` in the web source (a `useAiEnabled` gate; disabled ⇒
//  the HOC renders `null`); the InnerSection streams from POST /ai/settings/safety/explain with the
//  EMPTY body (`{}`) and renders the shared `AIFeatureCard` (title "Explain my safety settings", a
//  description, the Ask-Helix button "Explain my settings", the "Helix" badge, buttonPlacement
//  "below") feeding `AiOutputPanel`. The render contract is NARRATIVE: Helix only explains the user's
//  existing safety settings — it never proposes a value, never claims to have changed a setting, and
//  never offers an "Apply to form" handoff. This surface reproduces that composition natively, bound
//  through `SafetySettingExplainerModel` (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no explanation has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition. `canStart` follows the web `state !== 'paused-confirm'`, and the action
//                no-ops while busy (the web double-submit guard). The in-flight stream is cancelled
//                on disappear (web cancel-on-unmount).
//

import SwiftUI

// MARK: - AISafetySettingExplainer (the shared surface)

/// The Helix safety-setting explainer card — the SwiftUI parity of `AISafetySettingExplainer.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `SafetySettingExplainerModel`.
public struct AISafetySettingExplainer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AISafetySettingExplainer"

    /// The web `buttonTestId="ai-feature-safety-setting-explainer-suggest"` — carried as the action
    /// button's accessibility identifier so UI tests can locate it.
    public static let actionAccessibilityIdentifier = "ai-feature-safety-setting-explainer-suggest"

    @State private var model: SafetySettingExplainerModel

    public init(model: SafetySettingExplainerModel) {
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

private extension AISafetySettingExplainer {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                SafetySettingExplainerConnectivityBanner(connection: model.connection)
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
            Text(verbatim: SafetySettingExplainerStrings.string(
                "safetySettings.aiExplainer.title",
                "Explain my safety settings"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: SafetySettingExplainerStrings.string(
                "safetySettings.aiExplainer.title",
                "Explain my safety settings"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            SafetySettingExplainerHelixBadge(
                label: SafetySettingExplainerStrings.string("safetySettings.aiExplainer.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            SafetySettingExplainerFreshnessChip(connection: model.connection)
            SafetySettingExplainerRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AISafetySettingExplainer {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            SafetySettingExplainerLoadingView()
        case let .error(message):
            SafetySettingExplainerGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                SafetySettingExplainerReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
