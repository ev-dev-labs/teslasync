//
//  ConditionBuilder.Adapter.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  The testable transform core for the automation ConditionBuilder — the SwiftUI
//  parity of web/src/features/automations/pages/ConditionBuilder.tsx plus the
//  `lib/signals.ts` (SIGNAL_FIELDS / BOOL_FIELD_KEYS) and `lib/constants.ts`
//  (DAYS / COMMON_TIMEZONES) data it composes. Everything here is pure +
//  Foundation-only (no SwiftUI, no store, no `Shared`) so the four default factories,
//  the value coercion ladder (`conditionValueFromInput`), the operator/signal switch
//  logic, the numeric parsing (`parseFloat || 0`, `parseInt || 0`, `numericValue`),
//  the day toggle, and the geofence-option / timezone projections are all unit-tested
//  in isolation. The condition value types live in `ConditionBuilder.Types.swift`.
//

import Foundation

// MARK: - The pure adapter (web helper + handler ports)

/// The pure transform core. Every function mirrors a specific web expression so the
/// native editor produces byte-identical payloads; each is unit-tested.
public enum ConditionBuilderAdapter {
    // MARK: Catalogs

    /// Web `SIGNAL_FIELDS` (lib/signals.ts), order-preserved for the dropdown.
    public static let signalFields: [SignalField] = [
        SignalField(
            key: "battery_level",
            label: LocalizedText("automations.signals.battery_level", "Battery Level"),
            type: .numeric
        ),
        SignalField(
            key: "inside_temp",
            label: LocalizedText("automations.signals.inside_temp", "Inside Temperature"),
            type: .numeric
        ),
        SignalField(
            key: "outside_temp",
            label: LocalizedText("automations.signals.outside_temp", "Outside Temperature"),
            type: .numeric
        ),
        SignalField(key: "speed", label: LocalizedText("automations.signals.speed", "Speed"), type: .numeric),
        SignalField(
            key: "is_locked",
            label: LocalizedText("automations.signals.is_locked", "Is Locked"),
            type: .boolean
        ),
        SignalField(
            key: "is_charging",
            label: LocalizedText("automations.signals.is_charging", "Is Charging"),
            type: .boolean
        ),
        SignalField(
            key: "is_climate_on",
            label: LocalizedText("automations.signals.is_climate_on", "Climate On"),
            type: .boolean
        ),
        SignalField(
            key: "sentry_mode",
            label: LocalizedText("automations.signals.sentry_mode", "Sentry Mode"),
            type: .boolean
        ),
        SignalField(key: "state", label: LocalizedText("automations.signals.state", "Vehicle State"), type: .string)
    ]

    /// Web `BOOL_FIELD_KEYS` — the boolean signal keys.
    public static let boolFieldKeys: Set<String> = Set(
        signalFields.filter { $0.type == .boolean }.map(\.key)
    )

    /// Web `DAYS` short names (Sun…Sat), indexed by day-of-week 0…6.
    public static let dayShortNames: [String] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// One timezone option (web `COMMON_TIMEZONES` entry).
    public struct TimezoneOption: Sendable, Equatable, Identifiable {
        public let value: String
        public let label: LocalizedText
        public var id: String {
            value
        }
    }

    /// Web `COMMON_TIMEZONES` (lib/constants.ts), with each label keyed
    /// `timezones.<value || 'utc'>` exactly as the web `t()` call does.
    public static let timezones: [TimezoneOption] = [
        TimezoneOption(value: "", label: LocalizedText("timezones.utc", "UTC (Default)")),
        TimezoneOption(
            value: "America/New_York",
            label: LocalizedText("timezones.America/New_York", "Eastern (US)")
        ),
        TimezoneOption(value: "America/Chicago", label: LocalizedText("timezones.America/Chicago", "Central (US)")),
        TimezoneOption(value: "America/Denver", label: LocalizedText("timezones.America/Denver", "Mountain (US)")),
        TimezoneOption(
            value: "America/Los_Angeles",
            label: LocalizedText("timezones.America/Los_Angeles", "Pacific (US)")
        ),
        TimezoneOption(value: "Europe/London", label: LocalizedText("timezones.Europe/London", "London (UK)")),
        TimezoneOption(value: "Europe/Berlin", label: LocalizedText("timezones.Europe/Berlin", "Berlin (EU)")),
        TimezoneOption(value: "Europe/Paris", label: LocalizedText("timezones.Europe/Paris", "Paris (EU)")),
        TimezoneOption(value: "Asia/Tokyo", label: LocalizedText("timezones.Asia/Tokyo", "Tokyo (JP)")),
        TimezoneOption(value: "Asia/Shanghai", label: LocalizedText("timezones.Asia/Shanghai", "Shanghai (CN)")),
        TimezoneOption(value: "Australia/Sydney", label: LocalizedText("timezones.Australia/Sydney", "Sydney (AU)"))
    ]

    // MARK: Defaults (web `createDefaultCondition`)

    /// Web `createDefaultCondition(kind)`.
    public static func defaultCondition(kind: AutomationConditionKind) -> ConditionBody {
        switch kind {
        case .signal:
            .signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20))
        case .timeWindow:
            .timeWindow(TimeWindowCondition(
                startTime: "06:00", endTime: "09:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5]
            ))
        case .geofence:
            .geofence(GeofenceCondition(placeId: 0, state: .inside))
        case .otherAutomation:
            .otherAutomation(OtherAutomationCondition(otherAutomationId: 0, state: .enabled))
        }
    }

    // MARK: Numeric coercion (web `numericValue` / `parseFloat || 0` / `parseInt || 0`)

    /// Web `numericValue(value, fallback)`: a finite number, else the fallback.
    public static func numericValue(_ value: Double?, fallback: Double) -> Double {
        guard let value, value.isFinite else { return fallback }
        return value
    }

    /// Web `Number.parseFloat(value) || 0`: the leading float, else 0 (NaN/none → 0).
    public static func parseFloatOrZero(_ value: String) -> Double {
        let scanner = Scanner(string: value)
        scanner.charactersToBeSkipped = .whitespaces
        guard let parsed = scanner.scanDouble(), parsed.isFinite else { return 0 }
        return parsed
    }

    /// Web `Number.parseInt(value, 10) || 0`: the leading integer, else 0.
    public static func parseIntOrZero(_ value: String) -> Int {
        let scanner = Scanner(string: value)
        scanner.charactersToBeSkipped = .whitespaces
        guard let parsed = scanner.scanInt() else { return 0 }
        return parsed
    }

    /// JS `String(Number)`: integral values render without a trailing `.0`.
    public static func numberString(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    // MARK: Signal value coercion (web `conditionValueFromInput` + the `value` getter)

    /// Web `conditionValueFromInput(condition, value)` — coerces the typed string into
    /// the single relevant value field (bool / text / numeric) for the signal's type.
    public static func signalValueFromInput(_ condition: SignalCondition, value: String) -> SignalCondition {
        if boolFieldKeys.contains(condition.signal) {
            return SignalCondition(signal: condition.signal, op: condition.op, valueBool: value == "true")
        }
        if condition.signal == "state" || condition.op == .inList {
            return SignalCondition(signal: condition.signal, op: condition.op, valueText: value)
        }
        return SignalCondition(signal: condition.signal, op: condition.op, valueNum: parseFloatOrZero(value))
    }

    /// Web `value` getter in the signal case: bool → "true"/"false"; state/in → text;
    /// else → `String(value_num ?? 20)`.
    public static func signalValueString(_ condition: SignalCondition) -> String {
        if boolFieldKeys.contains(condition.signal) {
            return String(condition.valueBool ?? true)
        }
        if condition.signal == "state" || condition.op == .inList {
            return condition.valueText ?? ""
        }
        return numberString(condition.valueNum ?? 20)
    }

    /// Web operators list filtered for the signal's type (`!isBool || !op.numericOnly`).
    public static func operators(isBool: Bool) -> [AutomationConditionSignalOp] {
        AutomationConditionSignalOp.allCases.filter { !isBool || !$0.numericOnly }
    }

    /// Whether a signal key is boolean (web `BOOL_FIELD_KEYS.has(signal)`).
    public static func isBoolSignal(_ signal: String) -> Bool {
        boolFieldKeys.contains(signal)
    }

    // MARK: Signal-field change handlers (web `onChange` bodies)

    /// Web signal-select `onChange`: bool → `= true`; state → `= 'online'`; else → `< 20`.
    public static func signalChanged(to signal: String) -> SignalCondition {
        if boolFieldKeys.contains(signal) {
            return SignalCondition(signal: signal, op: .equals, valueBool: true)
        }
        if signal == "state" {
            return SignalCondition(signal: signal, op: .equals, valueText: "online")
        }
        return SignalCondition(signal: signal, op: .lessThan, valueNum: 20)
    }

    /// Web operator-select `onChange`: `between` seeds min/max; otherwise re-coerces the
    /// current display value through `conditionValueFromInput` under the new operator.
    public static func operatorChanged(
        _ condition: SignalCondition,
        to op: AutomationConditionSignalOp
    ) -> SignalCondition {
        if op == .between {
            return SignalCondition(
                signal: condition.signal,
                op: op,
                valueMin: numericValue(condition.valueMin ?? condition.valueNum, fallback: 0),
                valueMax: numericValue(condition.valueMax, fallback: 100)
            )
        }
        var next = condition
        next.op = op
        return signalValueFromInput(next, value: signalValueString(condition))
    }

    /// Web single-Value numeric edit: replace with only `value_num` set.
    public static func withNumber(_ condition: SignalCondition, _ value: Double) -> SignalCondition {
        SignalCondition(signal: condition.signal, op: condition.op, valueNum: value)
    }

    /// Web single-Value text edit: replace with only `value_text` set.
    public static func withText(_ condition: SignalCondition, _ value: String) -> SignalCondition {
        SignalCondition(signal: condition.signal, op: condition.op, valueText: value)
    }

    /// Web single-Value bool edit: replace with only `value_bool` set.
    public static func withBool(_ condition: SignalCondition, _ value: Bool) -> SignalCondition {
        SignalCondition(signal: condition.signal, op: condition.op, valueBool: value)
    }

    /// Web Min edit (`{ ...condition, value_min }`): keep every field, update min.
    public static func withMin(_ condition: SignalCondition, _ value: Double) -> SignalCondition {
        var next = condition
        next.valueMin = value
        return next
    }

    /// Web Max edit (`{ ...condition, value_max }`): keep every field, update max.
    public static func withMax(_ condition: SignalCondition, _ value: Double) -> SignalCondition {
        var next = condition
        next.valueMax = value
        return next
    }

    // MARK: Time-window helpers

    /// Web day toggle: remove when present, else append + sort ascending.
    public static func toggleDay(_ days: [Int], _ day: Int) -> [Int] {
        if days.contains(day) {
            return days.filter { $0 != day }
        }
        return (days + [day]).sorted()
    }

    /// Normalizes a stored timezone for the picker: a known option value is kept,
    /// anything else (e.g. the default `"UTC"`, absent from `COMMON_TIMEZONES`) maps to
    /// the `""` "UTC (Default)" option for display without mutating the stored value.
    public static func timezoneSelection(_ stored: String) -> String {
        let known = Set(timezones.map(\.value))
        return known.contains(stored) ? stored : ""
    }

    // MARK: Geofence helpers (web `geofenceOptions` + value/onChange)

    /// Web geofence-select value: `place_id > 0 ? String(place_id) : ''`.
    public static func geofenceSelection(placeId: Int) -> String {
        placeId > 0 ? String(placeId) : ""
    }

    /// Web geofence-select `onChange`: `value ? Number(value) : 0`.
    public static func geofencePlaceId(from value: String) -> Int {
        value.isEmpty ? 0 : (Int(value) ?? 0)
    }
}
