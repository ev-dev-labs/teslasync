//
//  XRayBucketChart.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  The composable Ingest X-Ray "Samples per bucket" surface — the SwiftUI parity of
//  features/admin/components/ingest-xray/XRayBucketChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `ChartContainer`) fading in on appear (web
//  `<FadeIn>`), and switches over the bound model's phase so every prompt-required
//  state renders (loading / empty / error / stale / offline / content) — never a blank
//  box. Binds through `XRayBucketChartModel` (P1/S8); no networking here.
//

import SwiftUI

/// The composable Samples-per-bucket chart — the SwiftUI parity of the web
/// `XRayBucketChart`, binding through `XRayBucketChartModel` (P1/S8).
public struct XRayBucketChart: View {
    @State private var model: XRayBucketChartModel

    public init(model: XRayBucketChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                XRayBucketHeader(connection: model.connection)
                if model.connection != .live {
                    XRayBucketConnectivityBanner(connection: model.connection)
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

    /// The web `!loading && series.length === 0 ? <empty> : <chart>` branch, widened to
    /// the full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            XRayBucketLoadingChart()
        case let .error(message):
            XRayBucketError(message: message) { model.refresh() }
        case .empty:
            XRayBucketEmpty()
        case .content:
            XRayBucketBarChart(bars: model.bars)
        }
    }
}
