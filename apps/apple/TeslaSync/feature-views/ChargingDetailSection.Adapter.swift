//
//  ChargingDetailSection.Adapter.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  The testable projection core for the charging-analytics section: the decoded
//  domain models (parity with the web `FleetAnalytics.charging_analytics` slice),
//  the `safe()` numeric guard (port of the web `safe` from `@/components/charts`),
//  the charger-brand leaderboard (web `brandLeaderboard` memo), the charger-type
//  share bars (web `chargerTypes.map` percentage logic), the dual-axis scale for
//  the monthly-trend composed chart (web `ComposedChart` left/right `YAxis`), and
//  the VoiceOver summary builders. Everything here is pure + dependency-free
//  (Foundation only) so it can be unit-tested without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safe`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used everywhere a
/// count / metric feeds arithmetic so a `NaN` / `Infinity` never reaches a bar
/// width, an axis, or a label.
public enum ChargingNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Abbreviated axis label; non-finite input renders an em dash (never "nan").
    /// Native parity of the web chart axis tick formatter.
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
}

// MARK: - Domain models (port of `charging_analytics`)

/// One charger-brand row (web `charger_brands[i]` — `{ brand, count }`).
public struct ChargerBrandDatum: Identifiable, Equatable, Sendable {
    public var brand: String
    public var count: Double

    public var id: String {
        brand
    }

    public init(brand: String, count: Double) {
        self.brand = brand
        self.count = count
    }
}

/// One charger-type row (web `charger_types[i]` — `{ type, count }`).
public struct ChargingDetailSectionChargerTypeDatum: Identifiable, Equatable, Sendable {
    public var type: String
    public var count: Double

    public var id: String {
        type
    }

    public init(type: String, count: Double) {
        self.type = type
        self.count = count
    }
}

/// One month of the charging trend (web `monthly_trend[i]`). The section plots
/// `energy`, `avgPower`, and `sessions`; `cost` is carried for the accessible
/// summary so the spoken description matches the visible composition.
public struct MonthlyChargePoint: Identifiable, Equatable, Sendable {
    public var month: String
    public var energy: Double
    public var avgPower: Double
    public var sessions: Double
    public var cost: Double

    public var id: String {
        month
    }

    public init(month: String, energy: Double, avgPower: Double, sessions: Double, cost: Double = 0) {
        self.month = month
        self.energy = energy
        self.avgPower = avgPower
        self.sessions = sessions
        self.cost = cost
    }
}

/// The cost summary (web `cost_stats` — a `StatsSummary`). The section reads
/// `min` / `avg` / `median` / `max`; `p95` / `count` are carried for completeness.
public struct CostStats: Equatable, Sendable {
    public var min: Double
    public var avg: Double
    public var median: Double
    public var max: Double
    public var p95: Double
    public var count: Double

    public init(min: Double, avg: Double, median: Double, max: Double, p95: Double = 0, count: Double = 0) {
        self.min = min
        self.avg = avg
        self.median = median
        self.max = max
        self.p95 = p95
        self.count = count
    }
}

/// The full `charging_analytics` slice the section renders (the four panels'
/// inputs). `costStats` is optional so the cost panel can show its empty state
/// independently (web `costStats ? … : <EmptyState/>`).
public struct ChargingAnalytics: Equatable, Sendable {
    public var brands: [ChargerBrandDatum]
    public var chargerTypes: [ChargingDetailSectionChargerTypeDatum]
    public var monthlyTrend: [MonthlyChargePoint]
    public var costStats: CostStats?

    public init(
        brands: [ChargerBrandDatum] = [],
        chargerTypes: [ChargingDetailSectionChargerTypeDatum] = [],
        monthlyTrend: [MonthlyChargePoint] = [],
        costStats: CostStats? = nil
    ) {
        self.brands = brands
        self.chargerTypes = chargerTypes
        self.monthlyTrend = monthlyTrend
        self.costStats = costStats
    }

    /// Whether every panel is empty (no brands, types, months, or cost stats).
    /// Drives the section-level empty disposition without hiding any panel.
    public var isEmpty: Bool {
        brands.isEmpty && chargerTypes.isEmpty && monthlyTrend.isEmpty && costStats == nil
    }
}

// MARK: - Charger-brand leaderboard (port of the web `brandLeaderboard`)

/// One leaderboard row — rank (web `#{idx + 1}`), brand, count, and a `0…1`
/// fill fraction (web `pct = count / maxCount * 100`, kept here as a fraction so
/// the view multiplies by the track width).
public struct BrandLeaderboardRow: Identifiable, Equatable, Sendable {
    public var rank: Int
    public var brand: String
    public var count: Double
    public var fraction: Double

    public var id: String {
        brand
    }

    public init(rank: Int, brand: String, count: Double, fraction: Double) {
        self.rank = rank
        self.brand = brand
        self.count = count
        self.fraction = fraction
    }
}

/// One charger-type share — the label, the count, the `0…1` fill fraction (web
/// `pct = count / totalSessions * 100`), the percentage value for the trailing
/// label (web `fmtInt(pct)`), and the palette index (web `CHART_COLORS[i % len]`).
public struct ChargerTypeShare: Identifiable, Equatable, Sendable {
    public var type: String
    public var count: Double
    public var fraction: Double
    public var percent: Double
    public var colorIndex: Int

    public var id: String {
        "\(colorIndex)-\(type)"
    }

    public init(type: String, count: Double, fraction: Double, percent: Double, colorIndex: Int) {
        self.type = type
        self.count = count
        self.fraction = fraction
        self.percent = percent
        self.colorIndex = colorIndex
    }
}

// MARK: - Monthly-trend dual-axis scale (port of the web left/right `YAxis`)

/// The dual-axis scale for the monthly composed chart. The web binds `energy`
/// (area) + `sessions` (bars) to the LEFT axis and `avg_power` (line) to the
/// RIGHT axis. Swift Charts shares one y-domain, so the line is re-projected onto
/// the left domain (`plotted`) and a trailing axis is drawn with labels mapped
/// back to the true power (`truePower(fromPlotted:)`). Pure + tested.
public struct MonthlyTrendScale: Equatable, Sendable {
    /// Top of the left domain (max of energy / sessions across months, ≥ 1).
    public let leftMax: Double
    /// Top of the right domain (max avg power across months, ≥ 1).
    public let rightMax: Double

    public init(leftMax: Double, rightMax: Double) {
        self.leftMax = Swift.max(leftMax, 1)
        self.rightMax = Swift.max(rightMax, 1)
    }

    /// Projects a true power value (right units) onto the left plotting domain.
    public func plotted(power: Double) -> Double {
        ChargingNumeric.safe(power) * (leftMax / rightMax)
    }

    /// Inverts `plotted(power:)` — maps a left-domain value back to true power for
    /// the trailing-axis labels.
    public func truePower(fromPlotted plotted: Double) -> Double {
        plotted * (rightMax / leftMax)
    }

    /// Upper bound for `chartYScale` with a little headroom so the top mark and
    /// the trailing ticks are not clipped.
    public var domainUpperBound: Double {
        Swift.max(leftMax * 1.05, 1)
    }

    /// Five evenly spaced left-domain tick positions for the trailing axis.
    public var trailingTickPositions: [Double] {
        (0 ... 4).map { Double($0) / 4 * leftMax }
    }
}

// MARK: - Projection (port of the web memos)

/// The pure projection from the decoded `ChargingAnalytics` to the view models the
/// four panels render. Each function mirrors a web computation exactly.
public enum ChargingProjection {
    /// The charger-brand leaderboard (web `brandLeaderboard`): `maxCount` is the
    /// largest count (or `1` so an all-zero / empty list never divides by zero),
    /// each row's `fraction` is `count / maxCount`, ranked from `1` in source order.
    public static func brandLeaderboard(_ brands: [ChargerBrandDatum]) -> [BrandLeaderboardRow] {
        let maxCount = brands.reduce(0.0) { Swift.max($0, ChargingNumeric.safe($1.count)) }
        let divisor = maxCount > 0 ? maxCount : 1
        return brands.enumerated().map { index, brand in
            let count = ChargingNumeric.safe(brand.count)
            return BrandLeaderboardRow(
                rank: index + 1,
                brand: brand.brand,
                count: count,
                fraction: count / divisor
            )
        }
    }

    /// The charger-type share bars (web `chargerTypes.map`): `totalSessions` is the
    /// sum of all counts, each `fraction` is `count / total` (`0` when total is
    /// `0`), `percent` is that as `0…100`, and `colorIndex` is the source index
    /// (the palette wraps it, matching web `CHART_COLORS[i % CHART_COLORS.length]`).
    public static func chargerTypeShares(_ types: [ChargingDetailSectionChargerTypeDatum]) -> [ChargerTypeShare] {
        let total = types.reduce(0.0) { $0 + ChargingNumeric.safe($1.count) }
        return types.enumerated().map { index, datum in
            let count = ChargingNumeric.safe(datum.count)
            let fraction = total > 0 ? count / total : 0
            return ChargerTypeShare(
                type: datum.type,
                count: count,
                fraction: fraction,
                percent: fraction * 100,
                colorIndex: index
            )
        }
    }

    /// The dual-axis scale for the monthly composed chart. `leftMax` spans energy
    /// and sessions (both LEFT-axis series in the web); `rightMax` spans avg power.
    public static func monthlyTrendScale(_ points: [MonthlyChargePoint]) -> MonthlyTrendScale {
        var leftMax = 0.0
        var rightMax = 0.0
        for point in points {
            leftMax = Swift.max(leftMax, ChargingNumeric.safe(point.energy))
            leftMax = Swift.max(leftMax, ChargingNumeric.safe(point.sessions))
            rightMax = Swift.max(rightMax, ChargingNumeric.safe(point.avgPower))
        }
        return MonthlyTrendScale(leftMax: leftMax, rightMax: rightMax)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The four cost-card labels, bundled so the cost summary stays a small function
/// (and avoids a wide tuple). All values are pre-localized.
public struct CostLabels: Equatable, Sendable {
    public var min: String
    public var avg: String
    public var median: String
    public var max: String

    public init(min: String, avg: String, median: String, max: String) {
        self.min = min
        self.avg = avg
        self.median = median
        self.max = max
    }
}

/// The monthly-trend labels (title + the three series), bundled for the same
/// reason as `CostLabels`. All values are pre-localized.
public struct MonthlyTrendLabels: Equatable, Sendable {
    public var title: String
    public var energy: String
    public var power: String
    public var sessions: String

    public init(title: String, energy: String, power: String, sessions: String) {
        self.title = title
        self.energy = energy
        self.power = power
        self.sessions = sessions
    }
}

/// Builds the VoiceOver strings for the section's data so the spoken content can
/// be unit-tested without rendering a view. Each builder takes the P1/S10
/// `localize` facade plus pre-resolved formatters, so no literal is hardcoded.
public enum ChargingAccessibility {
    /// "#1 Tesla, 1,204 sessions" — rank, brand, formatted count + the `sessions`
    /// word (web `{fmtInt(count)} {t('analytics.charging.sessions')}`).
    public static func brandRowSummary(
        _ row: BrandLeaderboardRow,
        sessionsWord: String,
        formatInt: (Double) -> String
    ) -> String {
        "#\(row.rank) \(row.brand), \(formatInt(row.count)) \(sessionsWord)"
    }

    /// "Supercharger, 842 (63%)" — type, formatted count, integer percent (web
    /// `{safe(count)} ({fmtInt(pct)}%)`).
    public static func chargerTypeSummary(
        _ share: ChargerTypeShare,
        formatInt: (Double) -> String
    ) -> String {
        "\(share.type), \(formatInt(share.count)) (\(formatInt(share.percent))%)"
    }

    /// "Min Cost $1.20, Avg Cost $3.40, Median Cost $3.10, Max Cost $9.80" — the
    /// four cost cards spoken as one combined element.
    public static func costSummary(
        _ stats: CostStats,
        labels: CostLabels,
        formatCurrency: (Double) -> String
    ) -> String {
        let parts = [
            "\(labels.min) \(formatCurrency(ChargingNumeric.safe(stats.min)))",
            "\(labels.avg) \(formatCurrency(ChargingNumeric.safe(stats.avg)))",
            "\(labels.median) \(formatCurrency(ChargingNumeric.safe(stats.median)))",
            "\(labels.max) \(formatCurrency(ChargingNumeric.safe(stats.max)))"
        ]
        return parts.joined(separator: ", ")
    }

    /// A concise summary of the monthly trend: month span plus the energy, power,
    /// and session ranges, so the chart is not an opaque image to VoiceOver.
    public static func monthlyTrendSummary(
        _ points: [MonthlyChargePoint],
        labels: MonthlyTrendLabels,
        formatInt: (Double) -> String
    ) -> String {
        guard let first = points.first, let last = points.last else { return labels.title }
        let energy = points.map { ChargingNumeric.safe($0.energy) }
        let power = points.map { ChargingNumeric.safe($0.avgPower) }
        let sessions = points.reduce(0.0) { $0 + ChargingNumeric.safe($1.sessions) }
        let span = first.month == last.month ? first.month : "\(first.month)–\(last.month)"
        let energyRange = "\(labels.energy) \(formatInt(energy.min() ?? 0))…\(formatInt(energy.max() ?? 0))"
        let powerRange = "\(labels.power) \(formatInt(power.min() ?? 0))…\(formatInt(power.max() ?? 0))"
        let sessionTotal = "\(formatInt(sessions)) \(labels.sessions)"
        return "\(labels.title), \(span). \(energyRange). \(powerRange). \(sessionTotal)."
    }
}
