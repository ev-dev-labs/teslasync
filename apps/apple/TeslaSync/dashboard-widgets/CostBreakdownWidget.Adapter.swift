//
//  CostBreakdownWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `CostBreakdownData` + `CostBreakdownPrefs`
//  → donut segments, the ranked monthly list, the three stat cards and the compact big-number,
//  reproducing the web source's numeric pipeline VERBATIM so the native surface shows the exact
//  same values as features/dashboard/widgets/CostBreakdownWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Layout (web `isCompact`)

/// The widget's render layout, resolved from its grid footprint exactly as the web source does
/// (`isCompact = size.cols <= 1`). Pure + testable; the registry's `minSize` of 1×2 means a single
/// narrow column resolves to `.compact` while the default 2×4 resolves to `.standard`.
public enum CostBreakdownLayout: Equatable {
    case compact
    case standard

    public static func resolve(_ size: DashboardWidgetSize) -> CostBreakdownLayout {
        size.cols <= 1 ? .compact : .standard
    }
}

// MARK: - Donut segment (web Recharts `Pie` / `Cell`)

/// One donut slice — the native parity of a web `DonutSegment` (`{ name, value, color }`). The
/// concrete `Color` is resolved in the chart view from `paletteIndex` via `TSChartPalette`, mirroring
/// the web `palette.series[i % series.length]`.
public struct CostDonutSegment: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let value: Double
    public let formattedValue: String
    public let paletteIndex: Int

    public init(id: String, label: String, value: Double, formattedValue: String, paletteIndex: Int) {
        self.id = id
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
        self.paletteIndex = paletteIndex
    }

    /// The VoiceOver sentence for one slice: "label value".
    public var accessibilityLabel: String {
        "\(label) \(formattedValue)"
    }
}

// MARK: - Ranked monthly item (web `WidgetRankedList` row)

/// One ranked-list row — the native parity of a web `RankedItem`. The list is pre-sorted descending
/// by value and capped at five (web `WidgetRankedList` `maxItems`), with `barFraction` precomputed
/// (`value / maxVisibleValue`) so the view stays a pure renderer. `paletteIndex` carries the
/// chronological palette colour the web `barColor` selects.
public struct CostRankedItem: Identifiable, Equatable {
    public let id: String
    public let rank: Int
    public let label: String
    public let value: Double
    public let formattedValue: String
    public let barFraction: Double
    public let paletteIndex: Int

    public init(
        id: String,
        rank: Int,
        label: String,
        value: Double,
        formattedValue: String,
        barFraction: Double,
        paletteIndex: Int
    ) {
        self.id = id
        self.rank = rank
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
        self.barFraction = barFraction
        self.paletteIndex = paletteIndex
    }

    /// The VoiceOver sentence for one row: "rank. label value".
    public var accessibilityLabel: String {
        "\(rank). \(label) \(formattedValue)"
    }
}

// MARK: - Stat card (web `StatCard`)

/// One projected stat card — the native parity of the web `StatCard` (`label`, `value`, `icon`,
/// optional `sublabel`). The SF Symbol replaces the lucide icon; the concrete tint is applied in the
/// view.
public struct CostStatCard: Identifiable, Equatable {
    public let id: String
    public let systemImage: String
    public let label: String
    public let value: String
    public let sublabel: String?

    public init(id: String, systemImage: String, label: String, value: String, sublabel: String?) {
        self.id = id
        self.systemImage = systemImage
        self.label = label
        self.value = value
        self.sublabel = sublabel
    }

    /// The VoiceOver sentence for the card: "label value[, sublabel]".
    public var accessibilityLabel: String {
        if let sublabel, !sublabel.isEmpty {
            return "\(label) \(value), \(sublabel)"
        }
        return "\(label) \(value)"
    }
}

// MARK: - Compact projection (web `WidgetBigNumber`)

/// The compact-layout headline — the native parity of the web `WidgetBigNumber` props: the
/// 0-decimal current-month total, the trailing currency `unit`, the uppercase `label`, an optional
/// gas-savings `subtitle`, and an optional `Saving` badge.
public struct CostBreakdownCompact: Equatable {
    public let bigValue: String
    public let unit: String
    public let label: String
    public let subtitle: String?
    public let badgeText: String?

    public init(bigValue: String, unit: String, label: String, subtitle: String?, badgeText: String?) {
        self.bigValue = bigValue
        self.unit = unit
        self.label = label
        self.subtitle = subtitle
        self.badgeText = badgeText
    }
}

// MARK: - Projection

/// The fully-projected widget content for both layouts: the donut series, the ranked monthly list,
/// the three stat cards, and the compact headline. Computed once per snapshot by the model.
public struct CostBreakdownProjection: Equatable {
    public let donutSegments: [CostDonutSegment]
    public let rankedItems: [CostRankedItem]
    public let statCards: [CostStatCard]
    public let compact: CostBreakdownCompact

    public init(
        donutSegments: [CostDonutSegment],
        rankedItems: [CostRankedItem],
        statCards: [CostStatCard],
        compact: CostBreakdownCompact
    ) {
        self.donutSegments = donutSegments
        self.rankedItems = rankedItems
        self.statCards = statCards
        self.compact = compact
    }
}

// MARK: - Projector

/// Pure projector: `CostBreakdownData` + `CostBreakdownPrefs` → `CostBreakdownProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web widget's memoized
/// derivations (`donutData`, `rankedItems`, `costPerDist`, `currentMonthCost`).
public enum CostBreakdownProjector {
    private static let emptyValue = "—"
    private static let donutWindow = 6
    private static let rankedLimit = 5

    public static func project(data: CostBreakdownData, prefs: CostBreakdownPrefs) -> CostBreakdownProjection {
        CostBreakdownProjection(
            donutSegments: makeDonutSegments(data.monthlyEntries, prefs: prefs),
            rankedItems: makeRankedItems(data.monthlyEntries, prefs: prefs),
            statCards: makeStatCards(data, prefs: prefs),
            compact: makeCompact(data, prefs: prefs)
        )
    }

    // MARK: Donut (web `donutData` — last 6 months)

    private static func makeDonutSegments(
        _ entries: [CostMonthEntry],
        prefs: CostBreakdownPrefs
    ) -> [CostDonutSegment] {
        let recent = Array(entries.suffix(donutWindow))
        let startIndex = entries.count - recent.count
        return recent.enumerated().map { offset, entry in
            CostDonutSegment(
                id: "donut-\(startIndex + offset)",
                label: monthLabel(entry.month),
                value: entry.evCost,
                formattedValue: currency(entry.evCost, prefs: prefs, decimals: 2),
                paletteIndex: offset
            )
        }
    }

    // MARK: Ranked list (web `rankedItems` → `WidgetRankedList` sort/slice)

    private static func makeRankedItems(
        _ entries: [CostMonthEntry],
        prefs: CostBreakdownPrefs
    ) -> [CostRankedItem] {
        // Web `rankedItems`: palette colour is tied to the chronological index, before the list sorts.
        let chronological = entries.enumerated().map { index, entry in
            (paletteIndex: index, entry: entry)
        }
        // `WidgetRankedList`: stable sort descending by value, then cap at five.
        let sorted = chronological.enumerated()
            .sorted { lhs, rhs in
                if lhs.element.entry.evCost == rhs.element.entry.evCost {
                    return lhs.offset < rhs.offset
                }
                return lhs.element.entry.evCost > rhs.element.entry.evCost
            }
            .map(\.element)
        let visible = Array(sorted.prefix(rankedLimit))
        let maxValue = visible.reduce(0.0) { Swift.max($0, $1.entry.evCost) }

        return visible.enumerated().map { rankIndex, item in
            CostRankedItem(
                id: "ranked-\(item.paletteIndex)",
                rank: rankIndex + 1,
                label: monthLabel(item.entry.month),
                value: item.entry.evCost,
                formattedValue: currency(item.entry.evCost, prefs: prefs),
                barFraction: maxValue > 0 ? item.entry.evCost / maxValue : 0,
                paletteIndex: item.paletteIndex
            )
        }
    }

    // MARK: Stat cards (web standard-layout grid)

    private static func makeStatCards(_ data: CostBreakdownData, prefs: CostBreakdownPrefs) -> [CostStatCard] {
        let costPerDist = convertCostPerDistance(costPerKm: data.costPerKmEv, to: prefs.distance)
        let costPerDistValue = costPerDist > 0 ? currency(costPerDist, prefs: prefs, decimals: 3) : emptyValue
        let savingsValue = data.totalSavings > 0 ? currency(data.totalSavings, prefs: prefs) : emptyValue
        let savingsSublabel = data.totalSavings > 0
            ? CostBreakdownStrings.string("widget.costBreakdown.lifetime", "Lifetime")
            : nil

        return [
            CostStatCard(
                id: "total-cost",
                systemImage: "dollarsign.circle",
                label: CostBreakdownStrings.string("widget.costBreakdown.totalCost", "Total Cost"),
                value: currency(data.totalChargingCost, prefs: prefs),
                sublabel: nil
            ),
            CostStatCard(
                id: "cost-per-distance",
                systemImage: "fuelpump",
                label: CostBreakdownStrings.format(
                    "widget.costBreakdown.costPerDist",
                    "Cost / %@",
                    prefs.distance.symbol
                ),
                value: costPerDistValue,
                sublabel: nil
            ),
            CostStatCard(
                id: "gas-savings",
                systemImage: "chart.line.downtrend.xyaxis",
                label: CostBreakdownStrings.string("widget.costBreakdown.gasSavings", "Gas Savings"),
                value: savingsValue,
                sublabel: savingsSublabel
            )
        ]
    }

    // MARK: Compact (web `WidgetBigNumber`)

    private static func makeCompact(_ data: CostBreakdownData, prefs: CostBreakdownPrefs) -> CostBreakdownCompact {
        let currentMonthCost = data.monthlyEntries.last?.evCost ?? 0
        let subtitle = data.monthlySavings > 0
            ? CostBreakdownStrings.format(
                "widget.costBreakdown.savedVsGas",
                "Saved %@ vs gas",
                currency(data.monthlySavings, prefs: prefs)
            )
            : nil
        let badge = data.totalSavings > 0
            ? CostBreakdownStrings.string("widget.costBreakdown.saving", "Saving")
            : nil

        return CostBreakdownCompact(
            bigValue: CostBreakdownFormat.number(
                currentMonthCost,
                decimals: 0,
                localeIdentifier: prefs.localeIdentifier
            ),
            unit: prefs.currencySymbol,
            label: CostBreakdownStrings.string("widget.costBreakdown.monthlyTotal", "This Month"),
            subtitle: subtitle,
            badgeText: badge
        )
    }

    // MARK: Helpers

    /// `entry.month ?? '—'` parity — a blank month label falls back to the em dash.
    private static func monthLabel(_ month: String) -> String {
        month.isEmpty ? emptyValue : month
    }

    private static func currency(
        _ amount: Double,
        prefs: CostBreakdownPrefs,
        decimals: Int? = nil
    ) -> String {
        CostBreakdownFormat.currency(
            amount,
            symbol: prefs.currencySymbol,
            precision: decimals ?? prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the cost breakdown. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum CostBreakdownAccessibility {
    /// One spoken sentence per visible element for the given layout, prefixed by the surface title.
    public static func summary(for projection: CostBreakdownProjection, layout: CostBreakdownLayout) -> String {
        let title = CostBreakdownStrings.string("widget.costBreakdown.title", "Cost Breakdown")
        if layout == .compact {
            return compactSummary(projection, title: title)
        }
        var parts = [title]
        for card in projection.statCards {
            parts.append(card.accessibilityLabel)
        }
        if let top = projection.rankedItems.first {
            parts.append(top.accessibilityLabel)
        }
        return parts.joined(separator: ". ")
    }

    private static func compactSummary(_ projection: CostBreakdownProjection, title: String) -> String {
        let compact = projection.compact
        var parts = [title, "\(compact.label) \(compact.unit)\(compact.bigValue)"]
        if let subtitle = compact.subtitle, !subtitle.isEmpty {
            parts.append(subtitle)
        }
        if let badge = compact.badgeText, !badge.isEmpty {
            parts.append(badge)
        }
        return parts.joined(separator: ". ")
    }
}
