//
//  EventHistoryTable.Adapter.swift
//  TeslaSync — P4 feature view · 0042 · EventHistoryTable (Apple)
//
//  The testable projection core for the Security Event History table — the SwiftUI
//  parity of features/admin/components/security-access/EventHistoryTable.tsx plus the
//  `helpers.ts` (doorClosed / parseWindowState / allWindowsClosed / windowSummary) and
//  `typeGuards.ts` (asNonEmptyString) it is fed by. Everything here is pure +
//  Foundation-only (no store, no bundle, no rendered view) so the defensive Tesla
//  signal handling, the row projection, the timestamp formatting, the door/window/lock/
//  sentry display resolution, and the VoiceOver summaries are all unit-tested in
//  isolation. Colors/tones are NOT decided here — they are a render concern (Views).
//

import Foundation

// MARK: - Security signal value (defensive, like the web `string | boolean | null`)

/// A minimal JSON-ish value modeling one Tesla security signal. The backend serializes
/// raw `signal.SignalValue` (`interface{}`), so — exactly like the web `SecurityEvent`
/// union (`string | boolean | null`) and the defensive `doorClosed` (which also accepts
/// number / object / JSON-string forms) — the adapter inspects an untyped value rather
/// than a fixed Codable shape.
public indirect enum SecuritySignal: Sendable, Equatable {
    case string(String)
    case bool(Bool)
    case number(Double)
    case object([String: SecuritySignal])
    case null

    /// Web `asNonEmptyString` (typeGuards.ts): a string with length > 0, else nil.
    public var asNonEmptyString: String? {
        if case let .string(value) = self, !value.isEmpty { return value }
        return nil
    }

    /// JS truthiness (`Boolean(value)`) — the web Lock/Sentry columns gate on
    /// `row.locked ?` / `row.sentryMode ?` directly: a non-empty string, `true`, a
    /// non-zero number, or any object is truthy; null / `false` / "" / 0 are not.
    public var isTruthy: Bool {
        switch self {
        case let .bool(value): value
        case let .string(value): !value.isEmpty
        case let .number(value): value != 0
        case .object: true
        case .null: false
        }
    }

    /// Web object-member predicate `v === false || v == null` used by `doorClosed`.
    var isFalseOrNull: Bool {
        switch self {
        case .null: true
        case let .bool(value): value == false
        default: false
        }
    }
}

// MARK: - JSON coercion (production source path + door JSON-string branch)

public extension SecuritySignal {
    /// Parses a JSON object string (web `doorClosed`'s `lower.startsWith('{')` branch).
    /// Returns nil when the bytes are not a JSON object.
    static func parseObject(_ raw: String) -> [String: SecuritySignal]? {
        guard
            let data = raw.data(using: .utf8),
            let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
            let dict = parsed as? [String: Any]
        else { return nil }
        return dict.mapValues(convert)
    }

    /// Converts a `JSONSerialization` value into a `SecuritySignal` (booleans kept
    /// distinct from numbers via the CoreFoundation boolean type id).
    static func convert(_ value: Any) -> SecuritySignal {
        switch value {
        case let dict as [String: Any]:
            return .object(dict.mapValues(convert))
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return .bool(number.boolValue)
            }
            return .number(number.doubleValue)
        case let string as String:
            return .string(string)
        default:
            return .null
        }
    }
}

// MARK: - Window / door derivations (port of helpers.ts)

/// The four discrete window states (web `WindowState`).
public enum WindowState: Sendable, Equatable {
    case closed, venting, open, unknown
}

/// The Doors-cell display (web `asNonEmptyString(doorState) ?? (closed ? 'Closed' : '—')`):
/// a raw backend string verbatim, the localized "Closed" label, or the em-dash.
public enum DoorDisplay: Sendable, Equatable {
    case raw(String)
    case closedLabel
    case dash
}

/// The Windows-cell display (web `windowSummary`): all closed, or N open/venting.
public enum WindowDisplay: Sendable, Equatable {
    case allClosed
    case openVenting(Int)
}

/// Pure security derivations shared by the row projection, the views, and the tests.
public enum EventHistoryAdapter {
    /// Web `parseWindowState`: closed/"0" → closed; contains "vent" → venting; otherwise
    /// any non-empty value → open (the trailing unknown mirrors the web's dead fallback).
    public static func parseWindowState(_ value: SecuritySignal) -> WindowState {
        guard let raw = value.asNonEmptyString else { return .unknown }
        let lower = raw.lowercased()
        if lower == "closed" || lower == "0" { return .closed }
        if lower.contains("vent") { return .venting }
        if lower.contains("open") || lower != "0" { return .open }
        return .unknown
    }

    /// Web `doorClosed`: null → closed; bool → `!state`; number → `== 0`; object → every
    /// member false/null; string → trimmed/lowercased closed sentinels, a `{`-prefixed
    /// JSON object whose members are all false/null, else open.
    public static func doorClosed(_ state: SecuritySignal) -> Bool {
        switch state {
        case .null:
            true
        case let .bool(value):
            !value
        case let .number(value):
            value == 0
        case let .object(members):
            members.values.allSatisfy(\.isFalseOrNull)
        case let .string(raw):
            stringDoorClosed(raw)
        }
    }

    private static func stringDoorClosed(_ raw: String) -> Bool {
        let lower = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if lower.isEmpty || lower == "closed" || lower == "closedall" || lower == "0" || lower == "false" {
            return true
        }
        if lower.hasPrefix("{"), let parsed = SecuritySignal.parseObject(raw) {
            return parsed.values.allSatisfy(\.isFalseOrNull)
        }
        return false
    }

    /// Web `allWindowsClosed`: every one of the four windows parses to `Closed`.
    public static func allWindowsClosed(_ windows: [SecuritySignal]) -> Bool {
        windows.map(parseWindowState).allSatisfy { $0 == .closed }
    }

    /// Web `windowSummary`: all closed → `.allClosed`; else the count that is not closed.
    public static func windowSummary(_ windows: [SecuritySignal]) -> WindowDisplay {
        let states = windows.map(parseWindowState)
        if states.allSatisfy({ $0 == .closed }) { return .allClosed }
        return .openVenting(states.count(where: { $0 != .closed }))
    }

    /// Web Doors-cell text resolution (the `??` ladder).
    public static func doorDisplay(_ state: SecuritySignal) -> DoorDisplay {
        if let raw = state.asNonEmptyString { return .raw(raw) }
        return doorClosed(state) ? .closedLabel : .dash
    }
}

// MARK: - Input DTO (web `SecurityEvent`, the fields this surface reads)

/// One security-event row pushed by an `EventHistorySource` — the native mirror of the
/// web `SecurityEvent` (types/admin.ts), carrying only the fields EventHistoryTable
/// reads. The union-typed signals are modeled as `SecuritySignal`.
public struct SecurityEventInput: Sendable, Equatable, Identifiable {
    public var id: String
    public var createdAt: String
    public var locked: SecuritySignal
    public var sentryMode: SecuritySignal
    public var doorState: SecuritySignal
    public var fdWindow: SecuritySignal
    public var fpWindow: SecuritySignal
    public var rdWindow: SecuritySignal
    public var rpWindow: SecuritySignal

    public init(
        id: String,
        createdAt: String,
        locked: SecuritySignal = .null,
        sentryMode: SecuritySignal = .null,
        doorState: SecuritySignal = .null,
        fdWindow: SecuritySignal = .null,
        fpWindow: SecuritySignal = .null,
        rdWindow: SecuritySignal = .null,
        rpWindow: SecuritySignal = .null
    ) {
        self.id = id
        self.createdAt = createdAt
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorState = doorState
        self.fdWindow = fdWindow
        self.fpWindow = fpWindow
        self.rdWindow = rdWindow
        self.rpWindow = rpWindow
    }

    var windows: [SecuritySignal] {
        [fdWindow, fpWindow, rdWindow, rpWindow]
    }
}

// MARK: - Projected row (web DataTable row)

/// The view-ready row after projection — every column's semantic value precomputed so
/// the view holds no logic (web columns: Time / Lock / Sentry / Doors / Windows).
public struct EventHistoryRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let createdAt: Date?
    public let createdAtRaw: String
    public let locked: Bool
    public let sentryOn: Bool
    public let doorClosed: Bool
    public let door: DoorDisplay
    public let windowsClosed: Bool
    public let windows: WindowDisplay

    public init(
        id: String,
        createdAt: Date?,
        createdAtRaw: String,
        locked: Bool,
        sentryOn: Bool,
        doorClosed: Bool,
        door: DoorDisplay,
        windowsClosed: Bool,
        windows: WindowDisplay
    ) {
        self.id = id
        self.createdAt = createdAt
        self.createdAtRaw = createdAtRaw
        self.locked = locked
        self.sentryOn = sentryOn
        self.doorClosed = doorClosed
        self.door = door
        self.windowsClosed = windowsClosed
        self.windows = windows
    }
}

public extension EventHistoryAdapter {
    /// Projects one input into a view row.
    static func row(from input: SecurityEventInput) -> EventHistoryRow {
        EventHistoryRow(
            id: input.id,
            createdAt: EventHistoryFormat.parse(input.createdAt),
            createdAtRaw: input.createdAt,
            locked: input.locked.isTruthy,
            sentryOn: input.sentryMode.isTruthy,
            doorClosed: doorClosed(input.doorState),
            door: doorDisplay(input.doorState),
            windowsClosed: allWindowsClosed(input.windows),
            windows: windowSummary(input.windows)
        )
    }

    /// Projects the history in source order (web renders the array as received).
    static func rows(from inputs: [SecurityEventInput]) -> [EventHistoryRow] {
        inputs.map(row(from:))
    }

    /// Stable comparator for the sortable Time column (web `sortable: true`). An absent
    /// date sorts before any present date.
    static func compareByTime(_ lhs: EventHistoryRow, _ rhs: EventHistoryRow) -> ComparisonResult {
        switch (lhs.createdAt, rhs.createdAt) {
        case let (left?, right?):
            if left == right { return .orderedSame }
            return left < right ? .orderedAscending : .orderedDescending
        case (nil, nil): return .orderedSame
        case (nil, _): return .orderedAscending
        case (_, nil): return .orderedDescending
        }
    }
}

// MARK: - Timestamp formatting (web `TimeStamp`)

/// Locale-aware timestamp rendering for the Time column (web `TimeStamp`): an absolute
/// body with a relative alternate folded into the accessibility value; an empty or
/// unparseable value renders the em-dash sentinel (web "—").
public enum EventHistoryFormat {
    public static let dash = "—"

    /// Parses an ISO-8601 (optionally fractional) string or a numeric epoch-seconds
    /// string. Returns nil when unparseable (web `Number.isNaN(date.getTime())`).
    public static func parse(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        if let seconds = Double(raw) { return Date(timeIntervalSince1970: seconds) }
        return nil
    }

    /// Absolute, locale-aware "Apr 4, 2:30 AM" body; em-dash when nil.
    public static func absolute(
        for date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Relative "2h ago" alternate (web `formatRelative`), delegated to the OS so it is
    /// localized without hardcoded English. `now` is injectable for deterministic tests.
    public static func relative(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Display text + accessibility (localized through an injected facade)

/// Resolves each cell's display text and the row's VoiceOver summary through an injected
/// localizer `(key, fallback) -> String`, so the strings stay in the P1/S10 catalog and
/// the spoken content is asserted without rendering. Pure + bundle-free in tests.
public enum EventHistoryAccessibility {
    public typealias Localize = (String, String) -> String

    public static func lockText(_ locked: Bool, _ localize: Localize) -> String {
        locked
            ? localize("admin.security.locked", "Locked")
            : localize("admin.security.unlocked", "Unlocked")
    }

    public static func sentryText(_ sentryOn: Bool, _ localize: Localize) -> String {
        sentryOn
            ? localize("admin.security.on", "On")
            : localize("admin.security.off", "Off")
    }

    public static func doorText(_ door: DoorDisplay, _ localize: Localize) -> String {
        switch door {
        case let .raw(value): value
        case .closedLabel: localize("admin.security.closed", "Closed")
        case .dash: EventHistoryFormat.dash
        }
    }

    public static func windowText(_ windows: WindowDisplay, _ localize: Localize) -> String {
        switch windows {
        case .allClosed:
            return localize("admin.security.windows.allClosed", "All Closed")
        case let .openVenting(count):
            let format = localize("admin.security.windows.openVenting", "%lld Open/Venting")
            return String(format: format, Int64(count))
        }
    }

    /// One combined VoiceOver string for a row (Time / Lock / Sentry / Doors / Windows).
    public static func rowSummary(for row: EventHistoryRow, _ localize: Localize) -> String {
        [
            "\(localize("admin.security.col.time", "Time")): \(EventHistoryFormat.absolute(for: row.createdAt))",
            "\(localize("admin.security.col.lock", "Lock")): \(lockText(row.locked, localize))",
            "\(localize("admin.security.col.sentry", "Sentry")): \(sentryText(row.sentryOn, localize))",
            "\(localize("admin.security.col.doors", "Doors")): \(doorText(row.door, localize))",
            "\(localize("admin.security.col.windows", "Windows")): \(windowText(row.windows, localize))"
        ].joined(separator: ", ")
    }
}
