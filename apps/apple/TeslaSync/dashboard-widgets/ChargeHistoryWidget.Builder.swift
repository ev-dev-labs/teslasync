//
//  ChargeHistoryWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/ChargeHistoryWidget.tsx (the `chartData` map/reverse
//  + the `stats` total/avg memo). The SI→display energy conversion (watt-hours →
//  kWh) is done at this display boundary via an injected converter seam (the
//  native analog of the web `convertEnergyFromSI(wh, 'kWh')`). No SwiftUI /
//  transport here — this is the unit-tested core.
//

import Foundation

// MARK: - Energy converter seam (display boundary — web `convertEnergyFromSI`)

/// SI→display energy conversion at the widget's render boundary. Injected so the
/// projection stays deterministic + testable. The web source hard-codes the
/// `'kWh'` target, so this seam converts watt-hours to kilowatt-hours; the
/// production app may instead wire the shared KMP units engine at the
/// composition root.
public protocol ChargeHistoryEnergyConverting: Sendable {
    /// Converts SI watt-hours to kilowatt-hours (web `convertEnergyFromSI(wh, 'kWh')`).
    func kilowattHours(fromWattHours wattHours: Double) -> Double
}

/// The canonical energy converter, mirroring `convertEnergyFromSI(wh, 'kWh')`
/// exactly: `kWh = Wh / 1000`. Non-finite input collapses to 0 (the web feeds
/// `total_energy_added_wh ?? 0`, so the rendered value is identical).
public struct StandardChargeHistoryEnergyConverter: ChargeHistoryEnergyConverting {
    private static let wattHoursPerKilowattHour = 1000.0

    public init() {}

    public func kilowattHours(fromWattHours wattHours: Double) -> Double {
        let safe = wattHours.isFinite ? wattHours : 0
        return safe / Self.wattHoursPerKilowattHour
    }
}

// MARK: - Number formatting (web `fmt` → `fmtNumber` → `Intl.NumberFormat`)

/// Locale-aware number formatting that mirrors the web `fmt(v, decimals)`
/// (`fmtNumber` → `Intl.NumberFormat`): fixed fraction digits, grouped, with
/// non-finite inputs collapsed to 0 (the web `fmt` runs every value through
/// `safeNumber` first).
public enum ChargeHistoryFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
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
}

// MARK: - Projection builder (port of the web chartData / stats memos)

/// Pure adapter that turns cached charging sessions into the rendered
/// projection, faithfully reproducing the web component's `useMemo` pipeline.
public enum ChargeHistoryBuilder {
    /// Builds the projection: project each session to `{ i, energy }` keeping the
    /// pre-reverse index as the x label (web `map((s, i) => ({ i: String(i), … }))`),
    /// reverse so the oldest session is leftmost (web `.reverse()`), assign a
    /// stable ordered plot key, then derive the Total / Avg energy over every
    /// point (web `stats`: `total = Σenergy`, `avg = total / chartData.length`).
    /// `hasData` mirrors the web `chartData.length > 1` — at least two points are
    /// required before the area trend is shown.
    public static func buildProjection(
        rows: [ChargeHistorySessionDTO],
        converter: ChargeHistoryEnergyConverting = StandardChargeHistoryEnergyConverter()
    ) -> ChargeHistoryChartProjection {
        // web: rows.map((s, i) => ({ i: String(i), energy: convertEnergyFromSI(wh, 'kWh') }))
        let mapped: [(label: String, energy: Double)] = rows.enumerated().map { index, row in
            (String(index), converter.kilowattHours(fromWattHours: row.totalEnergyAddedWh ?? 0))
        }
        // web: .reverse() — oldest (last fetched) session becomes leftmost.
        let reversed = Array(mapped.reversed())
        let points = reversed.enumerated().map { position, item in
            ChargeHistoryPoint(
                plotKey: String(format: "%04d", position),
                indexLabel: item.label,
                energy: item.energy
            )
        }
        let total = points.reduce(0) { $0 + $1.energy }
        let count = points.count
        let avg = count > 0 ? total / Double(count) : 0
        return ChargeHistoryChartProjection(
            points: points,
            totalEnergy: total,
            avgEnergy: avg,
            energyUnit: "kWh",
            hasData: points.count > 1
        )
    }
}
