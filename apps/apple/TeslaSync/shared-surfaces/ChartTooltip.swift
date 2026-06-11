//
//  ChartTooltip.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  The chart value readout surface — the SwiftUI parity of `components/charts/ChartTooltip.tsx`.
//  The web component is a Recharts custom tooltip: a floating panel that renders a formatted
//  label header over one row per series (a colored dot, the series name, and the formatted value
//  + unit), and renders nothing while the cursor is off the plot. The native parity surface
//  presents that same readout — the label header + series rows — and adds the P4 leaf states so
//  it never collapses to a blank box. Binds through `ChartTooltipModel` (P1/S8); no networking
//  lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton readout panel.
//    • empty    — inactive cursor / empty payload (web `null`) → friendly empty state.
//    • error    — source feed failure → retry affordance (web `QueryError` peer).
//    • data     — the label header over the series rows (the web tooltip body).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the body with
//                 a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ChartTooltip (the shared surface)

/// The chart value readout surface — the SwiftUI parity of `components/charts/ChartTooltip.tsx`.
/// Renders every state plus the P4 leaf freshness states, binding through `ChartTooltipModel`.
public struct ChartTooltip: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChartTooltip"

    @State private var model: ChartTooltipModel

    public init(model: ChartTooltipModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production selection source — the parity of the web
    /// `<ChartTooltip>` mounting and waiting for Recharts to push the first hovered point.
    public init() {
        _model = State(initialValue: ChartTooltipModel(source: LiveChartTooltipSource()))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
            if model.connection != .live {
                ChartTooltipFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: ChartTooltipStrings.string("chartTooltip.title", "Chart readout"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: ChartTooltipStrings.string(
                "chartTooltip.subtitle", "Values under the chart cursor"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            ChartTooltipLoadingView()
        case .empty:
            ChartTooltipEmptyView()
        case let .error(message):
            ChartTooltipErrorView(message: message) { model.refresh() }
        case .data:
            ChartTooltipDataView(resolved: model.resolved)
        }
    }
}
