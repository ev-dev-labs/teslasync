//
//  SolarProductionWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  Pure cached→projection adapter — the unit-tested (and host-executed) core. A
//  faithful Swift port of the memoized `chartData` / `todayKwh` / `totalKwh` /
//  `avgKwh` derivations and the `shortDate` / `todayKey` / `since` helpers in
//  features/dashboard/widgets/SolarProductionWidget.tsx. No SwiftUI or transport
//  here.
//

import Foundation

// MARK: - SolarProductionBuilder (faithful port of the web memos)

/// Derives the chart/summary projection from the cached daily energy-history
/// rows. Mirrors the web exactly so both platforms chart identical kWh, surface
/// the same Today value, and gate the empty state on the same rule.
public enum SolarProductionBuilder {
    // MARK: Date helpers

    /// A UTC `yyyy-MM-dd` formatter — matches the web `Date.toISOString().slice(0,10)`
    /// used for both `todayKey()` and the 30-day `since` window.
    private nonisolated(unsafe) static let utcDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// The `yyyy-MM-dd` day key for an instant, in UTC (web `todayKey()`:
    /// `new Date().toISOString().slice(0, 10)`).
    public static func dayKey(_ date: Date) -> String {
        utcDayFormatter.string(from: date)
    }

    /// The 30-days-ago `since` window the history query is bound with (web
    /// `since = (today − 30d).toISOString().slice(0, 10)`).
    public static func sinceKey(from date: Date) -> String {
        let past = date.addingTimeInterval(-30 * 24 * 60 * 60)
        return utcDayFormatter.string(from: past)
    }

    /// The `yyyy-MM-dd` bucket of a history `timestamp` (its leading 10 chars).
    /// Daily buckets arrive as `"2026-06-01"` or `"2026-06-01T00:00:00Z"`; both
    /// share the same 10-char prefix.
    static func dayBucket(_ iso: String) -> String {
        String(iso.prefix(10))
    }

    /// The compact "M/D" axis label for a daily bucket (web `shortDate`).
    ///
    /// The web parses the ISO string into a `Date` and reads the viewer-local
    /// `getMonth()+1`/`getDate()`. We instead format the bucket's own calendar
    /// date (month/day from the `yyyy-MM-dd` prefix) so a midnight-UTC bucket is
    /// never shifted a day by the device time zone — the daily total belongs to
    /// the labelled day regardless of where it is read. Unparseable input falls
    /// back to the raw string, mirroring the web `isNaN` guard.
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

    /// Solar kWh for one row (web `(entry.solar_energy_wh ?? 0) / 1000`).
    static func kwh(_ wh: Double?) -> Double {
        (wh ?? 0) / 1000
    }

    // MARK: Projection

    /// Builds the full projection from the cached history rows + the resolved
    /// "today" key (web `chartData` / `todayKwh` / `totalKwh` / `avgKwh`).
    ///
    /// - `chartData`  → one `SolarDailyPoint` per row, in row order.
    /// - `todayKwh`   → the row whose bucket equals `todayKey`, else `0`.
    /// - `totalKwh`   → Σ of the points' kWh.
    /// - `avgKwh`     → `total / count`, or `0` when empty.
    /// - `hasData`    → at least one row AND at least one positive day.
    public static func buildProjection(history: [SolarHistoryEntry], todayKey: String) -> SolarProjection {
        let points = history.enumerated().map { index, entry in
            SolarDailyPoint(
                index: index,
                isoDay: dayBucket(entry.timestamp),
                dateLabel: shortDate(entry.timestamp),
                solarKwh: kwh(entry.solarEnergyWh)
            )
        }

        let todayKwh = kwh(
            history.first { dayBucket($0.timestamp) == todayKey }?.solarEnergyWh
        )

        let totalKwh = points.reduce(0) { $0 + $1.solarKwh }
        let avgKwh = points.isEmpty ? 0 : totalKwh / Double(points.count)
        let hasData = !points.isEmpty && points.contains { $0.solarKwh > 0 }

        return SolarProjection(
            points: points,
            todayKwh: todayKwh,
            totalKwh: totalKwh,
            avgKwh: avgKwh,
            hasData: hasData
        )
    }
}
