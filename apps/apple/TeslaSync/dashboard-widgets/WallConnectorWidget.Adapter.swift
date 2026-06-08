//
//  WallConnectorWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0112 · WallConnectorWidget (Apple)
//
//  The testable projection core: cached Tesla Wall Connector charging entries
//  (energy in watt-hours, SI-on-disk) → the view-ready daily-kWh bar series + the
//  current-month summary stats, a faithful port of the web source's `chartData`
//  daily aggregation + the `monthTotalKwh` / `monthSessions` / `avgKwhPerSession`
//  memos. Also the number formatters (parity with web `fmtNumber` / `fmtInt` /
//  chart `fmt`) and the VoiceOver summary builders. Everything here is pure and
//  Foundation-only (no SwiftUI, no networking) so the adapter can be exercised by a
//  plain `swift` host harness and XCTest without a store, a bundle, or a view.
//

import Foundation

// MARK: - Cached input (port of web TeslaWCChargingEntry / TeslaEnergySite subset)

/// The linked Tesla Energy site (web `sites[0]`). Presence indicates a site is
/// linked; the web only reads `energy_site_id`, so that is all the projection needs.
public struct WallConnectorSiteInput: Sendable, Equatable {
    public var energySiteID: Int64

    public init(energySiteID: Int64) {
        self.energySiteID = energySiteID
    }
}

/// One cached Wall Connector charging entry (web `TeslaWCChargingEntry`). Energy is
/// in watt-hours and nullable (web `energy_wh: number | null`), matching the
/// SI-on-disk contract; the projection converts to kWh at the display boundary
/// (web `(energy_wh ?? 0) / 1000`).
public struct WallConnectorEntryInput: Sendable, Equatable {
    public var timestamp: Date
    public var energyWh: Double?

    public init(timestamp: Date, energyWh: Double? = nil) {
        self.timestamp = timestamp
        self.energyWh = energyWh
    }
}

// MARK: - Daily bar (port of web ChartDatum { date, energy_kwh })

/// One plotted bar: a calendar day's total charged energy in kWh, with its short
/// "M/D" axis label. The native port of the web `ChartDatum` produced by the daily
/// `byDay` aggregation.
public struct WallConnectorDailyBar: Identifiable, Equatable, Sendable {
    public let id: String
    public let day: Date
    public let label: String
    public let energyKwh: Double

    public init(day: Date, label: String, energyKwh: Double, id: String) {
        self.day = day
        self.label = label
        self.energyKwh = energyKwh
        self.id = id
    }
}

// MARK: - Summary (port of web monthTotalKwh / monthSessions / avgKwhPerSession)

/// The current-month header stats: total kWh, session count, and mean kWh per
/// session — the native port of the web `useMemo` month aggregation.
public struct WallConnectorSummary: Equatable, Sendable {
    public let monthTotalKwh: Double
    public let monthSessions: Int
    public let avgKwhPerSession: Double

    public init(monthTotalKwh: Double, monthSessions: Int, avgKwhPerSession: Double) {
        self.monthTotalKwh = monthTotalKwh
        self.monthSessions = monthSessions
        self.avgKwhPerSession = avgKwhPerSession
    }

    /// The neutral summary shown before any data resolves.
    public static let zero = WallConnectorSummary(monthTotalKwh: 0, monthSessions: 0, avgKwhPerSession: 0)
}

// MARK: - Projection core

/// Pure projection from cached watt-hour entries to the view-ready daily kWh bars +
/// the month summary + the has-data predicate. Mirrors the web `chartData` daily
/// aggregation and the `monthTotalKwh` / `monthSessions` / `avgKwhPerSession` /
/// `hasData` memos. A `Calendar` is injectable so day bucketing + the "same month"
/// test are deterministic under test.
public enum WallConnectorProjection {
    /// Aggregates entries into one bar per calendar day (web `byDay` map): sums
    /// `(energy_wh ?? 0) / 1000` per day, sorts ascending by day, and labels each
    /// bar "M/D" (web `shortDate`).
    public static func dailyBars(
        from entries: [WallConnectorEntryInput],
        calendar: Calendar = .current
    ) -> [WallConnectorDailyBar] {
        var totals: [Date: Double] = [:]
        for entry in entries {
            let day = calendar.startOfDay(for: entry.timestamp)
            totals[day, default: 0] += (entry.energyWh ?? 0) / 1000
        }
        return totals
            .map { day, kwh in
                WallConnectorDailyBar(
                    day: day,
                    label: dayLabel(day, calendar: calendar),
                    energyKwh: kwh,
                    id: dayKey(day, calendar: calendar)
                )
            }
            .sorted { $0.day < $1.day }
    }

    /// Projects the current-month stats relative to `now` (web `isSameMonth` +
    /// `monthTotalKwh` / `monthSessions` / `avgKwhPerSession`). The session count is
    /// every entry in the month (web counts rows, including null-energy ones).
    public static func summary(
        for entries: [WallConnectorEntryInput],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> WallConnectorSummary {
        let monthEntries = entries.filter {
            calendar.isDate($0.timestamp, equalTo: now, toGranularity: .month)
        }
        let total = monthEntries.reduce(0) { $0 + ($1.energyWh ?? 0) / 1000 }
        let count = monthEntries.count
        let average = count > 0 ? total / Double(count) : 0
        return WallConnectorSummary(monthTotalKwh: total, monthSessions: count, avgKwhPerSession: average)
    }

    /// Whether any day carries a non-zero charge (web
    /// `chartData.length > 0 && chartData.some(d => d.energy_kwh > 0)`); gates the
    /// noData empty surface.
    public static func hasData(_ bars: [WallConnectorDailyBar]) -> Bool {
        bars.contains { $0.energyKwh > 0 }
    }

    /// The stable "YYYY-MM-DD" key for a day (web `slice(0, 10)`), used as the bar id.
    static func dayKey(_ day: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: day)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The short "M/D" axis label for a day (web `shortDate` → `${month}/${date}`).
    static func dayLabel(_ day: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.month, .day], from: day)
        return "\(parts.month ?? 0)/\(parts.day ?? 0)"
    }
}

// MARK: - Formatters (web `fmtNumber` / `fmtInt` / chart `fmt`)

/// Locale-aware number formatting for the surface, kept pure so the rendered
/// strings can be asserted deterministically with an explicit locale.
public enum WallConnectorFormat {
    /// Fixed-fraction kWh value (web `fmtNumber(value, 1)`). Non-finite input
    /// renders an em dash rather than "nan".
    public static func kilowattHours(
        _ value: Double,
        fractionDigits: Int = 1,
        locale: Locale = .current
    ) -> String {
        decimal(value, fractionDigits: fractionDigits, locale: locale)
    }

    /// Whole-number session count (web `fmtInt`).
    public static func integer(_ value: Int, locale: Locale = .current) -> String {
        decimal(Double(value), fractionDigits: 0, locale: locale)
    }

    /// Zero-fraction axis tick value (web chart `fmt(v, 0)`).
    public static func axisKwh(_ value: Double, locale: Locale = .current) -> String {
        decimal(value, fractionDigits: 0, locale: locale)
    }

    /// Shared locale-aware fixed-fraction core. Half-up (away from zero) so display
    /// matches the web `Intl.toLocaleString` rounding, not `NumberFormatter`'s
    /// default banker's rounding.
    static func decimal(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the stat row + the bar chart. Pure + public so
/// the spoken content can be unit-tested without rendering the view.
public enum WallConnectorAccessibility {
    /// One spoken stat fragment, e.g. "This Month: 42.5 kWh" or "Sessions: 7".
    public static func statLabel(
        label: String,
        value: String,
        unit: String?
    ) -> String {
        guard let unit, !unit.isEmpty else { return "\(label): \(value)" }
        return "\(label): \(value) \(unit)"
    }

    /// The combined VoiceOver summary for the chart (title + this month's totals).
    public static func chartSummary(
        summary: WallConnectorSummary,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("widget.wallConnector.title", "Wall Connector")
        let kwhUnit = localize("widget.wallConnector.unitKwh", "kWh")
        let monthLabel = localize("widget.wallConnector.monthTotal", "This Month")
        let sessionsLabel = localize("widget.wallConnector.sessions", "Sessions")
        let parts = [
            title,
            statLabel(
                label: monthLabel,
                value: WallConnectorFormat.kilowattHours(summary.monthTotalKwh, locale: locale),
                unit: kwhUnit
            ),
            statLabel(
                label: sessionsLabel,
                value: WallConnectorFormat.integer(summary.monthSessions, locale: locale),
                unit: nil
            )
        ]
        return parts.joined(separator: ". ")
    }
}
