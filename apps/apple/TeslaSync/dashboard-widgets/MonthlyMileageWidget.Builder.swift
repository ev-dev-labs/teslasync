//
//  MonthlyMileageWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/MonthlyMileageWidget.tsx (shortMonth /
//  currentMonthKey / chartData / totals). The SI→display distance conversion is
//  done at this display boundary via an injected converter seam (the native
//  analog of the web `useUnits()` + `convertDistanceFromSI`). No SwiftUI /
//  transport here — this is the unit-tested core.
//

import Foundation

// MARK: - Distance converter seam (display boundary — web `convertDistanceFromSI`)

/// SI→display distance conversion at the widget's render boundary. Injected so
/// the projection stays deterministic + testable; the production app may wire the
/// shared KMP units engine (`Units.convertDistance`) at the composition root,
/// while previews/tests use the standard converter below.
public protocol MonthlyMileageDistanceConverting: Sendable {
    /// Converts SI metres to the user's display distance unit (`"km"`/`"mi"`/`"ft"`).
    func display(meters: Double, unit: String) -> Double
}

/// The canonical distance converter, mirroring the shared `Units.kt` /
/// `lib/unitConversion.ts` factors exactly: `km = m / 1000`, `mi = m / 1609.344`,
/// `ft = m / 0.3048`. Distance conversion is exact (no rounding) so this matches
/// the KMP golden vectors with no cross-platform drift. Unknown labels fall back
/// to kilometres (the SI canonical display default).
public struct StandardMileageDistanceConverter: MonthlyMileageDistanceConverting {
    private static let metersPerKilometer = 1000.0
    private static let metersPerMile = 1609.344
    private static let metersPerFoot = 0.3048

    public init() {}

    public func display(meters: Double, unit: String) -> Double {
        switch unit.lowercased() {
        case "mi", "mile", "miles":
            meters / Self.metersPerMile
        case "ft", "foot", "feet":
            meters / Self.metersPerFoot
        default:
            meters / Self.metersPerKilometer
        }
    }
}

// MARK: - Number formatting (web `fmtInt` / `fmtNumber`)

/// Grouped decimal formatting matching the web `fmtInt` / `fmtNumber`
/// (`lib/numberFormat.ts`). Non-finite input renders an em dash (never "nan").
public enum MonthlyMileageFormat {
    private static func formatter(fractionDigits: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = true
        return formatter
    }

    /// Whole-number, grouped (web `fmtInt`).
    public static func int(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        return formatter(fractionDigits: 0).string(from: NSNumber(value: value.rounded())) ?? "—"
    }

    /// `digits`-decimal, grouped (web `fmtNumber(value, digits)`).
    public static func decimal(_ value: Double, digits: Int) -> String {
        guard value.isFinite else { return "—" }
        return formatter(fractionDigits: digits).string(from: NSNumber(value: value)) ?? "—"
    }
}

// MARK: - Projection builder (port of the web chartData / totals memos)

/// Pure adapter that turns cached month buckets into the rendered projection,
/// faithfully reproducing the web component's `useMemo` pipeline.
public enum MonthlyMileageBuilder {
    private static let monthAbbreviations = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ]

    /// Formats `"2026-04"` → `"Apr"` (web `shortMonth`). Falls back to the raw
    /// value when the input is malformed or the month index is out of range.
    public static func shortMonth(_ iso: String) -> String {
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count >= 2, let month = Int(parts[1]) else { return iso }
        let index = month - 1
        guard monthAbbreviations.indices.contains(index) else { return iso }
        return monthAbbreviations[index]
    }

    /// The current `"YYYY-MM"` key for `now` (web `currentMonthKey`). The
    /// `calendar` is injectable so tests are deterministic.
    public static func currentMonthKey(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.year, .month], from: now)
        guard let year = components.year, let month = components.month else { return "" }
        return String(format: "%04d-%02d", year, month)
    }

    /// Builds the projection: keep the last 12 buckets, convert each distance to
    /// the display unit, flag the current month, and derive the stat totals
    /// (web `chartData` / `totalDistance` / `currentMonthDistance` / `hasData`).
    public static func buildProjection(
        rows: [MileageMonthRow],
        unit: String,
        converter: MonthlyMileageDistanceConverting = StandardMileageDistanceConverter(),
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> MonthlyMileageProjection {
        let currentKey = currentMonthKey(now, calendar: calendar)
        let bars = rows.suffix(12).map { row in
            MileageBar(
                month: shortMonth(row.yearMonth),
                yearMonth: row.yearMonth,
                distance: converter.display(meters: row.totalKm * 1000, unit: unit),
                isCurrent: row.yearMonth == currentKey
            )
        }
        let total = bars.reduce(0) { $0 + $1.distance }
        let currentMonth = bars.first(where: \.isCurrent)?.distance ?? 0
        let hasData = !bars.isEmpty && bars.contains { $0.distance > 0 }
        return MonthlyMileageProjection(
            bars: bars,
            currentMonthDistance: currentMonth,
            total12mDistance: total,
            distanceUnit: unit,
            hasData: hasData
        )
    }
}
