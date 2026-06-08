//
//  ConditionBuilder.Types.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  The value-typed model for the automation ConditionBuilder — the SwiftUI parity of
//  the web `AutomationConditionStepInput` discriminated union plus the option enums
//  (web `AutomationConditionKind` / `…SignalOp` / `…GeofenceState` /
//  `…OtherAutomationState`) and the `lib/signals.ts` catalog shapes. Everything here
//  is pure + Foundation-only (no SwiftUI, no store, no `Shared`); the transforms over
//  these types live in `ConditionBuilder.Adapter.swift`, and both are unit-tested.
//

import Foundation

// MARK: - Condition kind (web `AutomationConditionKind`)

/// The four automation condition kinds (web `AutomationConditionKind`). Raw values
/// are the wire/back-end discriminators; `CaseIterable` order matches the web
/// `CONDITION_TYPES` dropdown order.
public enum AutomationConditionKind: String, CaseIterable, Sendable, Equatable {
    case signal = "condition_signal"
    case timeWindow = "condition_time_window"
    case geofence = "condition_geofence"
    case otherAutomation = "condition_other_automation"

    /// The dropdown label key + web English fallback (web `CONDITION_TYPES[].labelKey`).
    public var label: LocalizedText {
        switch self {
        case .signal: LocalizedText("automations.conditions.signal", "Signal Check")
        case .timeWindow: LocalizedText("automations.conditions.timeWindow", "Time Window")
        case .geofence: LocalizedText("automations.conditions.geofence", "Geofence State")
        case .otherAutomation: LocalizedText("automations.conditions.otherAutomation", "Other Automation")
        }
    }
}

// MARK: - Signal operator (web `AutomationConditionSignalOp`)

/// The comparison operators a signal condition supports (web
/// `AutomationConditionSignalOp` / `CONDITION_SIGNAL_OPERATORS`). Declaration order
/// matches the web option order.
public enum AutomationConditionSignalOp: String, CaseIterable, Sendable, Equatable {
    case equals = "="
    case notEquals = "!="
    case lessThan = "<"
    case lessThanOrEqual = "<="
    case greaterThan = ">"
    case greaterThanOrEqual = ">="
    case between
    case inList = "in"

    /// Web `numericOnly`: operators that are filtered out for boolean signals.
    public var numericOnly: Bool {
        switch self {
        case .lessThan, .lessThanOrEqual, .greaterThan, .greaterThanOrEqual, .between: true
        case .equals, .notEquals, .inList: false
        }
    }

    /// The dropdown label key + web English fallback (web `CONDITION_SIGNAL_OPERATORS[].labelKey`).
    public var label: LocalizedText {
        switch self {
        case .equals: LocalizedText("automations.operators.equals", "=")
        case .notEquals: LocalizedText("automations.operators.notEquals", "!=")
        case .lessThan: LocalizedText("automations.operators.lessThan", "<")
        case .lessThanOrEqual: LocalizedText("automations.operators.lessThanOrEqual", "<=")
        case .greaterThan: LocalizedText("automations.operators.greaterThan", ">")
        case .greaterThanOrEqual: LocalizedText("automations.operators.greaterThanOrEqual", ">=")
        case .between: LocalizedText("automations.operators.between", "Between")
        case .inList: LocalizedText("automations.operators.in", "In")
        }
    }
}

// MARK: - Geofence + other-automation state (web unions)

/// Web `AutomationGeofenceState`.
public enum AutomationGeofenceState: String, CaseIterable, Sendable, Equatable {
    case inside
    case outside
    case dwell

    public var label: LocalizedText {
        switch self {
        case .inside: LocalizedText("automations.geofence.inside", "Inside")
        case .outside: LocalizedText("automations.geofence.outside", "Outside")
        case .dwell: LocalizedText("automations.geofence.dwell", "Dwell")
        }
    }
}

/// Web `AutomationOtherAutomationState`.
public enum AutomationOtherAutomationState: String, CaseIterable, Sendable, Equatable {
    case enabled
    case disabled
    case recentlyTriggered = "recently_triggered"

    public var label: LocalizedText {
        switch self {
        case .enabled: LocalizedText("automations.otherAutomation.enabled", "Enabled")
        case .disabled: LocalizedText("automations.otherAutomation.disabled", "Disabled")
        case .recentlyTriggered: LocalizedText("automations.otherAutomation.recentlyTriggered", "Recently Triggered")
        }
    }
}

// MARK: - i18n descriptor (key + web fallback)

/// A localization key paired with its web `t(key, fallback)` English default. Pure +
/// `Sendable` so the catalog data is testable; the view resolves it through `CBStrings`.
public struct LocalizedText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

// MARK: - Signal field catalog (web `lib/signals.ts`)

/// The value-type of a signal field (web `SignalFieldType`).
public enum SignalFieldType: String, Sendable, Equatable {
    case numeric
    case boolean
    case string
}

/// One selectable telemetry signal (web `SignalField`). `label` carries the i18n
/// descriptor (web labels are English literals in `lib/signals.ts`; routed through
/// the facade here so the native code holds no hardcoded strings).
public struct SignalField: Sendable, Equatable, Identifiable {
    public let key: String
    public let label: LocalizedText
    public let type: SignalFieldType

    public var id: String {
        key
    }

    public init(key: String, label: LocalizedText, type: SignalFieldType) {
        self.key = key
        self.label = label
        self.type = type
    }
}

// MARK: - Condition payloads (web discriminated union members)

/// Web `AutomationStepConditionSignal` (the value fields are mutually-exclusive per
/// the web coercion, mirrored by the factory helpers below).
public struct SignalCondition: Sendable, Equatable {
    public var signal: String
    public var op: AutomationConditionSignalOp
    public var valueNum: Double?
    public var valueText: String?
    public var valueBool: Bool?
    public var valueMin: Double?
    public var valueMax: Double?

    public init(
        signal: String,
        op: AutomationConditionSignalOp,
        valueNum: Double? = nil,
        valueText: String? = nil,
        valueBool: Bool? = nil,
        valueMin: Double? = nil,
        valueMax: Double? = nil
    ) {
        self.signal = signal
        self.op = op
        self.valueNum = valueNum
        self.valueText = valueText
        self.valueBool = valueBool
        self.valueMin = valueMin
        self.valueMax = valueMax
    }
}

/// Web `AutomationStepConditionTimeWindow`.
public struct TimeWindowCondition: Sendable, Equatable {
    public var startTime: String
    public var endTime: String
    public var timezone: String
    public var daysOfWeek: [Int]

    public init(startTime: String, endTime: String, timezone: String, daysOfWeek: [Int]) {
        self.startTime = startTime
        self.endTime = endTime
        self.timezone = timezone
        self.daysOfWeek = daysOfWeek
    }
}

/// Web `AutomationStepConditionGeofence`.
public struct GeofenceCondition: Sendable, Equatable {
    public var placeId: Int
    public var state: AutomationGeofenceState

    public init(placeId: Int, state: AutomationGeofenceState) {
        self.placeId = placeId
        self.state = state
    }
}

/// Web `AutomationStepConditionOtherAutomation`.
public struct OtherAutomationCondition: Sendable, Equatable {
    public var otherAutomationId: Int
    public var state: AutomationOtherAutomationState

    public init(otherAutomationId: Int, state: AutomationOtherAutomationState) {
        self.otherAutomationId = otherAutomationId
        self.state = state
    }
}

/// The discriminated condition body (web `AutomationConditionStepInput`).
public enum ConditionBody: Sendable, Equatable {
    case signal(SignalCondition)
    case timeWindow(TimeWindowCondition)
    case geofence(GeofenceCondition)
    case otherAutomation(OtherAutomationCondition)

    /// The web `condition.kind` discriminator.
    public var kind: AutomationConditionKind {
        switch self {
        case .signal: .signal
        case .timeWindow: .timeWindow
        case .geofence: .geofence
        case .otherAutomation: .otherAutomation
        }
    }

    public var asSignal: SignalCondition? {
        if case let .signal(value) = self { return value }
        return nil
    }

    public var asTimeWindow: TimeWindowCondition? {
        if case let .timeWindow(value) = self { return value }
        return nil
    }

    public var asGeofence: GeofenceCondition? {
        if case let .geofence(value) = self { return value }
        return nil
    }

    public var asOtherAutomation: OtherAutomationCondition? {
        if case let .otherAutomation(value) = self { return value }
        return nil
    }
}

/// An identified condition row for the SwiftUI editor list. The `id` is a view-only
/// identity (not part of the back-end payload, which is `body`); ForEach uses it so
/// in-flight field edits stay attached to the correct row across add/remove.
public struct AutomationConditionInput: Identifiable, Sendable, Equatable {
    public let id: UUID
    public var body: ConditionBody

    public init(id: UUID = UUID(), body: ConditionBody) {
        self.id = id
        self.body = body
    }
}
