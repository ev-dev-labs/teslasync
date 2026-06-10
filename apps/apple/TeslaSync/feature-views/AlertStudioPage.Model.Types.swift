//
//  AlertStudioPage.Model.Types.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The wire-shaped value types the AlertStudioPage surface reads/writes — the
//  vehicle selection, the vehicle / channel / computed-metric projections, the
//  persisted `ASAlertRule`, the `ASAlertRuleInput` write payload, the test +
//  snooze requests, and the `EditorState` the rule builder edits. No SwiftUI, no I/O.
//

import Foundation

// MARK: - Domain value types (projections of the S8 holders / wire shapes)

/// Discriminated-union vehicle selection (web `VehicleSelection`). Sticky-all means
/// "current + future fleet"; specific is an explicit subset that does NOT auto-grow.
public enum ASVehicleSelection: Sendable, Equatable {
    case allSticky
    case specific(vehicleIDs: [Int64])
}

/// Minimal vehicle projection the multi-select reads (web `Vehicle` → `{ id,
/// display_name }`).
public struct ASVehicle: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let displayName: String

    public init(id: Int64, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

/// Minimal notification-channel projection the test-target chips read (web
/// `NotificationChannel` → `{ id, name, kind }`).
public struct ASNotificationChannel: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    public let kind: String

    public init(id: Int64, name: String, kind: String) {
        self.id = id
        self.name = name
        self.kind = kind
    }
}

/// Computed-metric registry summary (web `ComputedMetricSummary`).
public struct ASComputedMetricSummary: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let unit: String
    public let windows: [String]
    public let ops: [ASComputedMetricOp]

    public init(id: String, label: String, unit: String, windows: [String], ops: [ASComputedMetricOp]) {
        self.id = id
        self.label = label
        self.unit = unit
        self.windows = windows
        self.ops = ops
    }
}

/// A persisted alert rule (web `AlertRule` read shape from `GET /alerts/rules`). Only
/// the fields the page reads are carried; nullable wire fields are optionals.
public struct ASAlertRule: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let name: String
    public let enabled: Bool
    public let allVehicles: Bool?
    public let vehicleIDs: [Int64]?
    public let vehicleID: Int64?
    public let signalName: String
    public let op: ASRuleOp
    public let valueNum: Double?
    public let valueText: String?
    public let valueBool: Bool?
    public let valueMin: Double?
    public let valueMax: Double?
    public let severity: ASSeverity
    public let cooldownMin: Int
    public let triggerMode: ASTriggerMode
    public let snoozedUntil: String?
    public let kind: ASRuleKind?
    public let metricID: String?
    public let metricWindow: String?
    public let metricThreshold: Double?
    public let metricOp: ASComputedMetricOp?
    public let maxFiresPerResolution: Int?
    public let escalationAfterMin: Int?
    public let escalationSeverity: ASSeverity?
    public let msgTemplate: String?
    public let includeTitle: Bool?
    public let updatedAt: String?

    public init(
        id: Int64,
        name: String,
        enabled: Bool,
        signalName: String,
        op: ASRuleOp,
        severity: ASSeverity,
        cooldownMin: Int,
        triggerMode: ASTriggerMode,
        allVehicles: Bool? = nil,
        vehicleIDs: [Int64]? = nil,
        vehicleID: Int64? = nil,
        valueNum: Double? = nil,
        valueText: String? = nil,
        valueBool: Bool? = nil,
        valueMin: Double? = nil,
        valueMax: Double? = nil,
        snoozedUntil: String? = nil,
        kind: ASRuleKind? = nil,
        metricID: String? = nil,
        metricWindow: String? = nil,
        metricThreshold: Double? = nil,
        metricOp: ASComputedMetricOp? = nil,
        maxFiresPerResolution: Int? = nil,
        escalationAfterMin: Int? = nil,
        escalationSeverity: ASSeverity? = nil,
        msgTemplate: String? = nil,
        includeTitle: Bool? = nil,
        updatedAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.enabled = enabled
        self.signalName = signalName
        self.op = op
        self.severity = severity
        self.cooldownMin = cooldownMin
        self.triggerMode = triggerMode
        self.allVehicles = allVehicles
        self.vehicleIDs = vehicleIDs
        self.vehicleID = vehicleID
        self.valueNum = valueNum
        self.valueText = valueText
        self.valueBool = valueBool
        self.valueMin = valueMin
        self.valueMax = valueMax
        self.snoozedUntil = snoozedUntil
        self.kind = kind
        self.metricID = metricID
        self.metricWindow = metricWindow
        self.metricThreshold = metricThreshold
        self.metricOp = metricOp
        self.maxFiresPerResolution = maxFiresPerResolution
        self.escalationAfterMin = escalationAfterMin
        self.escalationSeverity = escalationSeverity
        self.msgTemplate = msgTemplate
        self.includeTitle = includeTitle
        self.updatedAt = updatedAt
    }
}

/// The `POST/PUT /alerts/rules` write payload (web `AlertRuleInput`). `buildSavePayload`
/// in the adapter produces this; the optionals model the wire nullability exactly.
public struct ASAlertRuleInput: Sendable, Equatable {
    public var id: Int64?
    public var name: String
    public var enabled: Bool
    public var allVehicles: Bool
    public var vehicleIDs: [Int64]
    public var signalName: String?
    public var op: ASRuleOp?
    public var valueNum: Double?
    public var valueText: String?
    public var valueBool: Bool?
    public var valueMin: Double?
    public var valueMax: Double?
    public var severity: ASSeverity
    public var cooldownMin: Int
    public var triggerMode: ASTriggerMode
    public var maxFiresPerResolution: Int?
    public var escalationAfterMin: Int?
    public var escalationSeverity: ASSeverity?
    public var kind: ASRuleKind
    public var metricID: String?
    public var metricWindow: String?
    public var metricOp: ASComputedMetricOp?
    public var metricThreshold: Double?
    public var msgTemplate: String?
    public var includeTitle: Bool

    public init(
        id: Int64? = nil,
        name: String,
        enabled: Bool,
        allVehicles: Bool,
        vehicleIDs: [Int64],
        severity: ASSeverity,
        cooldownMin: Int,
        triggerMode: ASTriggerMode,
        kind: ASRuleKind,
        includeTitle: Bool,
        signalName: String? = nil,
        op: ASRuleOp? = nil,
        valueNum: Double? = nil,
        valueText: String? = nil,
        valueBool: Bool? = nil,
        valueMin: Double? = nil,
        valueMax: Double? = nil,
        maxFiresPerResolution: Int? = nil,
        escalationAfterMin: Int? = nil,
        escalationSeverity: ASSeverity? = nil,
        metricID: String? = nil,
        metricWindow: String? = nil,
        metricOp: ASComputedMetricOp? = nil,
        metricThreshold: Double? = nil,
        msgTemplate: String? = nil
    ) {
        self.id = id
        self.name = name
        self.enabled = enabled
        self.allVehicles = allVehicles
        self.vehicleIDs = vehicleIDs
        self.severity = severity
        self.cooldownMin = cooldownMin
        self.triggerMode = triggerMode
        self.kind = kind
        self.includeTitle = includeTitle
        self.signalName = signalName
        self.op = op
        self.valueNum = valueNum
        self.valueText = valueText
        self.valueBool = valueBool
        self.valueMin = valueMin
        self.valueMax = valueMax
        self.maxFiresPerResolution = maxFiresPerResolution
        self.escalationAfterMin = escalationAfterMin
        self.escalationSeverity = escalationSeverity
        self.metricID = metricID
        self.metricWindow = metricWindow
        self.metricOp = metricOp
        self.metricThreshold = metricThreshold
        self.msgTemplate = msgTemplate
    }
}

/// Web `AlertTestTarget` — which channels a test notification fans out to.
public struct ASAlertTestTarget: Sendable, Equatable {
    public var allChannels: Bool?
    public var channelIDs: [Int64]?

    public init(allChannels: Bool? = nil, channelIDs: [Int64]? = nil) {
        self.allChannels = allChannels
        self.channelIDs = channelIDs
    }
}

/// Web `AlertTestRequest` — the Test-Rule body the editor previews with.
public struct ASAlertTestRequest: Sendable, Equatable {
    public var message: String
    public var msgTemplate: String?
    public var includeTitle: Bool
    public var target: ASAlertTestTarget?

    public init(message: String, msgTemplate: String?, includeTitle: Bool, target: ASAlertTestTarget?) {
        self.message = message
        self.msgTemplate = msgTemplate
        self.includeTitle = includeTitle
        self.target = target
    }
}

// MARK: - Editor state (web `EditorState`)

/// The full in-editor rule state (web `EditorState`). String-typed numeric fields
/// mirror the web `<UiInput type="number">` emitting strings; conversion to the wire
/// shape happens in `buildSavePayload`. `Equatable` so the view-model can compute the
/// dirty flag (web `JSON.stringify(editor) !== initial`).
public struct EditorState: Sendable, Equatable {
    public var id: Int64?
    public var name: String
    public var enabled: Bool
    public var vehicleSelection: ASVehicleSelection
    public var signalName: String
    public var op: ASRuleOp
    public var valueKind: ASValueKind
    public var valueNum: String
    public var valueText: String
    public var valueBool: Bool
    public var valueMin: String
    public var valueMax: String
    public var severity: ASSeverity
    public var cooldownMin: Int
    public var triggerMode: ASTriggerSelection
    public var maxFiresPerResolution: String
    public var escalationEnabled: Bool
    public var escalationAfterMin: String
    /// `nil` is the web `''` (no severity chosen yet); Save blocks until set when
    /// escalation is enabled.
    public var escalationSeverity: ASSeverity?
    public var message: String
    public var msgTemplate: String
    public var includeTitle: Bool
    public var kind: ASRuleKind
    public var metricID: String
    public var metricWindow: String
    public var metricOp: ASComputedMetricOp
    public var metricThreshold: String

    public init(
        id: Int64? = nil,
        name: String = "",
        enabled: Bool = true,
        vehicleSelection: ASVehicleSelection = .allSticky,
        signalName: String = "",
        op: ASRuleOp = .equal,
        valueKind: ASValueKind = .number,
        valueNum: String = "",
        valueText: String = "",
        valueBool: Bool = true,
        valueMin: String = "",
        valueMax: String = "",
        severity: ASSeverity = .warn,
        cooldownMin: Int = 15,
        triggerMode: ASTriggerSelection = .unset,
        maxFiresPerResolution: String = "",
        escalationEnabled: Bool = false,
        escalationAfterMin: String = "",
        escalationSeverity: ASSeverity? = nil,
        message: String = "",
        msgTemplate: String = "",
        includeTitle: Bool = true,
        kind: ASRuleKind = .signal,
        metricID: String = "",
        metricWindow: String = "",
        metricOp: ASComputedMetricOp = .greaterThan,
        metricThreshold: String = ""
    ) {
        self.id = id
        self.name = name
        self.enabled = enabled
        self.vehicleSelection = vehicleSelection
        self.signalName = signalName
        self.op = op
        self.valueKind = valueKind
        self.valueNum = valueNum
        self.valueText = valueText
        self.valueBool = valueBool
        self.valueMin = valueMin
        self.valueMax = valueMax
        self.severity = severity
        self.cooldownMin = cooldownMin
        self.triggerMode = triggerMode
        self.maxFiresPerResolution = maxFiresPerResolution
        self.escalationEnabled = escalationEnabled
        self.escalationAfterMin = escalationAfterMin
        self.escalationSeverity = escalationSeverity
        self.message = message
        self.msgTemplate = msgTemplate
        self.includeTitle = includeTitle
        self.kind = kind
        self.metricID = metricID
        self.metricWindow = metricWindow
        self.metricOp = metricOp
        self.metricThreshold = metricThreshold
    }

    /// Web `freshEditor()` — a brand-new rule in the tri-state "unset" trigger mode.
    public static func fresh() -> EditorState {
        EditorState()
    }
}
