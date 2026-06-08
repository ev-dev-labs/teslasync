//
//  ComputedMetricEditor.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The composable ComputedMetricEditor feature view — the SwiftUI parity of
//  web/src/features/notifications/components/ComputedMetricEditor.tsx. A controlled
//  editor: the web `{ value, onChange }` props collapse into a SwiftUI
//  `Binding<ComputedMetricEditorValue>`, the web `metrics` registry binds through
//  `ComputedMetricRegistryModel` (P1/S8, web `useAlertMetrics`), and the live preview
//  binds through `ComputedMetricPreviewModel` (P1/S8, web `usePreviewComputedMetric`).
//  The surface renders the metric / window / operator selects, the numeric threshold,
//  and the live-preview line, and emits the P1/S11 `view.opened` event with the slug
//  `ComputedMetricEditor` on appear. No networking lives in the view.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `ComputedMetricEditor`: the operand panel
/// for `kind='computed_metric'` alert rules. The metric picker's data source renders
/// every state the P4 contract requires (loading / empty / error / stale / offline);
/// the live preview re-fires (web `useEffect`) whenever the chosen metric / window /
/// operator / threshold change and the editor is ready.
public struct ComputedMetricEditor: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ComputedMetricEditorDiagnostics.surface

    @Binding private var value: ComputedMetricEditorValue
    @State private var registry: ComputedMetricRegistryModel
    @State private var preview: ComputedMetricPreviewModel
    private let telemetry: any ComputedMetricEditorTelemetry
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    /// The canonical binding: the web `value` + `onChange` collapse into a SwiftUI
    /// `Binding`, and the two data hooks bind through their P1/S8 models.
    public init(
        value: Binding<ComputedMetricEditorValue>,
        registry: ComputedMetricRegistryModel,
        preview: ComputedMetricPreviewModel,
        telemetry: any ComputedMetricEditorTelemetry = OSLogComputedMetricEditorTelemetry()
    ) {
        _value = value
        _registry = State(initialValue: registry)
        _preview = State(initialValue: preview)
        self.telemetry = telemetry
    }

    /// Web-prop binding: mirrors the web `metrics` + `loading` props and the
    /// `usePreviewComputedMetric` mutation, wiring the P1/S8 models for the caller.
    public init(
        value: Binding<ComputedMetricEditorValue>,
        metrics: [ComputedMetricSummary],
        loading: Bool,
        previewRunner: any ComputedMetricPreviewRunner,
        telemetry: any ComputedMetricEditorTelemetry = OSLogComputedMetricEditorTelemetry()
    ) {
        self.init(
            value: value,
            registry: ComputedMetricRegistryModel(metrics: metrics, loading: loading),
            preview: ComputedMetricPreviewModel(runner: previewRunner),
            telemetry: telemetry
        )
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                fieldGrid
                CMEThresholdField(value: $value)
                ComputedMetricPreviewPanel(ready: isReady, unit: selected?.unit, preview: preview)
            }
        }
        .task {
            ComputedMetricEditorOpenReporter.report(using: telemetry)
            registry.start()
        }
        .task(id: previewKey) { refreshPreview() }
        .onDisappear { registry.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The metric / window / operator row (web `grid grid-cols-1 sm:grid-cols-3`):
    /// three columns on regular width, stacked on compact (iPhone / narrow split).
    @ViewBuilder
    private var fieldGrid: some View {
        let metric = CMEMetricField(value: $value, registry: registry)
        let window = CMEWindowField(value: $value, selected: selected)
        let op = CMEOperatorField(value: $value, selected: selected)
        if isWide {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                metric
                window
                op
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                metric
                window
                op
            }
        }
    }

    /// Web `selected = metrics.find(m => m.id === value.metric_id)`.
    private var selected: ComputedMetricSummary? {
        ComputedMetricEditorAdapter.selectedMetric(in: registry.metrics, id: value.metricID)
    }

    /// Web `ready`.
    private var isReady: Bool {
        ComputedMetricEditorAdapter.isReady(value)
    }

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    /// The web `useEffect` dependency list (ready + the request fields). Driving
    /// `.task(id:)` with it re-fires the preview exactly when the web effect would.
    private var previewKey: String {
        [
            String(isReady),
            value.metricID,
            value.metricWindow,
            value.metricOp.rawValue,
            value.metricThreshold,
            value.vehicleID.map(String.init) ?? ""
        ].joined(separator: "|")
    }

    /// Web preview `useEffect` body: fire the preview when ready, else reset the line.
    private func refreshPreview() {
        if let request = ComputedMetricEditorAdapter.makeRequest(from: value) {
            preview.requestPreview(request)
        } else {
            preview.clear()
        }
    }
}
