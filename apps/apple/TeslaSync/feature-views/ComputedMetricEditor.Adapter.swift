//
//  ComputedMetricEditor.Adapter.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The testable transform core for the computed-metric operand editor — the SwiftUI
//  parity of web/src/features/notifications/components/ComputedMetricEditor.tsx. Pure
//  + Foundation-only (no SwiftUI, no store, no `Shared`): the operator label/key
//  switches (web `opLabel` / `opKey`), the unit suffix map (web `unitSuffix`), the
//  readiness predicate (web `ready`), the `parseFloat` threshold parse, the
//  metric-change handler (web `handleMetric`), the value formatter (web
//  `fmtNumber(value, 2)`), and the preview-line interpolation (web `previewValue`
//  template) are all unit-tested in isolation. The static i18n descriptors carry the
//  exact web `t(key, fallback)` pairs so a shared catalog resolves identically.
//

import Foundation

// MARK: - The pure adapter (web helper + handler ports)

/// The pure transform core. Every function mirrors a specific web expression so the
/// native editor produces byte-identical payloads + copy; each is unit-tested.
public enum ComputedMetricEditorAdapter {
    /// Web `ALL_OPS` — the fallback operator list (declaration order preserved).
    public static let allOps: [ComputedMetricEditorOp] = ComputedMetricEditorOp.allCases

    // MARK: Operator label / key (web `opLabel` / `opKey`)

    /// Web `opLabel(op)`: the percent-change operators get a spaced label; every other
    /// operator renders its raw symbol.
    public static func opLabel(_ op: ComputedMetricEditorOp) -> String {
        switch op {
        case .percentChangeGreater: "% change >"
        case .percentChangeLess: "% change <"
        default: op.rawValue
        }
    }

    /// Web `opKey(op)`: the i18n sub-key for an operator (`metricOps.<key>`).
    public static func opKey(_ op: ComputedMetricEditorOp) -> String {
        switch op {
        case .greaterThan: "gt"
        case .greaterThanOrEqual: "gte"
        case .lessThan: "lt"
        case .lessThanOrEqual: "lte"
        case .equal: "eq"
        case .notEqual: "neq"
        case .percentChangeGreater: "pctGt"
        case .percentChangeLess: "pctLt"
        }
    }

    // MARK: Unit suffix (web `unitSuffix`)

    /// Web `unitSuffix(unit)`: the display suffix appended to the preview value.
    public static func unitSuffix(_ unit: String) -> String {
        switch unit {
        case "currency": ""
        case "currency_per_mi": "/mi"
        case "kwh": "kWh"
        case "wh_per_mi": "Wh/mi"
        case "mi": "mi"
        case "km": "km"
        case "h": "h"
        case "count": ""
        case "%": "%"
        default: unit
        }
    }

    // MARK: Selection helpers (web `selected` / `windowOptions` / `opOptions`)

    /// Web `metrics.find(m => m.id === value.metric_id)`.
    public static func selectedMetric(in metrics: [ComputedMetricSummary], id: String) -> ComputedMetricSummary? {
        metrics.first { $0.id == id }
    }

    /// Web `selected?.windows ?? []`.
    public static func windows(for metric: ComputedMetricSummary?) -> [String] {
        metric?.windows ?? []
    }

    /// Web `selected?.ops ?? ALL_OPS`.
    public static func ops(for metric: ComputedMetricSummary?) -> [ComputedMetricEditorOp] {
        metric?.ops ?? allOps
    }

    // MARK: i18n descriptors (web `t(key, fallback)` pairs)

    /// Web `t('notifications.alertStudio.metricNames.<id>', m.label)`.
    public static func metricNameText(id: String, label: String) -> LocalizedText {
        LocalizedText("notifications.alertStudio.metricNames.\(id)", label)
    }

    /// Web `t('notifications.alertStudio.metricWindows.<w>', w)`.
    public static func windowText(_ window: String) -> LocalizedText {
        LocalizedText("notifications.alertStudio.metricWindows.\(window)", window)
    }

    /// Web `t('notifications.alertStudio.metricOps.<opKey>', opLabel)`.
    public static func opText(_ op: ComputedMetricEditorOp) -> LocalizedText {
        LocalizedText("notifications.alertStudio.metricOps.\(opKey(op))", opLabel(op))
    }

    // MARK: Readiness + request (web `ready` / `previewMut.mutate`)

    /// Web `ready`: a metric + window are chosen and the threshold parses to a finite
    /// number. The operator is always set (a non-optional enum), mirroring the web
    /// `!!metric_op` always-truthy check for the editor's controlled value.
    public static func isReady(_ value: ComputedMetricEditorValue) -> Bool {
        !value.metricID.isEmpty && !value.metricWindow.isEmpty && parseThreshold(value.metricThreshold) != nil
    }

    /// Web `Number.parseFloat(metric_threshold)` guarded by `Number.isFinite`: the
    /// leading number of the raw string, or `nil` when it is empty / non-numeric /
    /// non-finite (so readiness fails exactly as the web does).
    public static func parseThreshold(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let scanner = Scanner(string: trimmed)
        scanner.charactersToBeSkipped = .whitespaces
        guard let parsed = scanner.scanDouble(), parsed.isFinite else { return nil }
        return parsed
    }

    /// The resolved preview request (web `previewMut.mutate({...})`), or `nil` when the
    /// editor is not ready. `vehicle_id` is threaded through unchanged.
    public static func makeRequest(from value: ComputedMetricEditorValue) -> ComputedMetricPreviewRequest? {
        guard let threshold = parseThreshold(value.metricThreshold),
              !value.metricID.isEmpty, !value.metricWindow.isEmpty
        else { return nil }
        return ComputedMetricPreviewRequest(
            metricID: value.metricID,
            metricWindow: value.metricWindow,
            metricOp: value.metricOp,
            metricThreshold: threshold,
            vehicleID: value.vehicleID
        )
    }

    // MARK: Metric change (web `handleMetric`)

    /// Web `handleMetric(id)`: select the metric, default its window to the first
    /// available (else clear it), and default its operator to the first available
    /// (else keep the current operator).
    public static func selectMetric(
        _ value: ComputedMetricEditorValue,
        metricID id: String,
        in metrics: [ComputedMetricSummary]
    ) -> ComputedMetricEditorValue {
        let def = selectedMetric(in: metrics, id: id)
        var next = value
        next.metricID = id
        next.metricWindow = def?.windows.first ?? ""
        if let firstOp = def?.ops.first {
            next.metricOp = firstOp
        }
        return next
    }

    // MARK: Value formatting (web `fmtNumber(value, 2)`)

    /// Web `fmtNumber(value, 2)`: locale-grouped decimal with exactly two fraction
    /// digits. Non-finite input collapses to `0` (web `safeNumber`).
    public static func formatValue(_ value: Double, fractionDigits: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(fractionDigits)f", safe)
    }

    // MARK: Preview line (web `previewValue` template)

    /// Web `previewSuffix ? ' ' + previewSuffix : ''`: the unit suffix with a leading
    /// space, or empty when there is no selected metric / no suffix for the unit.
    public static func suffixToken(forUnit unit: String?) -> String {
        guard let unit else { return "" }
        let suffix = unitSuffix(unit)
        return suffix.isEmpty ? "" : " " + suffix
    }

    /// Web verdict: `would_trigger ? t('…would', '') : t('…wouldNot', 'NOT')`.
    public static func verdict(wouldTrigger: Bool, would: String, wouldNot: String) -> String {
        wouldTrigger ? would : wouldNot
    }

    /// Web `previewValue` interpolation over the resolved template — substitutes the
    /// `{{value}}`, `{{suffix}}`, and `{{verdict}}` tokens.
    public static func previewLine(template: String, valueText: String, suffix: String, verdict: String) -> String {
        template
            .replacingOccurrences(of: "{{value}}", with: valueText)
            .replacingOccurrences(of: "{{suffix}}", with: suffix)
            .replacingOccurrences(of: "{{verdict}}", with: verdict)
    }

    /// Composes the full preview line from a settled result + the resolved chrome
    /// strings (web `t('previewValue', …, { value, suffix, verdict })`).
    public static func previewLine(
        template: String,
        result: ComputedMetricPreviewResult,
        unit: String?,
        would: String,
        wouldNot: String,
        locale: Locale = .current
    ) -> String {
        previewLine(
            template: template,
            valueText: formatValue(result.value, locale: locale),
            suffix: suffixToken(forUnit: unit),
            verdict: verdict(wouldTrigger: result.wouldTrigger, would: would, wouldNot: wouldNot)
        )
    }
}

// MARK: - Static i18n descriptors (web `t(key, fallback)` catalog)

public extension ComputedMetricEditorAdapter {
    /// The fixed-key i18n descriptors the surface resolves, each carrying its web
    /// `t(key, fallback)` English default. Dynamic keys (metric names / windows /
    /// operators) are built by the helpers above. Group 1 mirrors the web source
    /// verbatim; group 2 backs the native HIG states contract (freshness / errors /
    /// offline / retry) the web parent handled around this component.
    enum Text {
        // Group 1 — web `notifications.alertStudio.computedMetric.*`
        public static let metric = LocalizedText("notifications.alertStudio.computedMetric.metric", "Metric")
        public static let loadingMetrics = LocalizedText(
            "notifications.alertStudio.computedMetric.loading",
            "Loading metrics…"
        )
        /// The empty-choice prompts keep the web key names verbatim for catalog parity.
        public static let metricPrompt = LocalizedText(
            "notifications.alertStudio.computedMetric.metricPlaceholder", // parity:allow source key name
            "Choose a metric"
        )
        public static let window = LocalizedText("notifications.alertStudio.computedMetric.window", "Window")
        public static let windowPrompt = LocalizedText(
            "notifications.alertStudio.computedMetric.windowPlaceholder", // parity:allow source key name
            "Choose a window"
        )
        public static let op = LocalizedText("notifications.alertStudio.computedMetric.op", "Operator")
        public static let threshold = LocalizedText("notifications.alertStudio.computedMetric.threshold", "Threshold")
        public static let thresholdPrompt = LocalizedText(
            "notifications.alertStudio.computedMetric.thresholdPlaceholder", // parity:allow source key name
            "e.g. 200"
        )
        public static let preview = LocalizedText("notifications.alertStudio.computedMetric.preview", "Live preview")
        public static let previewIdle = LocalizedText(
            "notifications.alertStudio.computedMetric.previewIdle",
            "Pick a metric, window, operator, and threshold to preview."
        )
        public static let previewLoading = LocalizedText(
            "notifications.alertStudio.computedMetric.previewLoading",
            "Computing…"
        )
        public static let previewValue = LocalizedText(
            "notifications.alertStudio.computedMetric.previewValue",
            "Right now this metric is {{value}}{{suffix}} — would {{verdict}} fire."
        )
        public static let would = LocalizedText("notifications.alertStudio.computedMetric.would", "")
        public static let wouldNot = LocalizedText("notifications.alertStudio.computedMetric.wouldNot", "NOT")

        // Group 2 — native HIG state chrome (freshness / empty / error / offline / retry)
        public static let live = LocalizedText("notifications.alertStudio.computedMetric.live", "Live")
        public static let stale = LocalizedText("notifications.alertStudio.computedMetric.stale", "Stale")
        public static let offline = LocalizedText("notifications.alertStudio.computedMetric.offline", "Offline")
        public static let metricsEmpty = LocalizedText(
            "notifications.alertStudio.computedMetric.metricsEmpty",
            "No metrics available yet."
        )
        public static let metricsError = LocalizedText(
            "notifications.alertStudio.computedMetric.metricsError",
            "Couldn't load metrics"
        )
        public static let metricsOffline = LocalizedText(
            "notifications.alertStudio.computedMetric.metricsOffline",
            "Offline — showing no metrics"
        )
        public static let previewOffline = LocalizedText(
            "notifications.alertStudio.computedMetric.previewOffline",
            "Offline — showing the last preview"
        )
        public static let retry = LocalizedText("notifications.alertStudio.computedMetric.retry", "Retry")
    }
}
