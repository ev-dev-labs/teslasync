//
//  AISmartChargeScheduleSuggestion.swift
//  TeslaSync — P4 shared surface · 0047 · AISmartChargeScheduleSuggestion (Apple)
//
//  The Helix smart-charge-schedule card — the SwiftUI parity of
//  web/src/components/ai/AISmartChargeScheduleSuggestion.tsx. It is
//  `withAiFeature('smart-charge-schedule-suggestion')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from POST /ai/charging/schedule/draft
//  (the 9-field schedule body, enabled only when BOTH a vehicle and a rate plan are selected) and
//  renders the shared `AIFeatureCard` (title "Draft a schedule with Helix", the propose-only
//  description, the Ask-Helix button, the "Helix" badge) feeding `AiOutputPanel`. This surface
//  reproduces that composition natively, bound through `SmartChargeScheduleModel` (P1/S8); no
//  networking lives here.
//
//  ADR-015 alignment: §I3 baseline intact (never replaces the deterministic Optimize control or the
//  manual Schedule action), §I5 hidden UI (the gate withdraws the surface in off mode), §I8
//  propose-only (the drafted schedule is NEVER saved automatically — the operator reviews and applies
//  it via the deterministic Schedule control).
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no schedule has been drafted, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose / error),
//                plus the orthogonal connectivity axis (live / stale / offline) driving the header
//                freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AISmartChargeScheduleSuggestion (the shared surface)

/// The Helix smart-charge-schedule card — the SwiftUI parity of `AISmartChargeScheduleSuggestion.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `SmartChargeScheduleModel`.
public struct AISmartChargeScheduleSuggestion: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AISmartChargeScheduleSuggestion"

    @State private var model: SmartChargeScheduleModel

    public init(model: SmartChargeScheduleModel) {
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

private extension AISmartChargeScheduleSuggestion {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                SmartChargeScheduleConnectivityBanner(connection: model.connection)
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
            Text(verbatim: SmartChargeScheduleStrings.string(
                "chargePlanner.aiAgent.title",
                "Draft a schedule with Helix"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: SmartChargeScheduleStrings.string(
                "chargePlanner.aiAgent.title",
                "Draft a schedule with Helix"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            SmartChargeScheduleHelixBadge(
                label: SmartChargeScheduleStrings.string("chargePlanner.aiAgent.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            SmartChargeScheduleFreshnessChip(connection: model.connection)
            SmartChargeScheduleRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AISmartChargeScheduleSuggestion {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            SmartChargeScheduleLoadingView()
        case let .error(message):
            SmartChargeScheduleGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                SmartChargeScheduleReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
