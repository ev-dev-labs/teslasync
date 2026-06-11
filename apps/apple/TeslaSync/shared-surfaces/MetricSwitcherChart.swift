//
//  MetricSwitcherChart.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  The metric-switcher chart — the SwiftUI parity of `components/charts/MetricSwitcherChart.tsx`. A
//  chart with a pill row above it for switching the displayed metric, used by overview surfaces where
//  one chart should answer several questions ("Drives over time" / "Distance over time" / "Score over
//  time") without dedicating a panel to each. The component owns layout + the pill bar; consumers own
//  the data shape and per-metric chart type — exactly like the web source.
//
//  Binds through `MetricSwitcherChartModel` (the `@MainActor` owner of the controlled selection + the
//  dataset state, P1/S8); no networking lives in the view. Renders every web branch — the bar / area /
//  line chart, the empty-state, and the non-matching-key fallback — plus the P4 leaf contract
//  (loading / error / stale / offline) the parent's state holder carries. Emits `view.opened` once on
//  first appearance (P1/S11).
//

import SwiftUI

// MARK: - MetricSwitcherChart (the shared surface)

/// The metric-switcher chart — the SwiftUI parity of `components/charts/MetricSwitcherChart.tsx`.
/// A pill row over a bar / area / line chart, binding through `MetricSwitcherChartModel`.
public struct MetricSwitcherChart: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = MetricSwitcherChartMeta.surfaceSlug

    @State private var model: MetricSwitcherChartModel

    /// Designated initializer binding a pre-built model — for hosts that own the dataset state holder
    /// and wire the selection / retry callbacks themselves.
    public init(model: MetricSwitcherChartModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the common presentational case — the parity of mounting
    /// `<MetricSwitcherChart title=… series=… metrics=… activeMetric=… onMetricChange=… />` with the
    /// data already fetched by the parent. `metrics` is the switchable-metric config; `series` is the
    /// per-metric point map (the caller applies its own `getValue` when building the points).
    public init(
        title: MetricSwitcherText,
        metrics: [MetricSwitcherMetricSpec],
        series: [String: [MetricSwitcherPoint]],
        activeMetric: String = "",
        onMetricChange: (@MainActor (String) -> Void)? = nil,
        accessibilityLabel: MetricSwitcherText? = nil,
        emptyMessage: MetricSwitcherText? = nil,
        height: Double = MetricSwitcherChartLayout.defaultHeight,
        telemetry: any MetricSwitcherChartTelemetry = OSLogMetricSwitcherChartTelemetry()
    ) {
        _model = State(initialValue: MetricSwitcherChartModel(
            title: title,
            state: .loaded(MetricSwitcherDataset(metrics: metrics, series: series), stale: false),
            activeMetric: activeMetric,
            accessibilityLabel: accessibilityLabel,
            emptyMessage: emptyMessage,
            height: height,
            onMetricChange: onMetricChange,
            telemetry: telemetry
        ))
    }

    /// Convenience initializer wiring a cache-then-network dataset state (P1/S8) — for hosts that drive
    /// the chart from a state holder and want the full loading / error / stale / offline contract. The
    /// `onRetry` handler powers the error-state retry + the freshness-chip refresh.
    public init(
        title: MetricSwitcherText,
        state: LoadableState<MetricSwitcherDataset>,
        activeMetric: String = "",
        onMetricChange: (@MainActor (String) -> Void)? = nil,
        onRetry: (@MainActor () -> Void)? = nil,
        accessibilityLabel: MetricSwitcherText? = nil,
        emptyMessage: MetricSwitcherText? = nil,
        height: Double = MetricSwitcherChartLayout.defaultHeight,
        telemetry: any MetricSwitcherChartTelemetry = OSLogMetricSwitcherChartTelemetry()
    ) {
        _model = State(initialValue: MetricSwitcherChartModel(
            title: title,
            state: state,
            activeMetric: activeMetric,
            accessibilityLabel: accessibilityLabel,
            emptyMessage: emptyMessage,
            height: height,
            onMetricChange: onMetricChange,
            onRetry: onRetry,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        MetricSwitcherChartPanel(
            resolved: model.resolved,
            canRetry: model.canRetry,
            onSelect: { model.select($0) },
            onRetry: { model.retry() }
        )
        .onAppear { model.markAppeared() }
    }
}
