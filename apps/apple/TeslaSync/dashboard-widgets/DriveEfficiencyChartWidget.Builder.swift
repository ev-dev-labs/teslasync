//
//  DriveEfficiencyChartWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/DriveEfficiencyChartWidget.tsx (estimateEfficiency
//  / buildDailyEfficiency / the displayData / overallAvg / bestDay / trend
//  memos). The SI→display efficiency conversion is done at this display boundary
//  via an injected converter seam (the native analog of the web `useUnits()` +
//  `convertDistanceFromSI`). No SwiftUI / transport here — this is the
//  unit-tested core.
//

import Foundation

// MARK: - Efficiency converter seam (display boundary — web Wh/km → Wh/mi)

/// SI→display efficiency conversion at the widget's render boundary. The web
/// estimates Wh per kilometre, then multiplies by `1.609344` when the user reads
/// miles (a per-mile span covers more distance, so it consumes more Wh). Injected
/// so the projection stays deterministic + testable; the production app may wire
/// the shared KMP units engine at the composition root.
public protocol DriveEfficiencyConverting: Sendable {
    /// Converts a Wh-per-kilometre value into the user's display efficiency unit
    /// (`"mi"` → Wh/mi, anything else → Wh/km).
    func displayEfficiency(whPerKm: Double, unit: String) -> Double
    /// The efficiency unit label for the active distance unit (web
    /// `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`).
    func efficiencyUnitLabel(unit: String) -> String
}

/// The canonical efficiency converter, mirroring the web factor exactly:
/// `WhPerMi = WhPerKm × 1.609344`. Unknown labels fall back to kilometres (the SI
/// canonical display default), matching the web's non-`'mi'` branch.
public struct StandardDriveEfficiencyConverter: DriveEfficiencyConverting {
    private static let kilometersPerMile = 1.609344

    public init() {}

    public func displayEfficiency(whPerKm: Double, unit: String) -> Double {
        isMiles(unit) ? whPerKm * Self.kilometersPerMile : whPerKm
    }

    public func efficiencyUnitLabel(unit: String) -> String {
        isMiles(unit) ? "Wh/mi" : "Wh/km"
    }

    private func isMiles(_ unit: String) -> Bool {
        switch unit.lowercased() {
        case "mi", "mile", "miles":
            true
        default:
            false
        }
    }
}

// MARK: - Number formatting (web `fmtNumber` / the trend template literal)

/// Grouped / signed number formatting matching the web `fmtNumber(value, 0)` and
/// the trend `${trend > 0 ? '+' : ''}${trend}%` template. Non-finite input
/// renders an em dash (never "nan").
public enum DriveEfficiencyFormat {
    private static func formatter(fractionDigits: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = true
        return formatter
    }

    /// Whole-number, grouped (web `fmtNumber(value, 0)`).
    public static func int(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return formatter(fractionDigits: 0).string(from: NSNumber(value: value.rounded())) ?? "—"
    }

    /// Signed percentage with up to one decimal and no trailing zero, matching the
    /// web template literal which prints the raw JS number (`5` → "5%", `5.3` →
    /// "+5.3%", `-2` → "-2%"). `nil` / non-finite renders an em dash.
    public static func trend(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let normalized = value == 0 ? 0 : value
        let sign = normalized > 0 ? "+" : ""
        let magnitude = if normalized == normalized.rounded() {
            String(Int(normalized))
        } else {
            String(format: "%.1f", normalized)
        }
        return "\(sign)\(magnitude)%"
    }
}

// MARK: - Projection builder (port of the web estimate / daily / stat memos)

/// Pure adapter that turns cached drives into the rendered projection, faithfully
/// reproducing the web component's pipeline:
///   1. `estimateEfficiency` — Wh/km per drive (energy first, SoC fallback).
///   2. last-30-day cutoff + `buildDailyEfficiency` — daily mean + 7-day rolling.
///   3. display-unit conversion + `overallAvg` / `bestDay` / `trend` stats.
public enum DriveEfficiencyBuilder {
    /// The rolling-average window (web `buildDailyEfficiency(recent, 7, …)`).
    public static let rollingWindow = 7
    /// The look-back horizon in days (web `cutoff.setDate(getDate() - 30)`).
    public static let lookbackDays = 30
    private static let batteryPackKWh = 0.75
    private static let minDriveKm = 0.8
    private static let minWhPerKm = 30.0
    private static let maxWhPerKm = 500.0

    /// JS `Math.round` parity (half rounds toward +∞, including negatives).
    static func roundHalfUp(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }

    /// Round to one decimal the same way the web does (`Math.round(x * 10) / 10`).
    static func round1(_ value: Double) -> Double {
        roundHalfUp(value * 10) / 10
    }

    /// Estimates Wh/km for a single drive (web `estimateEfficiency`): prefer the
    /// measured energy, fall back to the SoC delta against a 75 kWh pack, and
    /// reject tiny drives + physically implausible values (< 30 or > 500 Wh/km).
    public static func estimateWhPerKm(_ sample: DriveEfficiencySample) -> Double? {
        let distanceKm = sample.distanceM / 1000
        guard distanceKm.isFinite, distanceKm >= minDriveKm else { return nil }

        if let energy = sample.energyUsedWh, energy > 0 {
            let whPerKm = energy / distanceKm
            return inRange(whPerKm) ? whPerKm : nil
        }

        guard let start = sample.startSocPct, let end = sample.endSocPct else { return nil }
        let battUsed = start - end
        guard battUsed > 0 else { return nil }
        let whPerKm = (battUsed * batteryPackKWh * 1000) / distanceKm
        return inRange(whPerKm) ? whPerKm : nil
    }

    private static func inRange(_ whPerKm: Double) -> Bool {
        whPerKm.isFinite && whPerKm >= minWhPerKm && whPerKm <= maxWhPerKm
    }

    /// The `'YYYY-MM-DD'` grouping key for a timestamp (web `start_ts.slice(0, 10)`).
    static func dateKey(_ startTs: String) -> String {
        String(startTs.prefix(10))
    }

    /// Builds the projection. `label` maps a `'YYYY-MM-DD'` key to the short axis
    /// label (the native analog of the injected web `formatDateShort`); `now` +
    /// `calendar` drive the 30-day cutoff and are injectable for deterministic
    /// tests.
    public static func buildProjection(
        samples: [DriveEfficiencySample],
        unit: String,
        converter: DriveEfficiencyConverting = StandardDriveEfficiencyConverter(),
        now: Date = Date(),
        calendar: Calendar = .current,
        label: (String) -> String
    ) -> DriveEfficiencyProjection {
        let cutoff = calendar.date(byAdding: .day, value: -lookbackDays, to: now) ?? now
        let parser = DriveEfficiencyTimestampParser()

        // Group recent drives' Wh/km estimates by calendar day.
        var byDate: [String: [Double]] = [:]
        var order: [String] = []
        for sample in samples {
            guard let startTs = sample.startTs, !startTs.isEmpty else { continue }
            guard let started = parser.date(from: startTs), started >= cutoff else { continue }
            guard let efficiency = estimateWhPerKm(sample) else { continue }
            let key = dateKey(startTs)
            if byDate[key] == nil {
                byDate[key] = [efficiency]
                order.append(key)
            } else {
                byDate[key]?.append(efficiency)
            }
        }

        let sortedKeys = order.sorted()
        let dailyAverages: [(date: String, avg: Double)] = sortedKeys.map { key in
            let values = byDate[key] ?? []
            return (key, values.reduce(0, +) / Double(values.count))
        }

        let points: [DriveEfficiencyPoint] = dailyAverages.enumerated().map { index, entry in
            let windowStart = max(0, index - rollingWindow + 1)
            let window = dailyAverages[windowStart ... index]
            let rollingKm: Double? = window.count >= 2
                ? round1(window.reduce(0) { $0 + $1.avg } / Double(window.count))
                : nil
            let efficiencyKm = round1(entry.avg)
            return DriveEfficiencyPoint(
                date: entry.date,
                index: index,
                label: label(entry.date),
                efficiency: round1(converter.displayEfficiency(whPerKm: efficiencyKm, unit: unit)),
                rollingAvg: rollingKm.map { round1(converter.displayEfficiency(whPerKm: $0, unit: unit)) }
            )
        }

        return DriveEfficiencyProjection(
            points: points,
            overallAvg: overallAverage(points),
            bestDay: bestDay(points),
            trend: trend(points),
            efficiencyUnit: converter.efficiencyUnitLabel(unit: unit),
            distanceUnit: unit
        )
    }

    /// Mean of the daily display efficiencies, rounded to one decimal (web
    /// `overallAvg`). `nil` when there are no points.
    static func overallAverage(_ points: [DriveEfficiencyPoint]) -> Double? {
        guard !points.isEmpty else { return nil }
        let sum = points.reduce(0) { $0 + $1.efficiency }
        return round1(sum / Double(points.count))
    }

    /// The most-efficient day — the minimum display efficiency (web `bestDay`).
    /// `nil` when there are no points.
    static func bestDay(_ points: [DriveEfficiencyPoint]) -> Double? {
        points.map(\.efficiency).min()
    }

    /// Percentage change between the first and second halves of the series (web
    /// `trend`), rounded to one decimal. `nil` with fewer than 4 points or a
    /// degenerate first-half average.
    static func trend(_ points: [DriveEfficiencyPoint]) -> Double? {
        guard points.count >= 4 else { return nil }
        let mid = points.count / 2
        let first = points.prefix(mid).map(\.efficiency)
        let second = points.suffix(points.count - mid).map(\.efficiency)
        guard !first.isEmpty, !second.isEmpty else { return nil }
        let avgFirst = first.reduce(0, +) / Double(first.count)
        let avgSecond = second.reduce(0, +) / Double(second.count)
        guard avgFirst != 0, avgFirst.isFinite else { return nil }
        return roundHalfUp(((avgSecond - avgFirst) / avgFirst) * 1000) / 10
    }

    /// Parses a drive timestamp, tolerating fractional seconds and bare dates;
    /// returns `nil` for unparseable input so the caller drops it (web's
    /// `Invalid Date` never passes the `>= cutoff` comparison).
    static func parseTimestamp(_ iso: String) -> Date? {
        DriveEfficiencyTimestampParser().date(from: iso)
    }
}

// MARK: - Timestamp parsing (web `new Date(start_ts)`)

/// Tolerant ISO-8601 parser holding its formatters once per use. Date formatters
/// are reference types and not `Sendable`, so they are kept as instance state and
/// the parser is created locally (never as global/static state) to stay
/// concurrency-safe under Swift 6 strict concurrency.
struct DriveEfficiencyTimestampParser {
    private let fractional: ISO8601DateFormatter
    private let plain: ISO8601DateFormatter
    private let dateOnly: DateFormatter

    init() {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        self.fractional = fractional

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        self.plain = plain

        let dateOnly = DateFormatter()
        dateOnly.calendar = Calendar(identifier: .gregorian)
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        self.dateOnly = dateOnly
    }

    /// Tries fractional-second ISO-8601, then plain ISO-8601, then a bare
    /// `'YYYY-MM-DD'` (UTC midnight); `nil` when none match.
    func date(from iso: String) -> Date? {
        if let date = fractional.date(from: iso) { return date }
        if let date = plain.date(from: iso) { return date }
        return dateOnly.date(from: String(iso.prefix(10)))
    }
}
