//
//  PowerProfileChart.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  The composable "Power Profile" surface — the SwiftUI parity of
//  features/driving/components/drive-detail/PowerProfileChart.tsx. Renders inside a glass
//  card fading in on appear (web `<FadeIn>`) and switches over the bound model's phase so
//  every prompt-required state renders (loading / empty / error / stale / offline /
//  content) — never a blank box. Binds through `PowerProfileChartModel` (P1/S8); no
//  networking lives here. The web component reads only `chartData` + `stats`, so the
//  native surface likewise needs only the bound samples + the footer summary.
//

import SwiftUI

/// The composable drive power / regeneration trace — the SwiftUI parity of the web
/// `PowerProfileChart`, binding through `PowerProfileChartModel` (P1/S8).
public struct PowerProfileChart: View {
    @State private var model: PowerProfileChartModel

    public init(model: PowerProfileChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                PowerProfileHeader(connection: model.connection)
                if model.connection != .live {
                    PowerProfileConnectivityBanner(connection: model.connection)
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

    /// The load envelope (web `chartData.length > 1` overlay widened to the full loading /
    /// error / empty / content set) so no state is hidden behind a blank panel.
    @ViewBuilder
    private func content(cursor: Binding<Int?>) -> some View {
        switch model.phase {
        case .loading:
            PowerProfileLoading()
        case let .error(message):
            PowerProfileError(message: message) { model.refresh() }
        case .empty:
            PowerProfileEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                PowerProfileChartView(samples: model.samples, cursorIndex: cursor)
                PowerProfileStatsFooter(stats: model.stats)
            }
        }
    }
}
