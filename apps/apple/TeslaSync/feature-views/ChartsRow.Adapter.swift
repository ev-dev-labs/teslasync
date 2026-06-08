//
//  ChartsRow.Adapter.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  The testable projection core for the charging-list ChartsRow surface: the decoded
//  domain models (parity with the web `ChartsRow` props — `EnergyTrendPoint`,
//  `ChargerBreakdownEntry`, `CostByTypeEntry` from charging-list/helpers.ts), the
//  `safe()` numeric guard (port of the web `safeNumber` from `@/lib/numberFormat`),
//  the energy/cost shared-axis scale (web single Recharts `<YAxis/>` shared by both
//  `<Area/>`s), the donut share projection (web `<Pie/>` slices → percentages for the
//  VoiceOver summary), and the accessibility summary builders. Everything here is pure
//  + dependency-free (Foundation only) so it unit-tests without a store or a view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safeNumber`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safeNumber = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used wherever a
/// value feeds an axis domain, a slice angle, or a formatted label so a `NaN` /
/// `Infinity` never reaches the chart or the spoken description.
public enum ChartsRowNumeric {
    /// Returns the value when it is finite, else `0` (web `safeNumber`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Series tone (parity of the web hex `fill` / stroke colors)

/// The semantic palette role a series / donut slice renders with — the native parity
/// of the web color strings (`CHARGER_COLORS` + the `#10b981` / `#f59e0b` trend
/// strokes). Kept as a SwiftUI-free enum so the projection stays testable; it is
/// resolved to a `Color.TS` design token at the view boundary (`ChartsRow.Charts`).
public enum ChartsRowTone: String, Sendable, Equatable, CaseIterable {
    /// Web `#10b981` — energy area + Home / AC slice.
    case success
    /// Web `#f59e0b` — cost line + DC Fast slice.
    case warning
    /// Web `#ef4444` — Supercharger slice.
    case danger
    /// Web cyan accent — spare series.
    case accent
    /// Web indigo info — spare series.
    case info
}

// MARK: - Domain models (port of the web ChartsRow props)

/// One point of the energy & cost trend (web `EnergyTrendPoint` — `{ date, energy, cost }`).
public struct ChartsRowEnergyPoint: Identifiable, Equatable, Sendable {
    public var date: String
    public var energy: Double
    public var cost: Double

    public var id: String {
        date
    }

    public init(date: String, energy: Double, cost: Double) {
        self.date = date
        self.energy = energy
        self.cost = cost
    }
}

/// One donut slice (web `ChargerBreakdownEntry` — `{ name, value, fill }`; the web
/// `fill` hex becomes a semantic `tone`).
public struct ChartsRowBreakdownSlice: Identifiable, Equatable, Sendable {
    public var label: String
    public var value: Double
    public var tone: ChartsRowTone

    public var id: String {
        label
    }

    public init(label: String, value: Double, tone: ChartsRowTone) {
        self.label = label
        self.value = value
        self.tone = tone
    }
}

/// One cost-by-type legend row (web `CostByTypeEntry` — `{ name, energy, cost, perKwh }`).
public struct ChartsRowCostRow: Identifiable, Equatable, Sendable {
    public var label: String
    public var energy: Double
    public var cost: Double
    public var perKwh: Double

    public var id: String {
        label
    }

    public init(label: String, energy: Double, cost: Double, perKwh: Double) {
        self.label = label
        self.energy = energy
        self.cost = cost
        self.perKwh = perKwh
    }
}

/// The full ChartsRow input — the three web props bundled into one coalesced value a
/// `ChartsRowSource` pushes. Each collection drives one sub-surface; `isEmpty` lets the
/// surface decide its empty disposition without hiding either panel.
public struct ChartsRowData: Equatable, Sendable {
    public var energyTrend: [ChartsRowEnergyPoint]
    public var chargerBreakdown: [ChartsRowBreakdownSlice]
    public var costByType: [ChartsRowCostRow]

    public init(
        energyTrend: [ChartsRowEnergyPoint] = [],
        chargerBreakdown: [ChartsRowBreakdownSlice] = [],
        costByType: [ChartsRowCostRow] = []
    ) {
        self.energyTrend = energyTrend
        self.chargerBreakdown = chargerBreakdown
        self.costByType = costByType
    }

    /// Whether every panel's source data is missing (no trend, no breakdown, no rows).
    public var isEmpty: Bool {
        energyTrend.isEmpty && chargerBreakdown.isEmpty && costByType.isEmpty
    }
}

// MARK: - Energy/cost shared-axis scale (port of the web single `<YAxis/>`)

/// The shared y-domain for the trend chart. The web binds both the energy `<Area/>`
/// and the cost `<Area/>` to a single Recharts `<YAxis/>`, so Swift Charts mirrors that
/// with one domain spanning the larger of the two series (plus a little headroom).
public struct ChartsRowEnergyScale: Equatable, Sendable {
    /// The largest finite energy value across the points (≥ 0).
    public let maxEnergy: Double
    /// The largest finite cost value across the points (≥ 0).
    public let maxCost: Double

    public init(maxEnergy: Double, maxCost: Double) {
        self.maxEnergy = Swift.max(maxEnergy, 0)
        self.maxCost = Swift.max(maxCost, 0)
    }

    /// The top of the shared domain before headroom (the larger of the two series).
    public var peak: Double {
        Swift.max(maxEnergy, maxCost)
    }

    /// Upper bound for `chartYScale` with 5% headroom so the top mark is not clipped;
    /// clamped to `1` so an all-zero / empty series still renders a valid axis.
    public var domainUpperBound: Double {
        Swift.max(peak * 1.05, 1)
    }
}

// MARK: - Donut projection (port of the web `<Pie/>` slices)

/// One projected donut slice — the label, the raw value, the `0…1` fraction of the
/// total, the `0…100` percentage (for the VoiceOver summary), and the palette tone.
public struct ChartsRowDonutSlice: Identifiable, Equatable, Sendable {
    public var label: String
    public var value: Double
    public var fraction: Double
    public var percent: Double
    public var tone: ChartsRowTone

    public var id: String {
        label
    }

    public init(label: String, value: Double, fraction: Double, percent: Double, tone: ChartsRowTone) {
        self.label = label
        self.value = value
        self.fraction = fraction
        self.percent = percent
        self.tone = tone
    }
}

/// The projected donut — the total of all slice values plus the per-slice shares.
public struct ChartsRowDonut: Equatable, Sendable {
    public var total: Double
    public var slices: [ChartsRowDonutSlice]

    public init(total: Double, slices: [ChartsRowDonutSlice]) {
        self.total = total
        self.slices = slices
    }

    /// Whether there are no slices to draw.
    public var isEmpty: Bool {
        slices.isEmpty
    }
}

/// The pure projection from the decoded `ChartsRowData` to the chart-ready view models.
/// Each function mirrors a web computation exactly.
public enum ChartsRowProjection {
    /// The donut shares (web `<Pie dataKey="value">`): `total` is the sum of all safe
    /// values, each `fraction` is `value / total` (`0` when total is `0`), and `percent`
    /// is that as `0…100`. Source order is preserved (web cell order).
    public static func donut(_ slices: [ChartsRowBreakdownSlice]) -> ChartsRowDonut {
        let total = slices.reduce(0.0) { $0 + ChartsRowNumeric.safe($1.value) }
        let projected = slices.map { slice -> ChartsRowDonutSlice in
            let value = ChartsRowNumeric.safe(slice.value)
            let fraction = total > 0 ? value / total : 0
            return ChartsRowDonutSlice(
                label: slice.label,
                value: value,
                fraction: fraction,
                percent: fraction * 100,
                tone: slice.tone
            )
        }
        return ChartsRowDonut(total: total, slices: projected)
    }

    /// The shared-axis scale for the trend chart (web single `<YAxis/>`): `maxEnergy`
    /// and `maxCost` span their respective series so the domain covers both.
    public static func energyScale(_ points: [ChartsRowEnergyPoint]) -> ChartsRowEnergyScale {
        var maxEnergy = 0.0
        var maxCost = 0.0
        for point in points {
            maxEnergy = Swift.max(maxEnergy, ChartsRowNumeric.safe(point.energy))
            maxCost = Swift.max(maxCost, ChartsRowNumeric.safe(point.cost))
        }
        return ChartsRowEnergyScale(maxEnergy: maxEnergy, maxCost: maxCost)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The trend chart's spoken labels (title + the two series words), bundled so the
/// summary stays a small function. All values are pre-localized.
public struct ChartsRowTrendLabels: Equatable, Sendable {
    public var title: String
    public var energy: String
    public var cost: String

    public init(title: String, energy: String, cost: String) {
        self.title = title
        self.energy = energy
        self.cost = cost
    }
}

/// The cost-by-type row's spoken units (energy unit + the `total` / `/kWh` words),
/// bundled so the summary stays a small function. All values are pre-localized.
public struct ChartsRowCostRowLabels: Equatable, Sendable {
    public var energyUnit: String
    public var totalWord: String
    public var perKwhSuffix: String

    public init(energyUnit: String, totalWord: String, perKwhSuffix: String) {
        self.energyUnit = energyUnit
        self.totalWord = totalWord
        self.perKwhSuffix = perKwhSuffix
    }
}

/// Builds the VoiceOver strings for the surface's data so the spoken content can be
/// unit-tested without rendering a view. Each builder takes pre-resolved formatters +
/// localized words, so no literal is hardcoded.
public enum ChartsRowAccessibility {
    /// "Energy & Cost Trend, Jan–Jun. Energy 312…422. Cost $37.90…$55.00." — the chart
    /// title, the date span, and the energy + cost ranges so the area chart is not an
    /// opaque image to VoiceOver.
    public static func energyTrendSummary(
        _ points: [ChartsRowEnergyPoint],
        labels: ChartsRowTrendLabels,
        formatNumber: (Double) -> String,
        formatCurrency: (Double) -> String
    ) -> String {
        guard let first = points.first, let last = points.last else { return labels.title }
        let energy = points.map { ChartsRowNumeric.safe($0.energy) }
        let cost = points.map { ChartsRowNumeric.safe($0.cost) }
        let span = first.date == last.date ? first.date : "\(first.date)–\(last.date)"
        let energyRange = "\(labels.energy) \(formatNumber(energy.min() ?? 0))…\(formatNumber(energy.max() ?? 0))"
        let costRange = "\(labels.cost) \(formatCurrency(cost.min() ?? 0))…\(formatCurrency(cost.max() ?? 0))"
        return "\(labels.title), \(span). \(energyRange). \(costRange)."
    }

    /// "Supercharger 60%, DC Fast 30%, Home / AC 10%" — each slice spoken as its label
    /// and integer-ish percentage (web `<Pie/>` shares).
    public static func breakdownSummary(
        _ donut: ChartsRowDonut,
        formatNumber: (Double) -> String
    ) -> String {
        guard !donut.slices.isEmpty else { return "" }
        return donut.slices
            .map { "\($0.label) \(formatNumber($0.percent))%" }
            .joined(separator: ", ")
    }

    /// "Home / AC, 25.50 kWh, $12.30 total, $0.48/kWh" — one cost-by-type row spoken as
    /// its label, energy, total cost, and per-kWh price (web row layout).
    public static func costRowSummary(
        _ row: ChartsRowCostRow,
        labels: ChartsRowCostRowLabels,
        formatNumber: (Double) -> String,
        formatCurrency: (Double) -> String
    ) -> String {
        let energy = "\(formatNumber(ChartsRowNumeric.safe(row.energy))) \(labels.energyUnit)"
        let cost = "\(formatCurrency(ChartsRowNumeric.safe(row.cost))) \(labels.totalWord)"
        let perKwh = "\(formatCurrency(ChartsRowNumeric.safe(row.perKwh)))\(labels.perKwhSuffix)"
        return "\(row.label), \(energy), \(cost), \(perKwh)"
    }
}
