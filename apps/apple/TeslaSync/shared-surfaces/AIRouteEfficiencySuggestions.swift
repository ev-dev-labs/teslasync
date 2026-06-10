//
//  AIRouteEfficiencySuggestions.swift
//  TeslaSync — P4 shared surface · 0044 · AIRouteEfficiencySuggestions (Apple)
//
//  The Helix route-efficiency-suggestions card — the SwiftUI parity of
//  web/src/components/ai/AIRouteEfficiencySuggestions.tsx. It is
//  `withAiFeature('route-efficiency-suggestions')` in the web source (a `useAiEnabled` gate; disabled
//  ⇒ the HOC renders `null`); the InnerSection streams from POST
//  /ai/routes/{routeID}/efficiency/suggest (empty `{}` body, the {routeID} slot is the parent page's
//  vehicleId as an opaque anchor) and renders the shared `AIFeatureCard` (title "Route-efficiency
//  suggestions", a description, the Ask-Helix button, the "Helix" badge) feeding `AiOutputPanel`. This
//  surface reproduces that composition natively, bound through `RouteEfficiencySuggestionsModel`
//  (P1/S8); no networking lives here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no suggestions have been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + Ask-Helix button + output panel (empty / thinking / prose /
//                error), plus the orthogonal connectivity axis (live / stale / offline) driving the
//                header freshness chip + banner with a one-shot auto-refresh on the stale
//                transition.
//

import SwiftUI

// MARK: - AIRouteEfficiencySuggestions (the shared surface)

/// The Helix route-efficiency-suggestions card — the SwiftUI parity of
/// `AIRouteEfficiencySuggestions.tsx`. Renders every state from the web source plus the P4 leaf
/// freshness states, binding through `RouteEfficiencySuggestionsModel`.
public struct AIRouteEfficiencySuggestions: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIRouteEfficiencySuggestions"

    @State private var model: RouteEfficiencySuggestionsModel

    public init(model: RouteEfficiencySuggestionsModel) {
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

private extension AIRouteEfficiencySuggestions {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                RouteEfficiencySuggestionsConnectivityBanner(connection: model.connection)
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
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(
                "routeEfficiency.aiSuggestions.title",
                "Route-efficiency suggestions"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(
                "routeEfficiency.aiSuggestions.title",
                "Route-efficiency suggestions"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            RouteEfficiencySuggestionsHelixBadge(
                label: RouteEfficiencySuggestionsStrings.string("routeEfficiency.aiSuggestions.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            RouteEfficiencySuggestionsFreshnessChip(connection: model.connection)
            RouteEfficiencySuggestionsRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIRouteEfficiencySuggestions {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            RouteEfficiencySuggestionsLoadingView()
        case let .error(message):
            RouteEfficiencySuggestionsGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                RouteEfficiencySuggestionsReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
