//
//  ChargingSessionCard.Formatting.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The display-boundary formatting seam (web `useFormatting` + the page-level
//  `toDistanceDisplay` / `distanceUnit`): currency, decimal numbers (web
//  `fmtNumber`, default precision 2), integers (web `fmtInt`), durations (web
//  `formatDurationMinutes`), a timestamp renderer (web `TimeStamp`), and the
//  display-distance converter + unit symbol. Production injects a settings-backed
//  implementation; previews/tests use the bundle-free default.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract. `Sendable` so the view
/// can emit without main-actor hops and a default sink can be an `init` default.
public protocol ChargingSessionCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no VIN, location, or payload
/// is ever recorded.
public struct OSLogChargingSessionCardTelemetry: ChargingSessionCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Display-distance unit (web `distanceUnit` / `toDistanceDisplay`)

/// The unit the card converts display distance into (web `distanceUnit` prop).
public enum ChargingDistanceUnit: String, Equatable, Sendable {
    case miles
    case kilometers

    /// The trailing symbol shown after the distance-gained value (web `distanceUnit`).
    public var symbol: String {
        switch self {
        case .miles: "mi"
        case .kilometers: "km"
        }
    }

    /// Kilometres → display value (web `toDistanceDisplay`).
    public func display(kilometers: Double) -> Double {
        switch self {
        case .miles: kilometers * 0.621_371
        case .kilometers: kilometers
        }
    }
}

// MARK: - Formatting seam

/// The display-boundary formatting the card needs (web `useFormatting`).
public protocol ChargingSessionCardFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatNumber(_ value: Double, decimals: Int) -> String
    func formatInt(_ value: Double) -> String
    func formatDurationMinutes(_ minutes: Double?) -> String
    func formatTimestamp(_ date: Date?) -> String
    func distanceDisplay(kilometers: Double) -> Double
    var distanceUnit: String { get }
}

public extension ChargingSessionCardFormatting {
    /// Currency at the web default precision (2).
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }

    /// Decimal number at the web default precision (`_globalPrecision` = 2).
    func formatNumber(_ value: Double) -> String {
        formatNumber(value, decimals: 2)
    }
}

/// Bundle-free default formatter: grouped thousands, fixed decimals, rounding
/// half-up — the parity of the web `toLocaleString('en-US')` defaults with the `$`
/// currency symbol and precision-2 baseline. Stateless and `Sendable`.
public struct DefaultChargingSessionCardFormatting: ChargingSessionCardFormatting, Sendable {
    private let currencySymbol: String
    private let localeIdentifier: String
    private let unit: ChargingDistanceUnit

    public init(
        currencySymbol: String = "$",
        localeIdentifier: String = "en_US",
        unit: ChargingDistanceUnit = .miles
    ) {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
        self.unit = unit
    }

    private func formatter(decimals: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = ChargingSessionNumeric.safe(value)
        return formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatInt(_ value: Double) -> String {
        formatNumber(value, decimals: 0)
    }

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(amount, decimals: Swift.max(0, decimals))
    }

    /// Port of the web `formatDurationMinutes`: `—` for nil / non-finite /
    /// negative; `"{h}h {m}m"` when an hour or more, else `"{m}m"`, with the
    /// remainder minutes rounded (web `formatRoundedInt`).
    public func formatDurationMinutes(_ minutes: Double?) -> String {
        guard let minutes, minutes.isFinite, minutes >= 0 else { return "—" }
        let hours = Int(minutes / 60)
        let remainder = minutes - Double(hours * 60)
        let mins = formatInt(remainder)
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// A concise absolute timestamp (web `TimeStamp` absolute branch). `—` for nil.
    public func formatTimestamp(_ date: Date?) -> String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: date)
    }

    public func distanceDisplay(kilometers: Double) -> Double {
        unit.display(kilometers: kilometers)
    }

    public var distanceUnit: String {
        unit.symbol
    }
}
