//
//  QuickStatsGrid.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  The vehicle-detail quick-stats grid — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx. Renders the web
//  source's eight `MetricCard` tiles (battery, range, odometer, speed, inside / outside
//  temperature, power, state) in a responsive grid, plus the P4 leaf contract states.
//  Binds through `QuickStatsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch, no snapshot yet → skeleton grid (web parent `isLoading`).
//    • empty    — resolved with no vehicle state → friendly empty state, never a blank box.
//    • error    — parent query failure with no cached state → retry affordance (web
//                 `QueryError` peer).
//    • data     — the eight metric tiles projected from the vehicle state.
//    • stale / offline — the orthogonal `connection` axis → a banner with a refresh
//                 affordance and a one-shot auto-refresh on the stale transition; cached
//                 tiles stay visible beneath it.
//

import SwiftUI

// MARK: - QuickStatsGrid (the feature surface)

/// The vehicle-detail quick-stats grid — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through `QuickStatsModel`.
public struct QuickStatsGrid: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "QuickStatsGrid"

    @State private var model: QuickStatsModel

    public init(model: QuickStatsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                QuickStatsConnectivityBanner(connection: model.connection) { model.refresh() }
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: QuickStatsStrings.string("quickStats.title", "Quick Stats")))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuickStatsLoadingGrid()
        case .empty:
            QuickStatsEmptyView()
        case let .error(message):
            QuickStatsErrorView(message: message) { model.refresh() }
        case .data:
            QuickStatsGridContent(tiles: model.tiles)
        }
    }
}
