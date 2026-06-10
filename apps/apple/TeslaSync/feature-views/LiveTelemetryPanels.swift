//
//  LiveTelemetryPanels.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The live-telemetry section — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx. Renders the web
//  source's FadeIn "Live Telemetry" header (with the pulsing live indicator) and its
//  responsive grid of seven telemetry panels (Powertrain, Climate, Security, Vehicle State,
//  Tire Pressure, Energy & Charging, Media & Navigation), plus the P4 leaf-contract states.
//  Binds through `LiveTelemetryPanelsModel` (P1/S8); no networking lives here. The surface
//  emits the P1/S11 `view.opened`.
//
//  States (every one renders — no hidden surface):
//    • loading — initial fetch, no snapshot yet → the panel grid as skeletons.
//    • data    — the full seven-panel grid (each panel skeletons / empties per its source).
//    • empty   — resolved with no telemetry at all → friendly empty state, never blank.
//    • error   — parent query failure → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner
//                with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - LiveTelemetryPanels (the feature surface)

/// The live-telemetry section — the SwiftUI parity of
/// `features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `LiveTelemetryPanelsModel`.
public struct LiveTelemetryPanels: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LiveTelemetryPanelsSurface.slug

    @State private var model: LiveTelemetryPanelsModel

    public init(model: LiveTelemetryPanelsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSFadeIn(delay: 0.12) {
                LTPHeader(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    showsChip: model.showsFreshnessChip,
                    ageLabel: model.ageLabel,
                    onRefresh: { model.refresh() }
                )
            }
            if model.connection != .live {
                LTPConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LiveTelemetryPanelsStrings.text("common.liveTelemetry", "Live Telemetry"))
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            LTPLoadingGrid()
        case .data:
            if let projection = model.projection {
                LTPGrid(projection: projection)
            } else {
                LTPLoadingGrid()
            }
        case .empty:
            LTPSectionEmptyView()
        case .error:
            LTPSectionErrorView(onRetry: { model.refresh() })
        }
    }
}
