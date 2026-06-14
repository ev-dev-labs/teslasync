//
//  AITripPlannerLLMAgent.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  The Helix trip-planner card — the SwiftUI parity of
//  web/src/components/ai/AITripPlannerLLMAgent.tsx. It is
//  `withAiFeature('trip-planner-llm-agent')` in the web source (a `useAiEnabled` gate; disabled ⇒ the
//  HOC renders `null`); the InnerSection streams from POST /ai/trips/plan/draft (the 7-field plan
//  body, enabled only when a vehicle AND both corridor endpoints are selected) and renders the shared
//  `AIFeatureCard` (title "Draft a plan with Helix", the propose-only description, the Ask-Helix
//  button, the "Helix" badge) feeding `AiOutputPanel`. This surface reproduces that composition
//  natively, bound through `TripPlannerAgentModel` (P1/S8); no networking lives here.
//
//  Propose-only contract: the drafted plan is NEVER saved automatically — the operator reviews it and
//  saves it via the deterministic Plan control in the page form.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no plan has been drafted, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose / error),
//                plus the orthogonal connectivity axis (live / stale / offline) driving the header
//                freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AITripPlannerLLMAgent (the shared surface)

/// The Helix trip-planner card — the SwiftUI parity of `AITripPlannerLLMAgent.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `TripPlannerAgentModel`.
public struct AITripPlannerLLMAgent: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AITripPlannerLLMAgent"

    @State private var model: TripPlannerAgentModel

    public init(model: TripPlannerAgentModel) {
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

private extension AITripPlannerLLMAgent {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                TripPlannerAgentConnectivityBanner(connection: model.connection)
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
            Text(verbatim: TripPlannerAgentStrings.string(
                "tripPlanner.aiAgent.title",
                "Draft a plan with Helix"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: TripPlannerAgentStrings.string(
                "tripPlanner.aiAgent.title",
                "Draft a plan with Helix"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            TripPlannerAgentHelixBadge(
                label: TripPlannerAgentStrings.string("tripPlanner.aiAgent.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            TripPlannerAgentFreshnessChip(connection: model.connection)
            TripPlannerAgentRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AITripPlannerLLMAgent {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            TripPlannerAgentLoadingView()
        case let .error(message):
            TripPlannerAgentGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                TripPlannerAgentReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
