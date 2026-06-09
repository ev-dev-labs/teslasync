//
//  TeslaChargingSessionsMap.Formatting.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The display-boundary seams: the P1/S11 `view.opened` telemetry sink and the
//  `useFormatting` parity the marker callout needs — currency (web
//  `formatCurrency`), the SI energy → kWh converter + 1-decimal number (web
//  `fmtNumber(convertEnergyFromSI(wh,'kWh'), 1)`), and an absolute timestamp (web
//  `formatDateTime`). Production injects a settings-backed implementation;
//  previews/tests use the bundle-free default.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract. `Sendable` so the view
/// can emit without a main-actor hop and a default sink can be an `init` default.
public protocol TeslaChargingSessionsMapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no VIN, location, cost, or
/// payload is ever recorded.
public struct OSLogTeslaChargingSessionsMapTelemetry: TeslaChargingSessionsMapTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (web `useFormatting` + the popup template literals)

/// The display-boundary formatting the callout needs (web `useFormatting`).
public protocol TeslaChargingSessionsMapFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatNumber(_ value: Double, decimals: Int) -> String
    /// SI watt-hours → "{kWh} kWh" value (web `fmtNumber(convertEnergyFromSI(wh,'kWh'), 1)`).
    func formatEnergyKwh(wattHours: Double) -> String
    func formatDateTime(_ date: Date?) -> String
}

public extension TeslaChargingSessionsMapFormatting {
    /// Currency at the web default precision (2).
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: grouped thousands, fixed decimals, rounding
/// half-up — the parity of the web `toLocaleString('en-US')` defaults with the
/// `$` currency symbol. Stateless and `Sendable`.
public struct DefaultTeslaChargingSessionsMapFormatting: TeslaChargingSessionsMapFormatting, Sendable {
    private let currencySymbol: String
    private let localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
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
        let safe = value.isFinite ? value : 0
        return formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(amount, decimals: Swift.max(0, decimals))
    }

    /// Watt-hours → kWh at 1 decimal (web `fmtNumber(convertEnergyFromSI(wh,'kWh'), 1)`,
    /// where `convertEnergyFromSI(wh,'kWh') == wh / 1000`).
    public func formatEnergyKwh(wattHours: Double) -> String {
        formatNumber(wattHours / 1000, decimals: 1)
    }

    /// A concise absolute date-time (web `formatDateTime`). `—` for nil.
    public func formatDateTime(_ date: Date?) -> String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }
}
