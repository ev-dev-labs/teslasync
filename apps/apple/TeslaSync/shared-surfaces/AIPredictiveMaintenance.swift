//
//  AIPredictiveMaintenance.swift
//  TeslaSync — P4 shared surface · 0039 · AIPredictiveMaintenance (Apple)
//
//  The Helix maintenance-advisor card — the SwiftUI parity of
//  web/src/components/ai/AIPredictiveMaintenance.tsx. It is `withAiFeature('predictive-maintenance')`
//  in the web source (a `useAiEnabled` gate; disabled ⇒ the HOC renders `null`); the InnerSection
//  streams from POST /ai/maintenance/predict (`{ vehicle_id }`, scoped only when a positive id is
//  selected) and renders the shared `AIFeatureCard` (title "Helix maintenance advisor", the long
//  privacy description, the Ask-Helix button, the "Helix" badge, and the "Select a vehicle first."
//  empty hint) feeding `AiOutputPanel`. This surface reproduces that composition natively, bound
//  through `PredictiveMaintenanceModel` (P1/S8); no networking lives here.
//
//  ADR-015 alignment: §I3 baseline intact (never replaces the deterministic maintenance reminders),
//  §I5 hidden UI (the gate withdraws the surface in off mode), §I8 propose-only (read-only narration
//  over the maintenance envelope — no mutation of items, reminders, or thresholds).
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no advisory has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + the "Select a vehicle first." empty hint (when no vehicle is in
//                scope) + Ask-Helix button + output panel (empty / thinking / prose / error), plus
//                the orthogonal connectivity axis (live / stale / offline) driving the header
//                freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIPredictiveMaintenance (the shared surface)

/// The Helix maintenance-advisor card — the SwiftUI parity of `AIPredictiveMaintenance.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `PredictiveMaintenanceModel`.
public struct AIPredictiveMaintenance: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIPredictiveMaintenance"

    @State private var model: PredictiveMaintenanceModel

    public init(model: PredictiveMaintenanceModel) {
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

private extension AIPredictiveMaintenance {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                PredictiveMaintenanceConnectivityBanner(connection: model.connection)
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
            Text(verbatim: PredictiveMaintenanceStrings.string(
                "maintenance.aiPredictive.title",
                "Helix maintenance advisor"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: PredictiveMaintenanceStrings.string(
                "maintenance.aiPredictive.title",
                "Helix maintenance advisor"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            PredictiveMaintenanceHelixBadge(
                label: PredictiveMaintenanceStrings.string("maintenance.aiPredictive.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            PredictiveMaintenanceFreshnessChip(connection: model.connection)
            PredictiveMaintenanceRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIPredictiveMaintenance {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            PredictiveMaintenanceLoadingView()
        case let .error(message):
            PredictiveMaintenanceGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                PredictiveMaintenanceReadyView(ready: ready) { model.generate() }
            }
        }
    }
}
