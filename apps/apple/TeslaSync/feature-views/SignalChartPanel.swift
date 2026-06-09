//
//  SignalChartPanel.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The composable multi-line signal chart surface — the SwiftUI parity of
//  features/telemetry/components/SignalChartPanel.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="p-4 sm:p-5">`) fading in
//  on appear, and switches over the bound model's phase so every prompt-required
//  state renders (loading / empty / error / stale / offline / content) — the
//  content branch itself swapping between the overlay multi-line chart and the
//  small-multiples grid (web `effectiveMode`). Binds through `SignalChartModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable signal chart panel — the SwiftUI parity of the web
/// `SignalChartPanel`, binding through `SignalChartModel` (P1/S8).
public struct SignalChartPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalChartSurface.slug

    @State private var model: SignalChartModel

    public init(model: SignalChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    SignalChartHeader(
                        title: resolvedTitle,
                        isLive: model.isLive,
                        connection: model.connection,
                        annotation: headerAnnotation
                    )
                    if model.connection != .live {
                        SignalChartConnectivityBanner(connection: model.connection)
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

    /// Web `resolvedTitle`: the explicit override, else the live / historical title.
    private var resolvedTitle: String {
        if let override = model.titleOverride, !override.isEmpty {
            return override
        }
        return model.isLive ? SignalChartStrings.titleLive : SignalChartStrings.titleHistorical
    }

    /// The header's right-aligned annotation (web live counters vs points-loaded).
    private var headerAnnotation: SignalChartHeaderAnnotation {
        if model.isLive {
            return .live(SignalChartStrings.liveCounter(events: model.liveEventCount ?? 0, points: model.pointCount))
        }
        if model.pointCount > 0, let loaded = model.pointsLoaded {
            return .points(SignalChartStrings.pointsLoadedText(loaded))
        }
        return .hidden
    }

    /// The body branch, widened to the full load envelope (web `loading` / data /
    /// waiting / no-data, plus the native error state) so no state is hidden.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SignalChartLoadingView(height: CGFloat(model.height))
        case let .error(message):
            SignalChartErrorView(message: message) { model.refresh() }
        case .empty:
            SignalChartEmptyView(isLive: model.isLive, height: CGFloat(model.height))
        case .content:
            contentChart
        }
    }

    /// The content chart, swapping between the overlay trace and the grid per the
    /// resolved `effectiveMode` (web overlay `LineChart` vs `SmallMultiplesChart`).
    @ViewBuilder
    private var contentChart: some View {
        switch model.mode {
        case .overlay:
            SignalChartOverlay(
                samples: model.samples,
                selectedSignals: model.selectedSignals,
                useRightAxis: model.useRightAxis,
                isLive: model.isLive,
                height: CGFloat(model.height)
            )
        case .grid:
            SignalChartGrid(
                samples: model.samples,
                selectedSignals: model.selectedSignals,
                cellHeight: CGFloat(model.gridCellHeight)
            )
        }
    }
}
