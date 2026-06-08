//
//  ComputedMetricEditor.Views.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The presentational pieces the surface composes: the i18n SwiftUI bridge
//  (`CMEView`), the responsive metric/window/operator field grid (web `grid
//  grid-cols-1 sm:grid-cols-3`), the metric picker that renders EVERY state of the
//  `useAlertMetrics` source (loading / content / empty / error / stale / offline),
//  the numeric threshold field, and the live-preview panel that renders every preview
//  state (idle / computing / error / value) plus the offline/stale chrome. All strings
//  resolve through the P1/S10 `CMEStrings` facade; all colors/spacing come from the
//  P1/S9 tokens — no Tailwind ported.
//

import SwiftUI

// MARK: - SwiftUI i18n helpers (web `t(key, default)`)

/// Bridges the `CMEStrings` facade into the SwiftUI text types the shared components
/// expect, so no view holds a hardcoded literal and runtime-resolved strings flow into
/// `LocalizedStringKey`-typed component parameters verbatim.
enum CMEView {
    /// A `LocalizedStringKey` that renders an already-resolved string verbatim.
    static func key(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }

    /// A `LocalizedStringKey` for an `i18n` descriptor, resolved through the facade.
    static func key(_ descriptor: LocalizedText) -> LocalizedStringKey {
        key(CMEStrings.string(descriptor))
    }

    /// A verbatim `Text` for an `i18n` descriptor, resolved through the facade.
    static func text(_ descriptor: LocalizedText) -> Text {
        Text(verbatim: CMEStrings.string(descriptor))
    }
}

// MARK: - iOS numeric keyboard (web `<UiInput type="number">`)

extension View {
    /// Applies the decimal keypad on iOS for the numeric threshold field; a no-op on
    /// macOS where there is no soft keyboard.
    @ViewBuilder
    func cmeNumericKeyboard() -> some View {
        #if os(iOS)
            keyboardType(.decimalPad)
        #else
            self
        #endif
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// Header chip flagging live / stale / offline data (web freshness hint). Hidden by
/// callers when the data is live; rendered for the stale + offline branches.
struct CMEFreshnessChip: View {
    let freshness: ComputedMetricFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: LocalizedText {
        switch freshness {
        case .live: ComputedMetricEditorAdapter.Text.live
        case .stale: ComputedMetricEditorAdapter.Text.stale
        case .offline: ComputedMetricEditorAdapter.Text.offline
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            CMEView.text(label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CMEView.text(label))
    }
}

// MARK: - Inline state (error / offline) with optional retry

/// A compact inline state row (web `QueryError` / offline fallback) used by the metric
/// picker's error + offline branches, with an optional retry affordance.
struct CMEInlineState: View {
    let symbol: String
    let message: LocalizedText
    let tone: TSTone
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            CMEView.text(message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let onRetry {
                Button(action: onRetry) {
                    CMEView.text(ComputedMetricEditorAdapter.Text.retry)
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(CMEView.text(ComputedMetricEditorAdapter.Text.retry))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Metric field (web metric `<UiSelect>`, every source state)

/// The metric select bound to the `useAlertMetrics` source. Renders the empty choice +
/// loaded options (web `metricOptions`) and, per the P4 states contract, the loading /
/// empty / error / stale / offline chrome of the registry query.
struct CMEMetricField: View {
    @Binding var value: ComputedMetricEditorValue
    let registry: ComputedMetricRegistryModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            TSLabel(CMEView.key(ComputedMetricEditorAdapter.Text.metric))
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
        }
    }

    @ViewBuilder
    private var freshnessChip: some View {
        switch registry.presentation {
        case let .content(_, freshness, _) where freshness != .live:
            CMEFreshnessChip(freshness: freshness)
        case let .empty(freshness) where freshness != .live:
            CMEFreshnessChip(freshness: freshness)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch registry.presentation {
        case .loading:
            loadingRow
        case let .content(metrics, _, refreshing):
            picker(metrics: metrics, refreshing: refreshing)
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                picker(metrics: [], refreshing: false)
                emptyHint
            }
        case .offlineNoData:
            CMEInlineState(
                symbol: "wifi.slash",
                message: ComputedMetricEditorAdapter.Text.metricsOffline,
                tone: .neutral
            ) { registry.refresh() }
        case let .error(retryable):
            CMEInlineState(
                symbol: "exclamationmark.triangle.fill",
                message: ComputedMetricEditorAdapter.Text.metricsError,
                tone: .danger,
                onRetry: retryable ? { registry.refresh() } : nil
            )
        }
    }

    private func picker(metrics: [ComputedMetricSummary], refreshing: Bool) -> some View {
        HStack(spacing: TSSpacing.sm) {
            TSSelect(selection: selectionBinding, options: options(metrics))
                .accessibilityLabel(CMEView.text(ComputedMetricEditorAdapter.Text.metric))
            if refreshing { ProgressView().controlSize(.mini) }
        }
    }

    private var loadingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            CMEView.text(ComputedMetricEditorAdapter.Text.loadingMetrics)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var emptyHint: some View {
        CMEView.text(ComputedMetricEditorAdapter.Text.metricsEmpty)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func options(_ metrics: [ComputedMetricSummary]) -> [TSSelectOption<String>] {
        let prompt = TSSelectOption("", CMEView.key(ComputedMetricEditorAdapter.Text.metricPrompt))
        return [prompt] + metrics.map { metric in
            TSSelectOption(
                metric.id,
                CMEView.key(ComputedMetricEditorAdapter.metricNameText(id: metric.id, label: metric.label))
            )
        }
    }

    /// Web metric-select `value` + `onChange`: the controlled id, written through the
    /// `handleMetric` transform so window + operator default to the new metric's first.
    private var selectionBinding: Binding<String> {
        Binding(
            get: { value.metricID },
            set: { value = ComputedMetricEditorAdapter.selectMetric(value, metricID: $0, in: registry.metrics) }
        )
    }
}

// MARK: - Window field (web window `<UiSelect>`)

/// The aggregation-window select. Disabled until a metric is chosen (web
/// `disabled={!selected}`); options come from the selected metric's windows.
struct CMEWindowField: View {
    @Binding var value: ComputedMetricEditorValue
    let selected: ComputedMetricSummary?

    var body: some View {
        TSSelect(
            selection: selectionBinding,
            options: options,
            label: CMEView.key(ComputedMetricEditorAdapter.Text.window)
        )
        .disabled(selected == nil)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(CMEView.text(ComputedMetricEditorAdapter.Text.window))
    }

    private var options: [TSSelectOption<String>] {
        let prompt = TSSelectOption("", CMEView.key(ComputedMetricEditorAdapter.Text.windowPrompt))
        return [prompt] + ComputedMetricEditorAdapter.windows(for: selected).map { window in
            TSSelectOption(window, CMEView.key(ComputedMetricEditorAdapter.windowText(window)))
        }
    }

    private var selectionBinding: Binding<String> {
        Binding(
            get: { value.metricWindow },
            set: { value.metricWindow = $0 }
        )
    }
}

// MARK: - Operator field (web operator `<UiSelect>`)

/// The comparison-operator select. Disabled until a metric is chosen (web
/// `disabled={!selected}`); options come from the selected metric's ops, or the full
/// `ALL_OPS` fallback when nothing is selected.
struct CMEOperatorField: View {
    @Binding var value: ComputedMetricEditorValue
    let selected: ComputedMetricSummary?

    var body: some View {
        TSSelect(
            selection: selectionBinding,
            options: options,
            label: CMEView.key(ComputedMetricEditorAdapter.Text.op)
        )
        .disabled(selected == nil)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(CMEView.text(ComputedMetricEditorAdapter.Text.op))
    }

    private var options: [TSSelectOption<ComputedMetricEditorOp>] {
        ComputedMetricEditorAdapter.ops(for: selected).map { op in
            TSSelectOption(op, CMEView.key(ComputedMetricEditorAdapter.opText(op)))
        }
    }

    private var selectionBinding: Binding<ComputedMetricEditorOp> {
        Binding(
            get: { value.metricOp },
            set: { value.metricOp = $0 }
        )
    }
}

// MARK: - Threshold field (web `<UiInput type="number" step="any">`)

/// The numeric threshold input. The value is kept as the raw string for parity with
/// the web editor; the decimal keypad is offered on iOS.
struct CMEThresholdField: View {
    @Binding var value: ComputedMetricEditorValue

    var body: some View {
        TSTextField(
            CMEView.key(ComputedMetricEditorAdapter.Text.thresholdPrompt),
            text: thresholdBinding,
            label: CMEView.key(ComputedMetricEditorAdapter.Text.threshold)
        )
        .cmeNumericKeyboard()
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(CMEView.text(ComputedMetricEditorAdapter.Text.threshold))
    }

    private var thresholdBinding: Binding<String> {
        Binding(
            get: { value.metricThreshold },
            set: { value.metricThreshold = $0 }
        )
    }
}
