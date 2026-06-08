//
//  TriggerConfigurator.Adapter.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  The testable projection core for the automation trigger configurator: a faithful,
//  dependency-free port of the data shapes + pure logic in
//  features/automations/pages/TriggerConfigurator.tsx — the `AutomationTriggerStepInput`
//  discriminated union, the `buildCronExpr` / `parseCronExpr` schedule helpers, the
//  `handleDayToggle` weekday math, the `signalValueFromInput` value coercion, the
//  `createDefaultTrigger` seeds, and the geofence wire model. Everything here is pure
//  (no SwiftUI) so it can be unit-tested without a bundle or a view.
//

import Foundation

// MARK: - Trigger kind (web AutomationTriggerKind)

/// The four trigger kinds the web `AutomationTriggerKind` union models. The raw value
/// is the exact wire/discriminator string the backend persists.
public enum TriggerKind: String, Sendable, Equatable, CaseIterable {
    case schedule = "trigger_schedule"
    case event = "trigger_event"
    case geofence = "trigger_geofence"
    case signal = "trigger_signal"
}

// MARK: - Signal value (web value_num / value_text / value_bool)

/// The signal trigger's comparison value. Mirrors the web's three mutually-exclusive
/// `value_num` / `value_text` / `value_bool` fields plus the valueless `changed` case.
public enum SignalValue: Sendable, Equatable {
    case number(Double)
    case text(String)
    case bool(Bool)
    /// No comparison value (the `changed` operator fires on any change).
    case none
}

/// A signal-threshold trigger (web `{ kind: 'trigger_signal', signal, op, value_* }`).
public struct SignalTrigger: Sendable, Equatable {
    public let signal: String
    public let op: SignalOperator
    public let value: SignalValue

    public init(signal: String, op: SignalOperator, value: SignalValue) {
        self.signal = signal
        self.op = op
        self.value = value
    }
}

// MARK: - Trigger model (web AutomationTriggerStepInput)

/// The native mirror of the web `AutomationTriggerStepInput` discriminated union. The
/// host hands one to the model and receives the edited value back through `onChange`.
public enum AutomationTrigger: Sendable, Equatable {
    case schedule(cronExpr: String, timezone: String)
    case event(VehicleEventType)
    case geofence(placeID: Int, event: GeofenceEvent, dwellMinutes: Int?)
    case signal(SignalTrigger)

    /// The discriminator (web `trigger.kind`).
    public var kind: TriggerKind {
        switch self {
        case .schedule: .schedule
        case .event: .event
        case .geofence: .geofence
        case .signal: .signal
        }
    }

    /// Web `createDefaultTrigger(kind)` — the seed used when the host switches kind.
    public static func createDefault(_ kind: TriggerKind) -> AutomationTrigger {
        switch kind {
        case .schedule:
            .schedule(cronExpr: "0 8 * * *", timezone: "UTC")
        case .event:
            .event(.online)
        case .geofence:
            .geofence(placeID: 0, event: .enter, dwellMinutes: nil)
        case .signal:
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(20)))
        }
    }
}

// MARK: - Cron schedule (web buildCronExpr / parseCronExpr)

/// A simple-mode schedule decoded from a 5-field cron expression (web `parseCronExpr`
/// result): a time-of-day plus the selected weekdays (empty == every day).
public struct SimpleSchedule: Sendable, Equatable {
    public let hour: Int
    public let minute: Int
    public let days: [Int]

    public init(hour: Int, minute: Int, days: [Int]) {
        self.hour = hour
        self.minute = minute
        self.days = days
    }
}

/// The cron assembly + parsing ported from `TriggerConfigurator.tsx`.
public enum CronExpression {
    /// Web `buildCronExpr(hour, minute, days)` — `"${minute} ${hour} * * ${dow}"`, where
    /// the day-of-week field is `*` for no days or all seven, else the comma-joined list.
    public static func build(hour: Int, minute: Int, days: [Int]) -> String {
        let dow = (days.isEmpty || days.count == 7)
            ? "*"
            : days.map(String.init).joined(separator: ",")
        return "\(minute) \(hour) * * \(dow)"
    }

    /// Web `parseCronExpr(expr)` — returns a `SimpleSchedule` only when the expression is
    /// exactly five whitespace-separated fields with `*` day-of-month + month and integer
    /// minute + hour; otherwise `nil` (the source then shows the advanced text field).
    public static func parse(_ expr: String) -> SimpleSchedule? {
        let parts = expr
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
        guard parts.count == 5 else { return nil }
        let (minuteField, hourField, dom, month, dow) = (parts[0], parts[1], parts[2], parts[3], parts[4])
        guard dom == "*", month == "*" else { return nil }
        guard let minute = Int(minuteField), let hour = Int(hourField) else { return nil }
        let days = dow == "*"
            ? []
            : dow.split(separator: ",").compactMap { Int($0) }
        return SimpleSchedule(hour: hour, minute: minute, days: days)
    }
}

// MARK: - Pure helpers (web handleDayToggle / signalValueFromInput / number coercion)

/// The pure, view-free helpers ported from `TriggerConfigurator.tsx`.
public enum TriggerAdapter {
    /// Number of weekdays (web `DAYS.length`).
    public static let weekdayCount = 7

    /// Web `handleDayToggle(days, day)`. An empty selection means "every day"; toggling a
    /// day off an empty selection selects the other six, toggling membership otherwise,
    /// and a full seven-day result normalises back to the empty "every day" set.
    public static func toggleDay(_ days: [Int], _ day: Int) -> [Int] {
        if days.isEmpty {
            return (0 ..< weekdayCount).filter { $0 != day }
        }
        let next = days.contains(day)
            ? days.filter { $0 != day }
            : (days + [day]).sorted()
        return next.count == weekdayCount ? [] : next
    }

    /// Whether a weekday chip renders active (web `selectedDays.length === 0 ||
    /// selectedDays.includes(index)` — every day is active when none are explicitly set).
    public static func isDayActive(_ days: [Int], _ day: Int) -> Bool {
        days.isEmpty || days.contains(day)
    }

    /// Web `signalValueFromInput(trigger, value)` — coerces the raw string field value into
    /// the correct typed value for the current signal + operator.
    public static func signalValue(signal: String, op: SignalOperator, rawValue: String) -> SignalValue {
        if op == .changed { return .none }
        if SignalCatalog.boolFieldKeys.contains(signal) { return .bool(rawValue == "true") }
        if signal == "state" { return .text(rawValue) }
        return .number(parseLeadingDouble(rawValue))
    }

    /// The string shown in the value field for a signal trigger (web `value` derivation):
    /// boolean → `"true"`/`"false"` (default `true`), state → the text (default `online`),
    /// numeric → the formatted number (default `20`).
    public static func displayValue(for trigger: SignalTrigger) -> String {
        if SignalCatalog.boolFieldKeys.contains(trigger.signal) {
            if case let .bool(flag) = trigger.value { return String(flag) }
            return "true"
        }
        if trigger.signal == "state" {
            if case let .text(text) = trigger.value { return text }
            return "online"
        }
        if case let .number(number) = trigger.value { return numberString(number) }
        return "20"
    }

    /// JS `String(number)` formatting: integral values print without a `.0` tail.
    public static func numberString(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    /// JS `Number.parseFloat(value) || 0` — the leading decimal prefix of the string, or 0
    /// when there is none (matching `parseFloat`'s permissive scan + the `|| 0` fallback).
    public static func parseLeadingDouble(_ value: String) -> Double {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        var end = trimmed.startIndex
        var sawDigit = false
        var sawDot = false
        if end < trimmed.endIndex, trimmed[end] == "-" || trimmed[end] == "+" {
            end = trimmed.index(after: end)
        }
        while end < trimmed.endIndex {
            let character = trimmed[end]
            if character.isNumber {
                sawDigit = true
            } else if character == ".", !sawDot {
                sawDot = true
            } else {
                break
            }
            end = trimmed.index(after: end)
        }
        guard sawDigit, let parsed = Double(trimmed[trimmed.startIndex ..< end]) else { return 0 }
        return parsed
    }
}

// MARK: - Geofence wire model (web useGeofences payload)

/// A geofence option (web `Geofence`), trimmed to the `id` + `name` the picker consumes.
public struct Geofence: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }

    /// Decodes the `/geofences` array, tolerating a numeric or string `id` (the backend
    /// `MarshalJSON` emits a numeric id; the legacy type declares a string).
    public static func decodeList(_ data: Data) -> [Geofence]? {
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return nil
        }
        return raw.compactMap { entry in
            let name = entry["name"] as? String ?? ""
            let identifier: String
            if let value = entry["id"] as? String {
                identifier = value
            } else if let value = entry["id"] as? Int {
                identifier = String(value)
            } else if let value = entry["id"] as? Double {
                identifier = String(Int(value))
            } else {
                return nil
            }
            return Geofence(id: identifier, name: name)
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with `view.opened`, reachable from the
/// dependency-free projection layer and its tests.
public enum TriggerConfiguratorSurface {
    public static let slug = "TriggerConfigurator"
}

// MARK: - Accessibility summaries (VoiceOver)

/// Builds the surface's VoiceOver summaries through an injected localizer
/// (`(key, fallback) -> String`) so they are testable without a bundle.
public enum TriggerConfiguratorAccessibility {
    /// "<Day>, selected" / "<Day>, not selected" for a weekday toggle button.
    public static func dayLabel(
        day: String,
        active: Bool,
        localize: (String, String) -> String
    ) -> String {
        let state = active
            ? localize("a11y.triggerConfigurator.daySelected", "selected")
            : localize("a11y.triggerConfigurator.dayNotSelected", "not selected")
        return "\(day), \(state)"
    }

    /// The geofence picker's VoiceOver value: the chosen geofence, or the unselected prompt.
    public static func geofenceValue(
        selectedName: String?,
        localize: (String, String) -> String
    ) -> String {
        selectedName ?? localize("automations.builder.selectGeofence", "Select geofence...")
    }
}
