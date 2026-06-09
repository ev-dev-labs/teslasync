//
//  MonthlyCostChart.swift
//  TeslaSync — P4 feature view · 0116 · MonthlyCostChart (Apple)
//
//  The composable "Monthly Cost Trend" surface — the SwiftUI parity of
//  features/charging/components/cost-analysis/MonthlyCostChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<ChartContainer>` chrome) fading in on appear,
//  and switches over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content) — never a blank box. Binds
//  through `MonthlyCostModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension MonthlyCostStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - MonthlyCostChart (the feature surface)

/// The composable monthly cost trend chart — the SwiftUI parity of the web
/// `MonthlyCostChart`, binding through `MonthlyCostModel` (P1/S8).
public struct MonthlyCostChart: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = MonthlyCostSurface.slug

    @State private var model: MonthlyCostModel

    /// - Parameter model: the bound view-model (built over a `MonthlyCostSource`).
    public init(model: MonthlyCostModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    MonthlyCostHeader(connection: model.connection)
                    if model.connection != .live {
                        MonthlyCostConnectivityBanner(connection: model.connection) { model.refresh() }
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

    /// The web `data.length > 0 ? <AreaChart> : <noData>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            MonthlyCostLoading()
        case let .error(message):
            MonthlyCostError(message: message) { model.refresh() }
        case .empty:
            MonthlyCostEmpty()
        case .content:
            MonthlyCostAreaChart(
                points: model.points,
                annotations: model.annotations,
                axisTicks: model.axisTicks,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }
}
