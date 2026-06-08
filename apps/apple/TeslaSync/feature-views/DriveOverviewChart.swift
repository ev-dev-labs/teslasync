//
//  DriveOverviewChart.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  The composable "Drive Overview" surface — the SwiftUI parity of
//  features/driving/components/drive-detail/DriveOverviewChart.tsx. Renders inside a
//  glass card fading in on appear (web `<FadeIn>`) and switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box. Binds through `DriveOverviewChartModel`
//  (P1/S8); no networking lives here. The web component takes a `drive` prop it does
//  not read in render (only `chartData`), so the native surface likewise needs only the
//  bound samples + unit labels.
//

import SwiftUI

/// The composable Drive Overview trace — the SwiftUI parity of the web
/// `DriveOverviewChart`, binding through `DriveOverviewChartModel` (P1/S8).
public struct DriveOverviewChart: View {
    @State private var model: DriveOverviewChartModel

    public init(model: DriveOverviewChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DriveOverviewHeader(connection: model.connection)
                if model.connection != .live {
                    DriveOverviewConnectivityBanner(connection: model.connection)
                }
                content(cursor: $model.cursorIndex)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The load envelope (web `chartData.length > 1` overlay widened to the full
    /// loading / error / empty / content set) so no state is hidden behind a blank panel.
    @ViewBuilder
    private func content(cursor: Binding<Int?>) -> some View {
        switch model.phase {
        case .loading:
            DriveOverviewLoading()
        case let .error(message):
            DriveOverviewError(message: message) { model.refresh() }
        case .empty:
            DriveOverviewEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DriveOverviewChartView(samples: model.samples, units: model.units, cursorIndex: cursor)
                DriveOverviewLegend(items: model.legend)
            }
        }
    }
}
