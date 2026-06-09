//
//  AnalyticsSummaryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0002 · AnalyticsSummaryWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `AnalyticsSummaryDTO` + `AnalyticsSummaryUnitPrefs`
//  → display strings, reproducing the web source's numeric pipeline VERBATIM so the native
//  surface shows the exact same values as features/dashboard/widgets/AnalyticsSummaryWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web source + lib/unitConversion.ts)

private enum AnalyticsSummaryConstants {
    /// `MI_TO_KM` literal declared at the top of AnalyticsSummaryWidget.tsx. Used to turn the
    /// API's Wh/km efficiency into Wh/mi for the mile preference. Kept at the source's exact
    /// (slightly truncated) value for cross-platform display parity rather than the NIST
    /// 1.609344, so a user with both dashboards open sees identical numbers.
    static let miToKm = 1.60934
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts
/// — a divide by the unit's metres-per-unit factor. The web widget feeds it
/// `total_distance_km * 1000` (kilometres → metres), matching the source's `displayDist`
/// computation exactly.
func convertAnalyticsDistanceFromSI(_ meters: Double, to unit: AnalyticsSummaryDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number / currency formatting (ported from web lib/numberFormat.ts + useFormatting.ts)

/// Locale-aware number + currency formatting that mirrors the web `fmtNumber`
/// (`Intl.NumberFormat` via `Number.toLocaleString`, default `halfExpand` rounding) and
/// `useFormatting().formatCurrency` (`currencySymbol + fmtNumber`).
public enum AnalyticsSummaryFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Intl.NumberFormat`'s default `halfExpand`.
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

    /// `formatCurrency(amount, decimals)` — `currencySymbol + fmtNumber(amount, decimals)`.
    public static func currency(
        _ amount: Double,
        symbol: String,
        precision: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        symbol + number(amount, decimals: precision, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Accent (web per-stat icon colour, kept SwiftUI-free)

/// The semantic accent the web source attaches to each stat's icon (`text-cyan-400`,
/// `text-emerald-400`, `text-amber-400`, `text-purple-400`) and to the matching sparkline colour
/// (`SPARKLINE_COLORS`). Resolved to a `Color.TS` token in the view file so the adapter stays
/// Foundation-only and unit-testable.
public enum AnalyticsSummaryAccent: String, Equatable, CaseIterable {
    case cyan
    case emerald
    case amber
    case purple
}

// MARK: - Projected stat item (web `StatGridItem` / `StatCard`)

/// One projected stat tile: a localized label, a formatted value, an optional unit suffix, an SF
/// Symbol and the icon accent. Mirrors the web `StatGridItem` (`label`, `value`, `unit`, `icon`).
public struct AnalyticsSummaryStatItem: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    /// Interpolation argument for the one templated label (`Cost / {{unit}}`); nil for the rest.
    public let labelArgument: String?
    public let value: String
    public let unit: String?
    public let systemImage: String
    public let accent: AnalyticsSummaryAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        labelArgument: String? = nil,
        value: String,
        unit: String?,
        systemImage: String,
        accent: AnalyticsSummaryAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.labelArgument = labelArgument
        self.value = value
        self.unit = unit
        self.systemImage = systemImage
        self.accent = accent
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        if let labelArgument {
            return AnalyticsSummaryStrings.format(labelKey, labelFallback, labelArgument)
        }
        return AnalyticsSummaryStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projected sparkline (web `Sparkline` in the wide layout)

/// One projected trend sparkline: the series values and its palette index. Mirrors the web wide
/// layout's `sparklines.map(...)` over `[distTrend, effTrend, energyTrend, costTrend]` with the
/// `SPARKLINE_COLORS` palette.
public struct AnalyticsSummarySparkline: Identifiable, Equatable {
    public let id: String
    public let values: [Double]
    public let colorIndex: Int
    public let accent: AnalyticsSummaryAccent

    public init(id: String, values: [Double], colorIndex: Int, accent: AnalyticsSummaryAccent) {
        self.id = id
        self.values = values
        self.colorIndex = colorIndex
        self.accent = accent
    }
}

// MARK: - Projection

/// The fully-projected widget content for every layout: the four core stats (standard / wide),
/// the compact big-number distance value, and the optional wide-layout sparkline row. Computed
/// once per snapshot by the model.
public struct AnalyticsSummaryProjection: Equatable {
    public let stats: [AnalyticsSummaryStatItem]
    public let compactValue: String
    public let distanceSymbol: String
    public let sparklines: [AnalyticsSummarySparkline]

    public init(
        stats: [AnalyticsSummaryStatItem],
        compactValue: String,
        distanceSymbol: String,
        sparklines: [AnalyticsSummarySparkline]
    ) {
        self.stats = stats
        self.compactValue = compactValue
        self.distanceSymbol = distanceSymbol
        self.sparklines = sparklines
    }

    /// Web `hasSparklines = sparklines.some((s) => s.length > 0)` — the wide layout only renders
    /// the trend row when at least one series has points.
    public var hasSparklines: Bool {
        sparklines.contains { !$0.values.isEmpty }
    }
}

// MARK: - Stat display inputs

/// The pre-formatted display strings the four stat tiles render, bundled so the stat builder
/// takes a single argument (the numeric pipeline stays in `AnalyticsSummaryProjector.project`).
private struct AnalyticsSummaryStatDisplay {
    let distanceValue: String
    let distanceSymbol: String
    let efficiencyValue: String
    let efficiencyUnit: String
    let energyValue: String
    let costValue: String
}

/// Pure projector: `AnalyticsSummaryDTO` + `AnalyticsSummaryUnitPrefs` → `AnalyticsSummaryProjection`.
/// Every value is computed with the exact same arithmetic + formatting as the web widget.
public enum AnalyticsSummaryProjector {
    public static func project(
        summary: AnalyticsSummaryDTO,
        units: AnalyticsSummaryUnitPrefs
    ) -> AnalyticsSummaryProjection {
        let locale = units.localeIdentifier
        let distanceSymbol = units.distance.symbol

        // Distance pipeline, ported verbatim from the web source:
        //   distKm      = data.totalDistanceKm
        //   displayDist = convertDistanceFromSI(distKm * 1000, unitPrefs.distance)
        let distKm = summary.totalDistanceKm
        let displayDist = convertAnalyticsDistanceFromSI(distKm * 1000, to: units.distance)
        let distanceValue = AnalyticsSummaryFormat.number(displayDist, decimals: 0, localeIdentifier: locale)

        // Efficiency pipeline, ported verbatim:
        //   displayEff = distanceUnit === 'mi' ? effWhKm * MI_TO_KM : effWhKm
        //   effUnit    = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'
        let effWhKm = summary.avgEfficiencyWhKm
        let isMiles = units.distance == .miles
        let displayEff = isMiles ? effWhKm * AnalyticsSummaryConstants.miToKm : effWhKm
        let effUnit = isMiles ? "Wh/mi" : "Wh/km"

        let energyKwh = summary.totalEnergyKwh
        let totalCost = summary.totalCost

        // Cost pipeline, ported verbatim:
        //   costPerDist = displayDist > 0 ? totalCost / displayDist : 0
        let costPerDist = displayDist > 0 ? totalCost / displayDist : 0
        let costValue = costPerDist > 0
            ? AnalyticsSummaryFormat.currency(
                costPerDist,
                symbol: units.currencySymbol,
                precision: 3,
                localeIdentifier: locale
            )
            : "—"

        let stats = makeStats(
            AnalyticsSummaryStatDisplay(
                distanceValue: distanceValue,
                distanceSymbol: distanceSymbol,
                efficiencyValue: AnalyticsSummaryFormat.number(displayEff, decimals: 0, localeIdentifier: locale),
                efficiencyUnit: effUnit,
                energyValue: AnalyticsSummaryFormat.number(energyKwh, decimals: 1, localeIdentifier: locale),
                costValue: costValue
            )
        )

        return AnalyticsSummaryProjection(
            stats: stats,
            compactValue: distanceValue,
            distanceSymbol: distanceSymbol,
            sparklines: makeSparklines(summary: summary)
        )
    }

    /// Builds the four stat tiles (web `WidgetStatGrid` items) from the pre-formatted display
    /// values, in the source's order with its per-stat icon accents.
    private static func makeStats(_ display: AnalyticsSummaryStatDisplay) -> [AnalyticsSummaryStatItem] {
        [
            AnalyticsSummaryStatItem(
                id: "total-distance",
                labelKey: "widget.analyticsSummary.totalDistance",
                labelFallback: "Total Distance",
                value: display.distanceValue,
                unit: display.distanceSymbol,
                systemImage: "chart.line.uptrend.xyaxis",
                accent: .cyan
            ),
            AnalyticsSummaryStatItem(
                id: "avg-efficiency",
                labelKey: "widget.analyticsSummary.avgEfficiency",
                labelFallback: "Avg Efficiency",
                value: display.efficiencyValue,
                unit: display.efficiencyUnit,
                systemImage: "gauge.medium",
                accent: .emerald
            ),
            AnalyticsSummaryStatItem(
                id: "energy-consumed",
                labelKey: "widget.analyticsSummary.energyConsumed",
                labelFallback: "Energy Consumed",
                value: display.energyValue,
                unit: "kWh",
                systemImage: "bolt.fill",
                accent: .amber
            ),
            AnalyticsSummaryStatItem(
                id: "cost-per-distance",
                labelKey: "widget.analyticsSummary.costPerDist",
                labelFallback: "Cost / %@",
                labelArgument: display.distanceSymbol,
                value: display.costValue,
                unit: nil,
                systemImage: "dollarsign.circle.fill",
                accent: .purple
            )
        ]
    }

    /// Builds the wide-layout trend row: one series per stat, in the same order + colours as the
    /// web `SPARKLINE_COLORS = ['#00f0ff', '#34d399', '#fbbf24', '#a78bfa']`.
    private static func makeSparklines(summary: AnalyticsSummaryDTO) -> [AnalyticsSummarySparkline] {
        [
            AnalyticsSummarySparkline(
                id: "distance-trend", values: summary.distanceTrend, colorIndex: 0, accent: .cyan
            ),
            AnalyticsSummarySparkline(
                id: "efficiency-trend", values: summary.efficiencyTrend, colorIndex: 1, accent: .emerald
            ),
            AnalyticsSummarySparkline(
                id: "energy-trend", values: summary.energyTrend, colorIndex: 2, accent: .amber
            ),
            AnalyticsSummarySparkline(
                id: "cost-trend", values: summary.costTrend, colorIndex: 3, accent: .purple
            )
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the stat grid. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum AnalyticsSummaryAccessibility {
    /// One spoken sentence per stat, e.g. "Analytics Summary. Total Distance 31 km. Avg Efficiency
    /// 150 Wh/km. …", prefixed by the surface title.
    public static func summary(for projection: AnalyticsSummaryProjection) -> String {
        let title = AnalyticsSummaryStrings.string("widget.analyticsSummary.title", "Analytics Summary")
        var parts = [title]
        for item in projection.stats {
            if let unit = item.unit {
                parts.append("\(item.label) \(item.value) \(unit)")
            } else {
                parts.append("\(item.label) \(item.value)")
            }
        }
        return parts.joined(separator: ". ")
    }

    /// The compact-layout spoken label: the big distance number + unit + the "Total Distance" role.
    public static func compactLabel(for projection: AnalyticsSummaryProjection) -> String {
        let role = AnalyticsSummaryStrings.string("widget.analyticsSummary.totalDistance", "Total Distance")
        return "\(projection.compactValue) \(projection.distanceSymbol) \(role)"
    }
}
