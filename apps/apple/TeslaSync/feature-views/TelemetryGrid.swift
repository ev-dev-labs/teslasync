//
//  TelemetryGrid.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  The vehicle telemetry grid — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/TelemetryGrid.tsx. Renders the web source's
//  staggered grid of six tiles (Battery, Speed, Inside temp, Odometer, Charger, Sentry) plus
//  the P4 leaf-contract states. Binds through `TelemetryGridModel` (P1/S8); no networking
//  lives here. The surface emits the P1/S11 `view.opened`.
//
//  States (every one renders — no hidden surface):
//    • loading — initial fetch, no snapshot yet → the tile grid as skeletons.
//    • data    — the six-tile grid (each tile shows "—" for any missing reading).
//    • empty   — resolved with no vehicle state → friendly empty state, never blank.
//    • error   — parent query failure → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TelemetryGrid (the feature surface)

/// The vehicle telemetry grid — the SwiftUI parity of
/// `features/vehicles/components/telemetry-panels/TelemetryGrid.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through
/// `TelemetryGridModel`.
public struct TelemetryGrid: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TelemetryGridSurface.slug

    @State private var model: TelemetryGridModel

    public init(model: TelemetryGridModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.showsFreshnessChip {
                TSFadeIn(delay: 0.02) {
                    TGStatusBar(
                        connection: model.connection,
                        isFetching: model.isFetching,
                        ageLabel: model.ageLabel,
                        onRefresh: { model.refresh() }
                    )
                }
            }
            if model.connection != .live {
                TGConnectivityBanner(connection: model.connection)
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
        .accessibilityLabel(TelemetryGridStrings.text("telemetryGrid.accessibilityLabel", "Vehicle telemetry"))
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            TGLoadingGrid()
        case .data:
            if let projection = model.projection, projection.hasData {
                TGGrid(tiles: projection.tiles)
            } else {
                TGLoadingGrid()
            }
        case .empty:
            TGEmptyView()
        case .error:
            TGErrorView(onRetry: { model.refresh() })
        }
    }
}
