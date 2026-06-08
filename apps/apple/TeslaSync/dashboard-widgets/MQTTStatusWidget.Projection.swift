//
//  MQTTStatusWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0068 · MQTTStatusWidget (Apple)
//
//  The pure, Foundation-only adapter for the surface: the cached DTO inputs, the
//  `stats` projection (a 1:1 port of the web `useMemo` in
//  features/dashboard/widgets/MQTTStatusWidget.tsx), the fmtNumber/fmtInt/
//  formatRelative number+date formatters, the P1/S10 i18n facade, and the
//  testable VoiceOver summary. No SwiftUI here so the projection can be compiled
//  into a host harness and EXECUTED (cached → projection) without a simulator.
//

import Foundation

// MARK: - Cached DTO inputs (web `TelemetryStatus` + `VehicleTelemetry`)

/// One streaming vehicle's telemetry counters, mirroring the web
/// `VehicleTelemetry` fields the widget reads (`signalCount`,
/// `signalsPerSecond`, `lastReceived`). The production source decodes the
/// `/telemetry` payload (snake_case or camelCase) into this normalized shape;
/// `lastReceived` is parsed to a `Date` at the seam so the projection can take a
/// real `max()` rather than the web's lexical ISO-string sort.
public struct MQTTVehicleTelemetry: Sendable, Equatable {
    public var vin: String
    public var signalCount: Int
    public var signalsPerSecond: Double?
    public var lastReceived: Date?

    public init(vin: String, signalCount: Int = 0, signalsPerSecond: Double? = nil, lastReceived: Date? = nil) {
        self.vin = vin
        self.signalCount = signalCount
        self.signalsPerSecond = signalsPerSecond
        self.lastReceived = lastReceived
    }
}

/// The normalized MQTT status payload the widget renders, mirroring the web
/// `useMQTTStatus` result (`connected`, `broker`, `vehicles[]`).
public struct MQTTStatusData: Sendable, Equatable {
    public var connected: Bool
    public var broker: String?
    public var vehicles: [MQTTVehicleTelemetry]

    public init(connected: Bool = false, broker: String? = nil, vehicles: [MQTTVehicleTelemetry] = []) {
        self.connected = connected
        self.broker = broker
        self.vehicles = vehicles
    }
}

// MARK: - Projection (port of the web `stats` useMemo)

/// The aggregated counters shown across the layouts.
public struct MQTTStatusStats: Sendable, Equatable {
    public var totalMessages: Int
    public var messagesPerSecond: Double
    public var lastMessage: Date?

    public init(totalMessages: Int = 0, messagesPerSecond: Double = 0, lastMessage: Date? = nil) {
        self.totalMessages = totalMessages
        self.messagesPerSecond = messagesPerSecond
        self.lastMessage = lastMessage
    }
}

/// Pure adapter: cached `MQTTStatusData` → `MQTTStatusStats`. Reproduces the web
/// `useMemo`: `totalMessages = Σ signalCount`, `messagesPerSec = Σ signalsPerSecond`,
/// `lastMessage = latest lastReceived` (the web sorts ISO strings and takes the
/// most recent; with parsed `Date`s that is simply `max()`).
public enum MQTTStatusProjection {
    public static func stats(from data: MQTTStatusData) -> MQTTStatusStats {
        let total = data.vehicles.reduce(0) { $0 + max(0, $1.signalCount) }
        let perSecond = data.vehicles.reduce(0.0) { $0 + ($1.signalsPerSecond ?? 0) }
        let lastMessage = data.vehicles.compactMap(\.lastReceived).max()
        return MQTTStatusStats(
            totalMessages: total,
            messagesPerSecond: perSecond,
            lastMessage: lastMessage
        )
    }

    /// The broker label, defaulting to an em dash like the web `broker ?? '—'`.
    public static func brokerLabel(for data: MQTTStatusData) -> String {
        let broker = data.broker?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return broker.isEmpty ? MQTTStatusFormat.emDash : broker
    }
}

// MARK: - Relative-time bucket (port of lib/dateFormat.ts `formatRelative`)

/// The relative-time bucket for a `lastReceived` timestamp, mirroring the web
/// `formatRelative` thresholds (just now / m / h / d / absolute date).
public enum MQTTRelativeLabel: Equatable, Sendable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
    case absolute(Date)
}

// MARK: - Formatters (port of lib/numberFormat.ts + lib/dateFormat.ts)

/// Number / integer / relative-time formatters that match the web `fmtNumber`,
/// `fmtInt`, and `formatRelative` output the widget relies on.
public enum MQTTStatusFormat {
    /// Shared "no value" glyph (web `'—'`).
    public static let emDash = "—"

    /// Drops non-finite values to 0 (web `safeNumber`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Locale-aware grouped decimal with fixed precision (web `fmtNumber`).
    public static func number(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Locale-aware grouped integer (web `fmtInt`).
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        number(Double(value), decimals: 0, locale: locale)
    }

    /// Buckets a timestamp into a relative label (web `formatRelative`).
    public static func relative(_ date: Date, now: Date = Date()) -> MQTTRelativeLabel {
        let seconds = Int(now.timeIntervalSince(date).rounded(.down))
        if seconds < 60 { return .justNow }
        let minutes = seconds / 60
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        let days = hours / 24
        if days < 7 { return .days(days) }
        return .absolute(date)
    }

    /// Resolves a relative label to a localized string through the P1/S10 facade.
    public static func relativeText(_ label: MQTTRelativeLabel, locale: Locale = .current) -> String {
        switch label {
        case .justNow:
            return MQTTStatusStrings.string("widget.mqtt.justNow", "just now")
        case let .minutes(value):
            return MQTTStatusStrings.count("widget.mqtt.minAgo", "%lldm ago", value)
        case let .hours(value):
            return MQTTStatusStrings.count("widget.mqtt.hourAgo", "%lldh ago", value)
        case let .days(value):
            return MQTTStatusStrings.count("widget.mqtt.dayAgo", "%lldd ago", value)
        case let .absolute(date):
            let formatter = DateFormatter()
            formatter.locale = locale
            formatter.setLocalizedDateFormatFromTemplate("MMMd")
            return formatter.string(from: date)
        }
    }

    /// Convenience: the relative label for an optional timestamp, or the em dash
    /// when absent (web `stats.lastMessage ? formatRelative(...) : '—'`).
    public static func lastMessageText(_ date: Date?, now: Date = Date(), locale: Locale = .current) -> String {
        guard let date else { return emDash }
        return relativeText(relative(date, now: now), locale: locale)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// code path holds a hardcoded literal. Keys live in the per-surface
/// "MQTTStatusWidget" table, folded into the app `Localizable.xcstrings` master
/// catalog at integration time (kept separate so each parallel surface owns its
/// own strings without editing the shared catalog). The SwiftUI `text(_:_: )`
/// convenience is added in `MQTTStatusWidget.Model.swift`.
public enum MQTTStatusStrings {
    public static let table = "MQTTStatusWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the content. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum MQTTStatusAccessibility {
    public static func summary(
        brokerConnected: Bool,
        messagesPerSecondText: String,
        totalMessagesText: String,
        lastMessageText: String
    ) -> String {
        let status = brokerConnected
            ? MQTTStatusStrings.string("widget.mqtt.online", "Online")
            : MQTTStatusStrings.string("widget.mqtt.offline", "Offline")
        return [
            MQTTStatusStrings.string("widget.mqtt.status", "Status") + ": " + status,
            MQTTStatusStrings.string("widget.mqtt.msgRate", "Messages/sec") + ": " + messagesPerSecondText,
            MQTTStatusStrings.string("widget.mqtt.totalToday", "Total Messages") + ": " + totalMessagesText,
            MQTTStatusStrings.string("widget.mqtt.lastMessage", "Last Message") + ": " + lastMessageText
        ].joined(separator: ". ")
    }
}
