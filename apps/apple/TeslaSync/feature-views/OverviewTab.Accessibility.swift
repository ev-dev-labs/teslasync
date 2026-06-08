//
//  OverviewTab.Accessibility.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  The pure compact-number + VoiceOver chart-summary helpers split out of the adapter (kept
//  under the per-file length budget). Foundation-only so the spoken chart content can be
//  unit-tested without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Number / axis formatting (web `fmtNumber` / chart ticks)

/// Locale-aware compact numeric rendering for axis ticks, tooltips, and VoiceOver. Pure so
/// the formatting can be unit-tested without a rendered chart.
public enum OverviewFormat {
    /// Abbreviated axis/summary label; non-finite input renders an em dash (never "nan"),
    /// mirroring the shared chart `axisLabel` so every platform shows identical ticks.
    public static func axisLabel(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000)
        case 1000...:
            return String(format: "%.1fk", value / 1000)
        default:
            return String(format: "%.0f", value)
        }
    }

    /// One-decimal value for tooltips / leaderboard-style readouts (web `fmtNumber(x, 1)`).
    public static func decimal(_ value: Double, fractionDigits: Int = 1) -> String {
        guard value.isFinite else { return "—" }
        return String(format: "%.\(max(0, fractionDigits))f", value)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver summaries for the three charts. Pure + public so the spoken content
/// can be unit-tested without rendering. The chart title resolves through the injected
/// localizer (bundle-free in tests); series names arrive already localized.
public enum OverviewAccessibility {
    /// A concise per-series readout: "<name>: min X, max Y, latest Z" (mirrors the shared
    /// chart summary). An empty series reads "<name>: no data".
    public static func seriesSummary(name: String, values: [Double]) -> String {
        let finite = values.filter(\.isFinite)
        guard let first = finite.first else { return "\(name): no data" }
        let minimum = finite.min() ?? first
        let maximum = finite.max() ?? first
        let latest = finite.last ?? first
        let parts = [
            "min \(OverviewFormat.axisLabel(minimum))",
            "max \(OverviewFormat.axisLabel(maximum))",
            "latest \(OverviewFormat.axisLabel(latest))"
        ]
        return "\(name): \(parts.joined(separator: ", "))"
    }

    /// "Distance by Vehicle" chart label: title + per-vehicle distance with the unit.
    public static func distanceSummary(
        bars: [OverviewVehicleBar],
        unitLabel: String,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.overview.distByVehicle", "Distance by Vehicle")
        guard !bars.isEmpty else {
            return "\(title). \(localize("analytics.overview.noVehicles", "No vehicle data"))"
        }
        let rows = bars
            .map { "\($0.name) \(OverviewFormat.axisLabel($0.distance)) \(unitLabel)" }
            .joined(separator: ", ")
        return "\(title). \(rows)"
    }

    /// "Day of Week Pattern" chart label: title + the drives + average-distance summaries.
    public static func daySummary(
        data: [OverviewDayDatum],
        drivesName: String,
        avgName: String,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.overview.dayOfWeek", "Day of Week Pattern")
        guard !data.isEmpty else {
            return "\(title). \(localize("analytics.overview.noDow", "No day-of-week data"))"
        }
        let drives = seriesSummary(name: drivesName, values: data.map(\.drives))
        let avg = seriesSummary(name: avgName, values: data.map(\.avgDistance))
        return "\(title). \(drives). \(avg)"
    }

    /// "Monthly Cost Comparison" chart label: title + electric/gas/savings summaries.
    public static func monthSummary(
        data: [OverviewMonthDatum],
        electricName: String,
        gasName: String,
        savingsName: String,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.overview.monthlyCost", "Monthly Cost Comparison")
        guard !data.isEmpty else {
            return "\(title). \(localize("analytics.overview.noMonthly", "No monthly data"))"
        }
        let electric = seriesSummary(name: electricName, values: data.map(\.cost))
        let gas = seriesSummary(name: gasName, values: data.map(\.gasCost))
        let savings = seriesSummary(name: savingsName, values: data.map(\.savings))
        return "\(title). \(electric). \(gas). \(savings)"
    }
}
