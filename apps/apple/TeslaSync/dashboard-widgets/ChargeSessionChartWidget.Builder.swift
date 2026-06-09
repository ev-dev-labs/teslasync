//
//  ChargeSessionChartWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/ChargeSessionChartWidget.tsx (classifyChargerType /
//  chartData / totals). The SI→display energy conversion (watt-hours → kWh) is
//  done at this display boundary via an injected converter seam (the native
//  analog of the web `convertEnergyFromSI(wh, 'kWh')`), and the date label uses
//  a locale + timezone aware short-date formatter (web `formatDateShort`). No
//  SwiftUI / transport here — this is the unit-tested core.
//

import Foundation

// MARK: - Energy converter seam (display boundary — web `convertEnergyFromSI`)

/// SI→display energy conversion at the widget's render boundary. Injected so the
/// projection stays deterministic + testable. The web source hard-codes the
/// `'kWh'` target, so this seam converts watt-hours to kilowatt-hours; the
/// production app may instead wire the shared KMP units engine at the
/// composition root.
public protocol ChargeSessionEnergyConverting: Sendable {
    /// Converts SI watt-hours to kilowatt-hours (web `convertEnergyFromSI(wh, 'kWh')`).
    func kilowattHours(fromWattHours wattHours: Double) -> Double
}

/// The canonical energy converter, mirroring `convertEnergyFromSI` exactly:
/// `kWh = Wh / 1000`. Non-finite input collapses to 0 (the web feeds
/// `total_energy_added_wh ?? 0`, so the rendered value is identical).
public struct StandardChargeSessionEnergyConverter: ChargeSessionEnergyConverting {
    private static let wattHoursPerKilowattHour = 1000.0

    public init() {}

    public func kilowattHours(fromWattHours wattHours: Double) -> Double {
        let safe = wattHours.isFinite ? wattHours : 0
        return safe / Self.wattHoursPerKilowattHour
    }
}

// MARK: - Number / date formatting (web `fmt`/`fmtNumber` + `formatDateShort`)

/// Locale-aware number + short-date formatting that mirrors the web `fmt`
/// (`fmtNumber` → `Intl.NumberFormat`) and `formatDateShort`
/// (`Intl.DateTimeFormat { month:'short', day:'numeric' }`).
public enum ChargeSessionFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0 (the
    /// web `fmt` runs every value through `safeNumber` first).
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmt(v, decimals)` → `fmtNumber(v, decimals)` — fixed fraction digits,
    /// grouped, rounding half away from zero to match `Intl.NumberFormat`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Ports `formatDateShort(iso)`: a locale + timezone aware
    /// `{ month: 'short', day: 'numeric' }` string (e.g. `"Apr 4"`).
    public static func shortDate(
        _ date: Date,
        localeIdentifier: String,
        timeZoneIdentifier: String
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }
}

// MARK: - Projection builder (port of the web chartData / stats memos)

/// Pure adapter that turns cached charging sessions into the rendered
/// projection, faithfully reproducing the web component's `useMemo` pipeline.
public enum ChargeSessionBuilder {
    /// Classifies a session into a charger-type bucket — a 1:1 port of the web
    /// `classifyChargerType`: a `charger_type` containing `supercharger`/`tesla`
    /// is a Supercharger; any other non-empty, non-`<invalid>` value is DC fast;
    /// everything else (incl. missing) is Home / AC.
    public static func classify(chargerType: String?) -> ChargeSessionChargerKind {
        let kind = (chargerType ?? "").lowercased()
        if kind.contains("supercharger") || kind.contains("tesla") {
            return .supercharger
        }
        if !kind.isEmpty, kind != "<invalid>" {
            return .dc
        }
        return .home
    }

    /// Builds the projection: project each session to a bar (date/ordinal label,
    /// kWh energy, charger bucket), reverse so the oldest session is leftmost
    /// (web `.reverse()`), then derive the Total / Avg energy and session count
    /// (web `stats`). `hasData` mirrors the web `chartData.length > 0`.
    public static func buildProjection(
        rows: [ChargeSessionDTO],
        converter: ChargeSessionEnergyConverting = StandardChargeSessionEnergyConverter(),
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC"
    ) -> ChargeSessionChartProjection {
        let projected = rows.enumerated().map { index, row -> ChargeSessionBar in
            let label: String = if let startedAt = row.startedAt {
                ChargeSessionFormat.shortDate(
                    startedAt,
                    localeIdentifier: localeIdentifier,
                    timeZoneIdentifier: timeZoneIdentifier
                )
            } else {
                "#\(index + 1)"
            }
            return ChargeSessionBar(
                plotKey: String(format: "%04d", index),
                label: label,
                energy: converter.kilowattHours(fromWattHours: row.totalEnergyAddedWh ?? 0),
                kind: classify(chargerType: row.chargerType)
            )
        }
        let bars = Array(projected.reversed())
        let total = bars.reduce(0) { $0 + $1.energy }
        let count = bars.count
        let avg = count > 0 ? total / Double(count) : 0
        return ChargeSessionChartProjection(
            bars: bars,
            totalEnergy: total,
            avgEnergy: avg,
            sessionCount: count,
            energyUnit: "kWh",
            hasData: !bars.isEmpty
        )
    }
}
