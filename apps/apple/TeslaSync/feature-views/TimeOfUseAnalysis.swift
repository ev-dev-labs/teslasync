//
//  TimeOfUseAnalysis.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  The composable "Electricity Rate Analysis (Time-of-Use)" surface — the SwiftUI
//  parity of features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx. Renders
//  inside a GlassPanel-equivalent card (web `<GlassPanel className="p-4">`) fading in
//  on appear, and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank box.
//  The content composes the hourly bar chart + legend beside the four-card insights
//  rail, reproducing the web `grid lg:grid-cols-3` split responsively. Binds through
//  `TimeOfUseModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - String facade `Text` helper (keeps the Model layer SwiftUI-free)

public extension TimeOfUseStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TimeOfUseAnalysis (the feature surface)

/// The composable time-of-use analysis surface — the SwiftUI parity of the web
/// `TimeOfUseAnalysis`, binding through `TimeOfUseModel` (P1/S8).
public struct TimeOfUseAnalysis: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TimeOfUseSurface.slug

    @State private var model: TimeOfUseModel

    /// - Parameter model: the bound view-model (built over a `TimeOfUseSource`).
    public init(model: TimeOfUseModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    TimeOfUseHeader(connection: model.connection)
                    if model.connection != .live {
                        TimeOfUseConnectivityBanner(connection: model.connection) { model.refresh() }
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

    /// The web `hourlyData.length > 0 ? <BarChart> : <noData>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TimeOfUseLoadingView()
        case let .error(message):
            TimeOfUseError(message: message) { model.refresh() }
        case .empty:
            TimeOfUseEmpty()
        case .content:
            TimeOfUseContent(
                points: model.points,
                insights: model.insights,
                axisLabels: model.axisTickLabels,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }
}

// MARK: - Content layout (web `grid grid-cols-1 lg:grid-cols-3`)

/// The populated body: the hourly bar chart + legend beside the four-card insights
/// rail. Reproduces the web responsive split — side-by-side (chart ~2/3, rail ~1/3)
/// on a regular-width idiom (iPad / macOS), stacked on a compact idiom (iPhone).
struct TimeOfUseContent: View {
    let points: [TimeOfUseHourPoint]
    let insights: TimeOfUseInsights?
    let axisLabels: [String]
    let localize: (String, String) -> String
    let formatting: any TimeOfUseFormatting

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isWide: Bool {
            horizontalSizeClass == .regular
        }
    #else
        private var isWide: Bool {
            true
        }
    #endif

    var body: some View {
        if isWide {
            HStack(alignment: .top, spacing: TSSpacing.x2xl) {
                chartColumn
                    .frame(maxWidth: .infinity, alignment: .leading)
                insightsColumn
                    .frame(width: 240)
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                chartColumn
                insightsColumn
            }
        }
    }

    private var chartColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TimeOfUseBarChart(
                points: points,
                axisLabels: axisLabels,
                localize: localize,
                formatting: formatting
            )
            TimeOfUseLegend()
        }
    }

    private var insightsColumn: some View {
        TimeOfUseInsightsColumn(insights: insights, localize: localize, formatting: formatting)
    }
}
