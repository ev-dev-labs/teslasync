//
//  CostPerKwhChart.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  The composable "Cost per kWh Trend" surface — the SwiftUI parity of
//  features/charging/components/cost-analysis/CostPerKwhChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="p-4">`) fading in on
//  appear, and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank
//  box. Binds through `CostPerKwhModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension CostPerKwhStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - CostPerKwhChart (the feature surface)

/// The composable cost-per-kWh trend chart — the SwiftUI parity of the web
/// `CostPerKwhChart`, binding through `CostPerKwhModel` (P1/S8).
public struct CostPerKwhChart: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CostPerKwhSurface.slug

    @State private var model: CostPerKwhModel

    /// - Parameter model: the bound view-model (built over a `CostPerKwhSource`).
    public init(model: CostPerKwhModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    CostPerKwhHeader(connection: model.connection)
                    if model.connection != .live {
                        CostPerKwhConnectivityBanner(connection: model.connection) { model.refresh() }
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `data.length > 0 ? <LineChart> : <noData>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            CostPerKwhLoading()
        case let .error(message):
            CostPerKwhError(message: message) { model.refresh() }
        case .empty:
            CostPerKwhEmpty()
        case .content:
            CostPerKwhLineChart(
                points: model.points,
                axisTicks: model.axisTicks,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }
}
