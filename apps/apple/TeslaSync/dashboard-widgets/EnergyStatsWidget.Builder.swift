//
//  EnergyStatsWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  Pure cached→projection adapter — the unit-tested (and host-executed) core. A
//  faithful Swift port of the memoized `chartData` / `hasData` / `hasChartData`
//  derivations and the compact `total_wh / 1000` headline in
//  features/dashboard/widgets/EnergyStatsWidget.tsx. No SwiftUI or transport
//  here.
//

import Foundation

// MARK: - EnergyStatsBuilder (faithful port of the web memos)

/// Derives the chart/summary projection from the cached `EnergyStats` aggregate.
/// Mirrors the web exactly so both platforms chart identical kWh, surface the
/// same totals, and gate the empty state on the same `!!data` rule.
public enum EnergyStatsBuilder {
    // MARK: Date helpers

    /// A UTC `yyyy-MM-dd` formatter — used to derive the daily-bucket key from a
    /// history `date` (and the `today` / `since` query window keys).
    private nonisolated(unsafe) static let utcDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// The `yyyy-MM-dd` day key for an instant, in UTC.
    public static func dayKey(_ date: Date) -> String {
        utcDayFormatter.string(from: date)
    }

    /// The `since` window the energy query is bound with — `days` before `date`
    /// (web `useEnergyStats(id, days = 30)`), as a `yyyy-MM-dd` key.
    public static func sinceKey(from date: Date, days: Int = 30) -> String {
        let past = date.addingTimeInterval(TimeInterval(-days * 24 * 60 * 60))
        return utcDayFormatter.string(from: past)
    }

    /// The `yyyy-MM-dd` bucket of a daily-breakdown `date` (its leading 10 chars).
    /// Buckets arrive as `"2026-06-01"` or `"2026-06-01T00:00:00Z"`; both share
    /// the same 10-char prefix.
    static func dayBucket(_ iso: String) -> String {
        String(iso.prefix(10))
    }

    /// The compact `"M/D"` axis label for a daily bucket.
    ///
    /// The web binds the raw `date` string straight to the Recharts x-axis; on a
    /// cramped native widget axis that ISO string is unreadable, so we render the
    /// concise `month/day` (per Apple HIG axis-label guidance and matching the
    /// sibling SolarProductionWidget). We format the bucket's own calendar date
    /// (from the `yyyy-MM-dd` prefix) so a midnight-UTC bucket is never shifted a
    /// day by the device time zone. Unparseable input falls back to the raw
    /// string, mirroring the web `isNaN` guard.
    static func shortDate(_ iso: String) -> String {
        let bucket = dayBucket(iso)
        let parts = bucket.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let month = Int(parts[1]),
              let day = Int(parts[2]),
              (1 ... 12).contains(month),
              (1 ... 31).contains(day)
        else {
            return iso
        }
        return "\(month)/\(day)"
    }

    /// kWh for one daily row (web chart `energy: d.energy_wh ?? 0`, plotted as
    /// kWh — `(wh ?? 0) / 1000`).
    static func kwh(_ wh: Double?) -> Double {
        (wh ?? 0) / 1000
    }

    // MARK: Projection

    /// Builds the full projection from the cached `EnergyStats` aggregate.
    ///
    /// - `data == nil`  → `.empty` (web `!data` → the "No energy data" empty state).
    /// - `points`       → one `EnergyDailyPoint` per `daily_breakdown` row, in order.
    /// - scalar metrics → the SI passthroughs, each `?? 0` like the web stat builder.
    /// - `compactKwh`   → `total_wh / 1000` (web compact headline).
    /// - `hasData`      → `true` whenever a `data` aggregate is present (web `!!data`).
    public static func buildProjection(data: EnergyStatsData?) -> EnergyStatsProjection {
        guard let data else { return .empty }

        let points = data.dailyBreakdown.enumerated().map { index, entry in
            EnergyDailyPoint(
                index: index,
                isoDay: dayBucket(entry.date),
                dateLabel: shortDate(entry.date),
                energyKwh: kwh(entry.energyWh)
            )
        }

        return EnergyStatsProjection(
            points: points,
            totalEnergyUsedWh: data.totalEnergyUsedWh ?? 0,
            totalEnergyChargedWh: data.totalEnergyChargedWh ?? 0,
            avgEfficiencyWhPerM: data.avgEfficiencyWhPerM ?? 0,
            co2SavedKg: data.co2SavedKg ?? 0,
            totalCost: data.totalCost ?? 0,
            compactKwh: (data.totalWh ?? 0) / 1000,
            hasData: true
        )
    }
}
