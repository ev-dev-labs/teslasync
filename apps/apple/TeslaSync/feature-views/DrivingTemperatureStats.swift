//
//  DrivingTemperatureStats.swift
//  TeslaSync — P4 feature view · 0057 · DrivingTemperatureStats (Apple)
//
//  The composable "Temperature Stats" analytics feature view — the SwiftUI parity of
//  features/analytics/components/analytics/DrivingTemperatureStats.tsx. Renders every state
//  from the web source (the populated six-cell grid and the empty state) plus the native
//  query lifecycle the web parent owns (loading / error / stale / offline), bound through
//  `DrivingTemperatureStatsModel` (P1/S8). No networking lives here; the freshness chip +
//  banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable Temperature Stats analytics surface — the SwiftUI parity of
/// `features/analytics/components/analytics/DrivingTemperatureStats.tsx`, binding through
/// `DrivingTemperatureStatsModel` (P1/S8). No networking lives here.
public struct DrivingTemperatureStats: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DrivingTemperatureStatsSurface.slug

    @State private var model: DrivingTemperatureStatsModel

    public init(model: DrivingTemperatureStatsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.connection != .live {
                    DrivingTemperatureConnectivityBanner(connection: model.connection)
                }
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The panel heading (web `<SectionTitle>`) with the trailing freshness chip.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            DrivingTemperatureStrings.text("analytics.driving.tempStats", "Temperature Stats")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            DrivingTemperatureFreshnessChip(connection: model.connection)
        }
    }

    /// The mutually-exclusive render branches the surface switches over.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DrivingTemperatureLoadingGrid()
        case .empty:
            DrivingTemperatureEmptyState()
        case let .error(message):
            DrivingTemperatureErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                DrivingTemperatureGrid(projection: projection)
            } else {
                DrivingTemperatureEmptyState()
            }
        }
    }
}
