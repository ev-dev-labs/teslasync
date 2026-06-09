//
//  WeekOverWeekSummary.Adapter.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  The testable projection core for the weekly-digest "Week-over-Week Comparison"
//  surface — the SwiftUI parity of
//  features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx.
//
//  Four pure pieces, all dependency-free (Foundation only, no SwiftUI, no Shared)
//  so they unit-test without a store, a bundle, or a rendered view:
//    • `WeekOverWeekFormatting` — the `useFormatting` + `numberFormat` parity layer
//      (`fmtNumber` / `fmtInt` / `formatCurrency`), locale + precision + currency
//      symbol driven, matching the web's `toLocaleString` output.
//    • `WeekOverWeekTrend` + `WeekOverWeekTrendCalculator` — the web `helpers.trendFor`
//      decision (percent change, the `< 0.01` flat band, and the `invertPositive`
//      good/bad polarity).
//    • `WeekOverWeekProjection` — maps a `WeekOverWeekMetrics` (the slice of the web
//      `DigestMetrics` this surface reads) into the ordered six-tile `StatCard` grid,
//      in the exact source order, with the exact icons / labels / values / units /
//      trend-invert flags the web `<StatCard … />` calls render.
//
//  The web component is presentational — it takes `metrics: DigestMetrics` and always
//  renders. Its page owner (`WeeklyDigestPage`) owns loading / error / empty. This
//  core stays locale-agnostic: tile label + unit resolve through the i18n facade at
//  render time, so the projection is fully unit-testable.
//

import Foundation

// MARK: - Surface identity

/// The surface slug shared by the view (diagnostics `view.opened`) and the state
/// holder. Declared here (Foundation only) so the model never needs the SwiftUI view
/// to name itself.
public enum WeekOverWeekSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WeekOverWeekSummary"
}

// MARK: - Data (the slice of web `DigestMetrics` this surface reads)

/// The weekly-digest values `WeekOverWeekSummary` renders, mirroring the fields the
/// web component reads off `metrics: DigestMetrics`. Each `prev…` is the prior week's
/// value the trend chip compares against (web `metrics.prev…`).
public struct WeekOverWeekMetrics: Sendable, Equatable {
    public var totalDistance: Double
    public var prevDistance: Double
    public var totalDrives: Double
    public var prevDriveCount: Double
    public var energyUsed: Double
    public var prevEnergy: Double
    public var chargingCost: Double
    public var prevChargingCost: Double
    public var avgEfficiency: Double
    public var prevAvgEfficiency: Double
    public var co2Saved: Double
    public var prevCo2: Double

    public init(
        totalDistance: Double,
        prevDistance: Double,
        totalDrives: Double,
        prevDriveCount: Double,
        energyUsed: Double,
        prevEnergy: Double,
        chargingCost: Double,
        prevChargingCost: Double,
        avgEfficiency: Double,
        prevAvgEfficiency: Double,
        co2Saved: Double,
        prevCo2: Double
    ) {
        self.totalDistance = totalDistance
        self.prevDistance = prevDistance
        self.totalDrives = totalDrives
        self.prevDriveCount = prevDriveCount
        self.energyUsed = energyUsed
        self.prevEnergy = prevEnergy
        self.chargingCost = chargingCost
        self.prevChargingCost = prevChargingCost
        self.avgEfficiency = avgEfficiency
        self.prevAvgEfficiency = prevAvgEfficiency
        self.co2Saved = co2Saved
        self.prevCo2 = prevCo2
    }
}

// MARK: - Formatting (web `useFormatting` + `numberFormat`)

/// The display-formatting facade this surface binds through (P1/S8), reproducing the
/// web `useFormatting` hook over the `numberFormat` primitives. Locale + precision +
/// currency symbol come from user settings in the production app; the `.standard`
/// default mirrors the web fallbacks (`'$'`, precision `2`, `en-US`).
public struct WeekOverWeekFormatting: Sendable, Equatable {
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String

    public init(currencySymbol: String = "$", precision: Int = 2, localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.localeIdentifier = localeIdentifier
    }

    /// The web default: `$`, two fraction digits, `en-US` grouping.
    public static let standard = WeekOverWeekFormatting()

    /// Locale-aware fixed-fraction decimal formatting — the parity of the web
    /// `fmtNumber(v, d)` (`Number.toLocaleString(locale, { min/maxFractionDigits: d })`).
    /// A non-finite input renders as `0` formatted, matching `safeNumber`.
    public func number(_ value: Double, decimals: Int) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Integer with locale separators — web `fmtInt(v)` (`fmtNumber(v, 0)`).
    public func int(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Currency string — web `formatCurrency(amount, decimals)`
    /// (`${currencySymbol}${fmtNumber(amount, d)}`). `decimals == nil` uses the user
    /// precision, exactly like the hook's `decimals ?? userPrecision`.
    public func currency(_ amount: Double, decimals: Int? = nil) -> String {
        currencySymbol + number(amount, decimals: decimals ?? precision)
    }
}

// MARK: - Trend (web `helpers.trendFor`)

/// The arrow direction a trend chip points (web `'up' | 'down' | 'flat'`).
public enum WeekOverWeekTrendDirection: Sendable, Equatable {
    case up
    case down
    case flat
}

/// A computed week-over-week trend chip (web `trendFor` return value).
///
/// `direction` drives the web `StatCard` arrow glyph (`↑ / ↓ / —`); `positive` (which
/// already folds in `invertPositive`) drives the tri-state color — exactly the web
/// `StatCard` rule `positive ? green : direction === 'flat' ? muted : red`.
public struct WeekOverWeekTrend: Sendable, Equatable {
    public var direction: WeekOverWeekTrendDirection
    public var value: String
    public var positive: Bool

    public init(direction: WeekOverWeekTrendDirection, value: String, positive: Bool) {
        self.direction = direction
        self.value = value
        self.positive = positive
    }
}

/// Pure week-over-week trend math, reproducing `helpers.ts` `pctChange` + `trendFor`.
public enum WeekOverWeekTrendCalculator {
    /// Web `pctChange`: `previous == 0 → (current > 0 ? 100 : 0)`, else the signed
    /// percentage change over `abs(previous)`.
    public static func pctChange(current: Double, previous: Double) -> Double {
        if previous == 0 { return current > 0 ? 100 : 0 }
        return ((current - previous) / abs(previous)) * 100
    }

    /// Web `trendFor(current, previous, invertPositive)`: a `< 0.01` absolute delta is
    /// a flat `0%`; otherwise an up/down chip whose `value` is the signed percent (`+`
    /// prefix when rising) and whose `positive` is inverted for "lower is better"
    /// metrics (energy, cost, efficiency).
    public static func trend(
        current: Double,
        previous: Double,
        invertPositive: Bool = false,
        formatting: WeekOverWeekFormatting = .standard
    ) -> WeekOverWeekTrend {
        let diff = current - previous
        let pct = pctChange(current: current, previous: previous)
        if abs(diff) < 0.01 {
            return WeekOverWeekTrend(direction: .flat, value: "0%", positive: true)
        }
        let isUp = diff > 0
        let sign = isUp ? "+" : ""
        return WeekOverWeekTrend(
            direction: isUp ? .up : .down,
            value: "\(sign)\(formatting.number(pct, decimals: 1))%",
            positive: invertPositive ? !isUp : isUp
        )
    }
}

// MARK: - Tile view model (web `StatCard` props)

/// One rendered stat tile (web `<StatCard … />`). `value` is already display-formatted;
/// `labelKey`/`labelFallback` and the optional `unitKey`/`unitFallback` resolve through
/// the i18n facade at render time so the model stays locale-agnostic and testable.
public struct WeekOverWeekStatItem: Identifiable, Sendable, Equatable {
    public let id: String
    public let systemImage: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unitKey: String?
    public let unitFallback: String?
    public let trend: WeekOverWeekTrend?

    public init(
        id: String,
        systemImage: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unitKey: String?,
        unitFallback: String?,
        trend: WeekOverWeekTrend?
    ) {
        self.id = id
        self.systemImage = systemImage
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unitKey = unitKey
        self.unitFallback = unitFallback
        self.trend = trend
    }
}

// MARK: - Projection (web JSX → ordered tile grid)

/// Maps a `WeekOverWeekMetrics` into the ordered six-tile grid, one entry per web
/// `<StatCard>` in source order, with the exact icon / label / value / unit / trend
/// (and `invertPositive` flag) each web tile renders.
public enum WeekOverWeekProjection {
    /// The six metric tiles, in the exact web source order.
    public static func items(
        from metrics: WeekOverWeekMetrics,
        formatting: WeekOverWeekFormatting = .standard
    ) -> [WeekOverWeekStatItem] {
        [
            distanceTile(metrics, formatting),
            drivesTile(metrics, formatting),
            energyTile(metrics, formatting),
            costTile(metrics, formatting),
            efficiencyTile(metrics, formatting),
            co2Tile(metrics, formatting)
        ]
    }

    /// Distance — web `<StatCard icon={Car} unit="km" … />`.
    private static func distanceTile(
        _ metrics: WeekOverWeekMetrics,
        _ formatting: WeekOverWeekFormatting
    ) -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.distance,
            systemImage: "car.fill",
            labelKey: WeekOverWeekKeys.distance,
            labelFallback: "Distance",
            value: formatting.number(metrics.totalDistance, decimals: 1),
            unitKey: WeekOverWeekKeys.unitKm,
            unitFallback: "km",
            trend: WeekOverWeekTrendCalculator.trend(
                current: metrics.totalDistance,
                previous: metrics.prevDistance,
                formatting: formatting
            )
        )
    }

    /// Drives — web `<StatCard icon={Activity} … />` (no unit).
    private static func drivesTile(
        _ metrics: WeekOverWeekMetrics,
        _ formatting: WeekOverWeekFormatting
    ) -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.drives,
            systemImage: "waveform.path.ecg",
            labelKey: WeekOverWeekKeys.drives,
            labelFallback: "Drives",
            value: formatting.int(metrics.totalDrives),
            unitKey: nil,
            unitFallback: nil,
            trend: WeekOverWeekTrendCalculator.trend(
                current: metrics.totalDrives,
                previous: metrics.prevDriveCount,
                formatting: formatting
            )
        )
    }

    /// Energy — web `<StatCard icon={Zap} unit="kWh" … />` (lower is better → inverted).
    private static func energyTile(
        _ metrics: WeekOverWeekMetrics,
        _ formatting: WeekOverWeekFormatting
    ) -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.energy,
            systemImage: "bolt.fill",
            labelKey: WeekOverWeekKeys.energy,
            labelFallback: "Energy",
            value: formatting.number(metrics.energyUsed, decimals: 1),
            unitKey: WeekOverWeekKeys.unitKwh,
            unitFallback: "kWh",
            trend: WeekOverWeekTrendCalculator.trend(
                current: metrics.energyUsed,
                previous: metrics.prevEnergy,
                invertPositive: true,
                formatting: formatting
            )
        )
    }

    /// Cost — web `<StatCard icon={Fuel} … />` (currency value, lower is better → inverted).
    private static func costTile(
        _ metrics: WeekOverWeekMetrics,
        _ formatting: WeekOverWeekFormatting
    ) -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.cost,
            systemImage: "fuelpump.fill",
            labelKey: WeekOverWeekKeys.cost,
            labelFallback: "Cost",
            value: formatting.currency(metrics.chargingCost, decimals: 2),
            unitKey: nil,
            unitFallback: nil,
            trend: WeekOverWeekTrendCalculator.trend(
                current: metrics.chargingCost,
                previous: metrics.prevChargingCost,
                invertPositive: true,
                formatting: formatting
            )
        )
    }

    /// Efficiency — web `<StatCard icon={BarChart3} unit="Wh/km" … />` (lower is better → inverted).
    private static func efficiencyTile(
        _ metrics: WeekOverWeekMetrics,
        _ formatting: WeekOverWeekFormatting
    ) -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.efficiency,
            systemImage: "chart.bar.fill",
            labelKey: WeekOverWeekKeys.efficiency,
            labelFallback: "Efficiency",
            value: formatting.number(metrics.avgEfficiency, decimals: 1),
            unitKey: WeekOverWeekKeys.unitWhPerKm,
            unitFallback: "Wh/km",
            trend: WeekOverWeekTrendCalculator.trend(
                current: metrics.avgEfficiency,
                previous: metrics.prevAvgEfficiency,
                invertPositive: true,
                formatting: formatting
            )
        )
    }

    /// CO₂ Saved — web `<StatCard icon={Leaf} unit="kg" … />`.
    private static func co2Tile(
        _ metrics: WeekOverWeekMetrics,
        _ formatting: WeekOverWeekFormatting
    ) -> WeekOverWeekStatItem {
        WeekOverWeekStatItem(
            id: WeekOverWeekKeys.co2,
            systemImage: "leaf.fill",
            labelKey: WeekOverWeekKeys.co2,
            labelFallback: "CO₂ Saved",
            value: formatting.number(metrics.co2Saved, decimals: 1),
            unitKey: WeekOverWeekKeys.unitKg,
            unitFallback: "kg",
            trend: WeekOverWeekTrendCalculator.trend(
                current: metrics.co2Saved,
                previous: metrics.prevCo2,
                formatting: formatting
            )
        )
    }
}
