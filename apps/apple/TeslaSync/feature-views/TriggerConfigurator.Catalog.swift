//
//  TriggerConfigurator.Catalog.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  The static option catalogs ported verbatim from
//  features/automations/pages/TriggerConfigurator.tsx: the vehicle-event list, the
//  geofence-event list, the signal-operator list, the signal-field list (+ the boolean
//  key set), the timezone list, and the weekday short labels. Each option carries the
//  web `labelKey` + English `fallback` so the view resolves it through the P1/S10 facade
//  rather than holding a literal. Pure data — no SwiftUI, no networking.
//

import Foundation

// MARK: - Generic option descriptor

/// One selectable option: its typed `value` plus the i18n `labelKey` and English
/// `fallback` the web option array carries (web `{ value, labelKey, fallback }`).
public struct TriggerOption<Value: Hashable & Sendable>: Sendable, Identifiable {
    public let value: Value
    public let labelKey: String
    public let fallback: String

    public var id: Value {
        value
    }

    public init(_ value: Value, _ labelKey: String, _ fallback: String) {
        self.value = value
        self.labelKey = labelKey
        self.fallback = fallback
    }
}

// MARK: - Vehicle event (web VEHICLE_EVENTS / AutomationEventType)

/// The vehicle events a `trigger_event` can fire on (web `AutomationEventType`). The raw
/// value is the wire discriminator.
public enum VehicleEventType: String, Sendable, Equatable, CaseIterable {
    case driveStart = "drive_start"
    case driveEnd = "drive_end"
    case chargeStart = "charge_start"
    case chargeEnd = "charge_end"
    case sleepStart = "sleep_start"
    case sleepEnd = "sleep_end"
    case online
    case offline
    case sentryAlert = "sentry_alert"
}

public enum VehicleEventCatalog {
    /// Web `VEHICLE_EVENTS` — ordered list with the i18n key + English fallback.
    public static let all: [TriggerOption<VehicleEventType>] = [
        TriggerOption(.driveStart, "automations.events.driveStart", "Drive Starts"),
        TriggerOption(.driveEnd, "automations.events.driveEnd", "Drive Ends"),
        TriggerOption(.chargeStart, "automations.events.chargeStart", "Charging Starts"),
        TriggerOption(.chargeEnd, "automations.events.chargeEnd", "Charging Ends"),
        TriggerOption(.sleepStart, "automations.events.sleepStart", "Sleep Starts"),
        TriggerOption(.sleepEnd, "automations.events.sleepEnd", "Sleep Ends"),
        TriggerOption(.online, "automations.events.online", "Comes Online"),
        TriggerOption(.offline, "automations.events.offline", "Goes Offline"),
        TriggerOption(.sentryAlert, "automations.events.sentryAlert", "Sentry Alert")
    ]
}

// MARK: - Geofence event (web GEOFENCE_EVENTS / AutomationGeofenceEvent)

/// The geofence transition events the picker offers (web `GEOFENCE_EVENTS`). The wider
/// `AutomationGeofenceEvent` union also allows `leave` / `both`, parsed but not listed.
public enum GeofenceEvent: String, Sendable, Equatable, CaseIterable {
    case enter
    case exit
    case leave
    case both
    case dwell

    /// Parses a wire value, falling back to `enter` for an unknown string.
    public static func parse(_ raw: String) -> GeofenceEvent {
        GeofenceEvent(rawValue: raw) ?? .enter
    }
}

public enum GeofenceEventCatalog {
    /// Web `GEOFENCE_EVENTS` — only enter / exit / dwell are offered in the dropdown.
    public static let all: [TriggerOption<GeofenceEvent>] = [
        TriggerOption(.enter, "automations.geofence.enter", "Enter"),
        TriggerOption(.exit, "automations.geofence.exit", "Exit"),
        TriggerOption(.dwell, "automations.geofence.dwell", "Dwell")
    ]

    /// The default dwell window the web applies when switching to the dwell event
    /// (`trigger.dwell_minutes ?? 5`).
    public static let defaultDwellMinutes = 5
    public static let dwellRange = 1 ... 60
}

// MARK: - Signal operator (web SIGNAL_OPERATORS / AutomationTriggerSignalOp)

/// The comparison operators for a `trigger_signal` (web `AutomationTriggerSignalOp`).
public enum SignalOperator: String, Sendable, Equatable, CaseIterable {
    case equals = "="
    case notEquals = "!="
    case lessThan = "<"
    case lessThanOrEqual = "<="
    case greaterThan = ">"
    case greaterThanOrEqual = ">="
    case changed
    case crossedAbove = "crossed_above"
    case crossedBelow = "crossed_below"
}

public enum SignalOperatorCatalog {
    /// Web `SIGNAL_OPERATORS` — ordered list with the i18n key + English fallback.
    public static let all: [TriggerOption<SignalOperator>] = [
        TriggerOption(.equals, "automations.operators.equals", "="),
        TriggerOption(.notEquals, "automations.operators.notEquals", "!="),
        TriggerOption(.lessThan, "automations.operators.lessThan", "<"),
        TriggerOption(.lessThanOrEqual, "automations.operators.lessThanOrEqual", "<="),
        TriggerOption(.greaterThan, "automations.operators.greaterThan", ">"),
        TriggerOption(.greaterThanOrEqual, "automations.operators.greaterThanOrEqual", ">="),
        TriggerOption(.changed, "automations.operators.changed", "Changed"),
        TriggerOption(.crossedAbove, "automations.operators.crossedAbove", "Crossed Above"),
        TriggerOption(.crossedBelow, "automations.operators.crossedBelow", "Crossed Below")
    ]
}

// MARK: - Signal fields (web SIGNAL_FIELDS / SIGNAL_FIELD_OPTIONS / BOOL_FIELD_KEYS)

/// The data type of a signal field (web `TriggerConfiguratorSignalFieldType`).
public enum TriggerConfiguratorSignalFieldType: String, Sendable, Equatable {
    case numeric
    case boolean
    case string
}

public enum SignalCatalog {
    /// Web `SIGNAL_FIELDS` — the key, the i18n label key + English fallback, and the type.
    /// The web `SIGNAL_FIELD_OPTIONS` uses `f.label` directly; the native surface routes
    /// the same display text through the facade so no English literal lives in the view.
    public static let fields: [(option: TriggerOption<String>, type: TriggerConfiguratorSignalFieldType)] = [
        (TriggerOption("battery_level", "automations.signals.battery_level", "Battery Level"), .numeric),
        (TriggerOption("inside_temp", "automations.signals.inside_temp", "Inside Temperature"), .numeric),
        (TriggerOption("outside_temp", "automations.signals.outside_temp", "Outside Temperature"), .numeric),
        (TriggerOption("speed", "automations.signals.speed", "Speed"), .numeric),
        (TriggerOption("is_locked", "automations.signals.is_locked", "Is Locked"), .boolean),
        (TriggerOption("is_charging", "automations.signals.is_charging", "Is Charging"), .boolean),
        (TriggerOption("is_climate_on", "automations.signals.is_climate_on", "Climate On"), .boolean),
        (TriggerOption("sentry_mode", "automations.signals.sentry_mode", "Sentry Mode"), .boolean),
        (TriggerOption("state", "automations.signals.state", "Vehicle State"), .string)
    ]

    /// Web `SIGNAL_FIELD_OPTIONS`.
    public static var options: [TriggerOption<String>] {
        fields.map(\.option)
    }

    /// Web `BOOL_FIELD_KEYS` — the keys whose value is a boolean.
    public static let boolFieldKeys: Set<String> = Set(
        fields.filter { $0.type == .boolean }.map(\.option.value)
    )
}

// MARK: - Timezones (web COMMON_TIMEZONES)

public enum TimezoneCatalog {
    /// Web `COMMON_TIMEZONES`. The web key is `timezones.${value || 'utc'}`; the empty
    /// value maps to the `utc` key. The value is the IANA identifier persisted on the wire.
    public static let all: [TriggerOption<String>] = [
        TriggerOption("", "timezones.utc", "UTC (Default)"),
        TriggerOption("America/New_York", "timezones.America/New_York", "Eastern (US)"),
        TriggerOption("America/Chicago", "timezones.America/Chicago", "Central (US)"),
        TriggerOption("America/Denver", "timezones.America/Denver", "Mountain (US)"),
        TriggerOption("America/Los_Angeles", "timezones.America/Los_Angeles", "Pacific (US)"),
        TriggerOption("Europe/London", "timezones.Europe/London", "London (UK)"),
        TriggerOption("Europe/Berlin", "timezones.Europe/Berlin", "Berlin (EU)"),
        TriggerOption("Europe/Paris", "timezones.Europe/Paris", "Paris (EU)"),
        TriggerOption("Asia/Tokyo", "timezones.Asia/Tokyo", "Tokyo (JP)"),
        TriggerOption("Asia/Shanghai", "timezones.Asia/Shanghai", "Shanghai (CN)"),
        TriggerOption("Australia/Sydney", "timezones.Australia/Sydney", "Sydney (AU)")
    ]
}

// MARK: - Weekdays (web DAYS / common.days.short.N)

public enum WeekdayCatalog {
    /// Web `DAYS` — the English short labels used as the i18n fallbacks.
    public static let shortFallbacks = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// The i18n key for a weekday short label (web `common.days.short.${index}`).
    public static func shortKey(_ index: Int) -> String {
        "common.days.short.\(index)"
    }
}

// MARK: - Trigger types (web TRIGGER_TYPES — exported for the host type picker)

public enum TriggerTypeCatalog {
    /// Web `TRIGGER_TYPES` — the kind + its i18n label/fallback + SF Symbol, exported so the
    /// host's type picker (the parent of this configurator) can render the same options.
    public static let all: [(option: TriggerOption<TriggerKind>, systemImage: String)] = [
        (TriggerOption(.schedule, "automations.builder.triggerSchedule", "Schedule"), "clock"),
        (TriggerOption(.event, "automations.builder.triggerEvent", "Vehicle Event"), "bolt"),
        (TriggerOption(.geofence, "automations.builder.triggerGeofence", "Geofence"), "mappin.and.ellipse"),
        (TriggerOption(.signal, "automations.builder.triggerSignal", "Signal Threshold"), "waveform.path.ecg")
    ]
}
