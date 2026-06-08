//
//  ComputedMetricEditor.Types.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  The value-typed model for the computed-metric operand editor — the SwiftUI parity
//  of the web `ComputedMetricEditorValue` plus the `api/types` shapes it threads
//  (`ComputedMetricOp`, `ComputedMetricSummary`, `ComputedMetricPreview`) and the
//  preview request payload (`usePreviewComputedMetric` body). Everything here is pure
//  + Foundation-only (no SwiftUI, no store, no `Shared`); the transforms over these
//  types live in `ComputedMetricEditor.Adapter.swift`, and both are unit-tested. The
//  shared `LocalizedText` descriptor (defined once for the feature-views module) is
//  reused — not redefined.
//

import Foundation

// MARK: - Operator (web `ComputedMetricOp`)

/// The eight comparison operators a computed-metric rule supports (web
/// `ComputedMetricOp`). Raw values are the wire discriminators; `CaseIterable` order
/// matches the web `ALL_OPS` array so the fallback operator dropdown lists identically.
public enum ComputedMetricOp: String, CaseIterable, Sendable, Equatable {
    case greaterThan = ">"
    case greaterThanOrEqual = ">="
    case lessThan = "<"
    case lessThanOrEqual = "<="
    case equal = "="
    case notEqual = "!="
    case percentChangeGreater = "%_change_>"
    case percentChangeLess = "%_change_<"
}

// MARK: - Metric registry entry (web `ComputedMetricSummary`)

/// One selectable computed metric from the registry (web `ComputedMetricSummary`):
/// the id, the human label, the value `unit` (drives the preview suffix), the allowed
/// aggregation `windows`, and the allowed `ops`. The native list binds through the
/// P1/S8 registry source (web `useAlertMetrics`, GET `/alerts/metrics`).
public struct ComputedMetricSummary: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let unit: String
    public let windows: [String]
    public let ops: [ComputedMetricOp]

    public init(id: String, label: String, unit: String, windows: [String], ops: [ComputedMetricOp]) {
        self.id = id
        self.label = label
        self.unit = unit
        self.windows = windows
        self.ops = ops
    }
}

// MARK: - Editor value (web `ComputedMetricEditorValue`)

/// The controlled editor state (web `ComputedMetricEditorValue`). The parent owns it
/// and threads change events back through the SwiftUI `Binding` (the web `onChange`
/// prop). `metricThreshold` is kept as the raw input string for parity with the rest
/// of the web editor; it is parsed only for readiness + the preview request.
public struct ComputedMetricEditorValue: Sendable, Equatable {
    public var metricID: String
    public var metricWindow: String
    public var metricOp: ComputedMetricOp
    public var metricThreshold: String
    public var vehicleID: Int?

    public init(
        metricID: String = "",
        metricWindow: String = "",
        metricOp: ComputedMetricOp = .greaterThan,
        metricThreshold: String = "",
        vehicleID: Int? = nil
    ) {
        self.metricID = metricID
        self.metricWindow = metricWindow
        self.metricOp = metricOp
        self.metricThreshold = metricThreshold
        self.vehicleID = vehicleID
    }
}

// MARK: - Preview request (web `usePreviewComputedMetric` body)

/// The resolved preview request the model hands to the runner — the native mirror of
/// the web `previewMut.mutate({ metric_id, metric_window, metric_op, metric_threshold,
/// vehicle_id })` payload (the runner prepends `kind: 'computed_metric'`). The
/// threshold is the parsed numeric value (web `parseFloat`).
public struct ComputedMetricPreviewRequest: Sendable, Equatable {
    public let metricID: String
    public let metricWindow: String
    public let metricOp: ComputedMetricOp
    public let metricThreshold: Double
    public let vehicleID: Int?

    public init(
        metricID: String,
        metricWindow: String,
        metricOp: ComputedMetricOp,
        metricThreshold: Double,
        vehicleID: Int?
    ) {
        self.metricID = metricID
        self.metricWindow = metricWindow
        self.metricOp = metricOp
        self.metricThreshold = metricThreshold
        self.vehicleID = vehicleID
    }
}

// MARK: - Preview result (web `ComputedMetricPreview`)

/// The settled preview value (web `ComputedMetricPreview`): the metric's current
/// `value`, the `wouldTrigger` verdict the preview line renders, and the optional
/// `previousValue` / `percentChange` the percent-change operators report.
public struct ComputedMetricPreviewResult: Sendable, Equatable {
    public let value: Double
    public let wouldTrigger: Bool
    public let previousValue: Double?
    public let percentChange: Double?

    public init(value: Double, wouldTrigger: Bool, previousValue: Double? = nil, percentChange: Double? = nil) {
        self.value = value
        self.wouldTrigger = wouldTrigger
        self.previousValue = previousValue
        self.percentChange = percentChange
    }
}
