//
//  ChargingScheduleWidget.Signals.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  The pure, SwiftUI-free, Shared-free input + formatting layer for the surface:
//  the parsed live-schedule signals (port of the web `parseScheduleSignals`), the
//  cached vehicle-state subset the tall detail row reads, the display preferences
//  (`useDateFormat` opts), and the time/percent formatters (port of
//  `lib/dateFormat.formatTime`). Kept free of SwiftUI + the KMP `Shared` framework
//  so it is unit-testable on the host without rendering or the Kotlin/Native
//  toolchain.
//

import Foundation

// MARK: - Raw signal value (port of the web `value: unknown`)

/// One heterogeneous live-signal value as delivered by `GET /signals/{id}/live`
/// (`{ value: unknown; timestamp: string }`). Only the three shapes the widget's
/// `parseScheduleSignals` discriminates (`typeof === 'string' | 'number'`, and
/// the `=== true || === 'true'` boolean test) are modeled; anything else folds to
/// `.other`, the web `null` branch.
public enum ChargingScheduleSignalValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case other
}

// MARK: - Parsed schedule signals (port of the web `ScheduleSignals`)

/// The five schedule signals the widget reads, after `parseScheduleSignals`
/// applies the web's per-field type guards. `startTime` / `departureTime` stay as
/// the raw wire strings (exactly as the web keeps them before `formatTime`), so
/// the time formatter can reproduce `new Date(iso)` parsing — including its
/// em-dash fallback for an unparseable value.
public struct ChargingScheduleSignals: Sendable, Equatable {
    public var mode: String?
    public var pending: Bool
    public var startTime: String?
    public var departureTime: String?
    public var chargeLimitSoc: Int?

    public init(
        mode: String? = nil,
        pending: Bool = false,
        startTime: String? = nil,
        departureTime: String? = nil,
        chargeLimitSoc: Int? = nil
    ) {
        self.mode = mode
        self.pending = pending
        self.startTime = startTime
        self.departureTime = departureTime
        self.chargeLimitSoc = chargeLimitSoc
    }

    /// Reproduces the web `parseScheduleSignals(signals)` verbatim: read each key's
    /// value (absent → the web `?? null`), then apply the source's type guards —
    /// `mode`/`startTime`/`departureTime` survive only as strings, `pending` is the
    /// `=== true || === 'true'` test, and `ChargeLimitSoc` survives only as a number.
    public static func parse(from signals: [String: ChargingScheduleSignalValue]) -> ChargingScheduleSignals {
        func raw(_ key: String) -> ChargingScheduleSignalValue {
            signals[key] ?? .other
        }

        func asString(_ value: ChargingScheduleSignalValue) -> String? {
            if case let .string(text) = value { return text }
            return nil
        }

        let pendingValue = raw("ScheduledChargingPending")
        let pending = pendingValue == .bool(true) || pendingValue == .string("true")

        var soc: Int?
        if case let .number(value) = raw("ChargeLimitSoc"), value.isFinite {
            soc = Int(value.rounded())
        }

        return ChargingScheduleSignals(
            mode: asString(raw("ScheduledChargingMode")),
            pending: pending,
            startTime: asString(raw("ScheduledChargingStartTime")),
            departureTime: asString(raw("ScheduledDepartureTime")),
            chargeLimitSoc: soc
        )
    }
}

// MARK: - Cached vehicle state (port of the subset of web `VehicleState`)

/// The cached vehicle-state fields the widget's tall detail row reads
/// (`GET /vehicles/{id}/state`). A non-nil DTO marks "state present" — the web
/// `isTall && state && …` guard; `batteryLevel` mirrors `battery_level ?? 0`.
public struct ChargingScheduleStateDTO: Sendable, Equatable {
    public var batteryLevel: Int?
    public var isCharging: Bool

    public init(batteryLevel: Int? = nil, isCharging: Bool = false) {
        self.batteryLevel = batteryLevel
        self.isCharging = isCharging
    }
}

// MARK: - Display preferences (port of the web `useDateFormat` opts)

/// The locale + timezone the time formatter renders in, mirroring the resolved
/// `{ locale, tz }` `useDateFormat()` threads from the user's settings. Defaults
/// mirror the web globals so previews/tests are deterministic; the production
/// source passes the live settings through.
public struct ChargingScheduleFormatOptions: Sendable, Equatable {
    public var localeIdentifier: String
    public var timeZoneIdentifier: String

    public init(localeIdentifier: String = "en_US", timeZoneIdentifier: String = "UTC") {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    var locale: Locale {
        Locale(identifier: localeIdentifier)
    }

    var timeZone: TimeZone {
        TimeZone(identifier: timeZoneIdentifier) ?? TimeZone(identifier: "UTC") ?? .current
    }
}

// MARK: - Formatters (port of lib/dateFormat.formatTime)

/// Pure, locale + timezone-aware time formatting mirroring the web
/// `formatTime(iso, { hour, minute })` in `lib/dateFormat.ts`: a falsy or
/// unparseable value renders the em-dash `'—'`; otherwise the wall-clock time is
/// rendered in the user's locale + timezone. The web requests a 2-digit hour;
/// the native surface uses the locale's preferred hour presentation
/// (`setLocalizedDateFormatFromTemplate("jmm")` — 12h "3:30 PM" / 24h "15:30"),
/// the same idiomatic short-time convention the sibling dashboard widgets use.
public enum ChargingScheduleFormat {
    /// The em-dash sentinel the web `formatTime` returns for a falsy / invalid
    /// timestamp.
    public static let dash = "—"

    /// Parses an ISO-8601 wire timestamp the way the web `new Date(iso)` does for
    /// the schedule signals, tolerating both the fractional-seconds and the
    /// whole-second internet-date-time forms.
    public static func parseTimestamp(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }

    /// Formats a raw schedule timestamp to a localized wall-clock time, or the
    /// em-dash sentinel for a nil / unparseable value — the web
    /// `formatTime(iso)`. The narrow / non-breaking spaces modern ICU inserts
    /// before the AM/PM marker are normalized to a regular space for stable,
    /// readable display + VoiceOver output.
    public static func time(_ raw: String?, options: ChargingScheduleFormatOptions) -> String {
        guard let date = parseTimestamp(raw) else { return dash }
        let formatter = DateFormatter()
        formatter.locale = options.locale
        formatter.timeZone = options.timeZone
        formatter.setLocalizedDateFormatFromTemplate("jmm")
        return formatter.string(from: date)
            .replacingOccurrences(of: "\u{202F}", with: " ")
            .replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    /// Formats a charge-limit state-of-charge as the web `${chargeLimit}%`.
    public static func percent(_ value: Int) -> String {
        "\(value)%"
    }
}
