//
//  TemperatureGauges.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  The composable Drivetrain Health "temperature gauges" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/TemperatureGauges.tsx. Renders every state from
//  the surface contract (loading skeleton / empty / error / stale / offline / content) for the
//  responsive grid of radial thermal-sensor gauges, binding through `TemperatureGaugesModel`
//  (P1/S8). No networking lives here; the freshness chip + connectivity banner + auto-refresh
//  reflect the bound source's live-state (ADR-013).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension TemperatureGaugesStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TemperatureGauges (the temperature-gauges surface)

/// The composable Drivetrain Health temperature-gauges surface — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/TemperatureGauges.tsx`. Renders every state from
/// the web source and the responsive gauge grid inside one glass panel, binding through
/// `TemperatureGaugesModel` (P1/S8). No networking lives here.
public struct TemperatureGauges: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TemperatureGaugesSurface.slug

    @State private var model: TemperatureGaugesModel

    public init(model: TemperatureGaugesModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            TemperatureGaugesPanel {
                TemperatureGaugesHeader(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    updatedAt: model.updatedAt,
                    showsChip: showsFreshnessChip
                )
                if showsConnectivityBanner {
                    TemperatureGaugesConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The freshness chip appears while fetching or whenever the bound source is not live (the
    /// prompt's stale-chip / offline-chip states).
    private var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }

    /// The cached-data banner appears only when the source is stale or offline, so cached gauges
    /// are clearly labeled.
    private var showsConnectivityBanner: Bool {
        model.connection != .live
    }
}

// MARK: - Content states

private extension TemperatureGauges {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            TemperatureGaugesLoadingGrid()
        case .empty:
            TemperatureGaugesEmptyState()
        case let .error(message):
            TemperatureGaugesErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection, !projection.isEmpty {
                TemperatureGaugesContent(projection: projection)
            } else {
                TemperatureGaugesEmptyState()
            }
        }
    }
}
