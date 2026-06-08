//
//  SocChart.swift
//  TeslaSync — P4 feature view · 0148 · SocChart (Apple)
//
//  The composable "SOC % Over Time" surface — the SwiftUI parity of
//  features/driving/components/drive-detail/SocChart.tsx. Renders inside a
//  GlassPanel-equivalent card fading in on appear (web `ChartContainer`), and
//  switches over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content) — never a blank box.
//  Binds through `SocChartModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable SOC-over-time area chart — the SwiftUI parity of the web
/// `SocChart`, binding through `SocChartModel` (P1/S8).
public struct SocChart: View {
    @State private var model: SocChartModel

    public init(model: SocChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SocChartHeader(connection: model.connection)
                if model.connection != .live {
                    SocChartConnectivityBanner(connection: model.connection)
                }
                content
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

    /// The web `chartData.length > 1 ? <area chart> : <empty overlay>` branch,
    /// widened to the full load envelope (loading / error / empty / content) so no
    /// state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SocChartLoadingChart()
        case let .error(message):
            SocChartError(message: message) { model.refresh() }
        case .empty:
            SocChartEmpty()
        case .content:
            SocChartAreaChart(
                samples: model.samples,
                selectedTime: cursorBinding,
                locale: model.displayLocale
            )
        }
    }

    /// The shared-cursor binding the chart drives — selection writes the synced
    /// time label back through the model (web `useSyncedCursor` `onMouseMove`),
    /// and the model's `selectedTime` positions the reference line (web
    /// `useSyncedReferenceLineX`).
    private var cursorBinding: Binding<String?> {
        Binding(
            get: { model.selectedTime },
            set: { model.moveCursor(to: $0) }
        )
    }
}
