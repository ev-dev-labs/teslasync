//
//  ChargeCostTrackerWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `[ChargeCostSession]` + `ChargeCostPrefs`
//  → display strings, reproducing the web source's numeric pipeline VERBATIM so the native
//  surface shows the exact same values as features/dashboard/widgets/ChargeCostTrackerWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web lib/constants.ts + the widget source)

private enum ChargeCostConstants {
    /// `AVG_MI_PER_KWH` from the web widget: the rough miles-per-kWh efficiency used to turn the
    /// month's kWh into an estimated distance.
    static let avgMilesPerKwh = 3.5
    /// `FUEL.GALLONS_TO_LITERS` from lib/constants.ts.
    static let gallonsToLiters = 3.78541
}

// MARK: - Raw metrics (web `CostMetrics`)

/// The raw, unformatted cost metrics — the native parity of the web `CostMetrics` interface. Kept
/// separate from the display strings so the numeric pipeline can be pinned by tests independent of
/// locale/currency formatting.
public struct ChargeCostMetrics: Equatable {
    public let totalKwh: Double
    public let totalCost: Double
    public let costPerDistance: Double?
    public let gasSavings: Double?
    public let sessionCount: Int
    public let totalDistanceMi: Double

    public init(
        totalKwh: Double,
        totalCost: Double,
        costPerDistance: Double?,
        gasSavings: Double?,
        sessionCount: Int,
        totalDistanceMi: Double
    ) {
        self.totalKwh = totalKwh
        self.totalCost = totalCost
        self.costPerDistance = costPerDistance
        self.gasSavings = gasSavings
        self.sessionCount = sessionCount
        self.totalDistanceMi = totalDistanceMi
    }
}

// MARK: - Projected tile (web `MetricCard`)

/// The accent tone of a metric tile, mirroring the web `MetricCard` `color` prop (`cyan` / `green` /
/// `amber`). Resolved to a concrete `Color` in the view (kept SwiftUI-free here).
public enum ChargeCostTone: String, Equatable {
    case cyan
    case green
    case amber
}

/// One projected metric tile: an SF Symbol, an accent tone, a localized label, a formatted value and
/// an optional supporting subtitle. Mirrors the web `MetricCard` (`icon`, `color`, `label`, `value`,
/// `subtitle`).
public struct ChargeCostTile: Identifiable, Equatable {
    public let id: String
    public let systemImage: String
    public let tone: ChargeCostTone
    public let label: String
    public let value: String
    public let subtitle: String?

    public init(
        id: String,
        systemImage: String,
        tone: ChargeCostTone,
        label: String,
        value: String,
        subtitle: String?
    ) {
        self.id = id
        self.systemImage = systemImage
        self.tone = tone
        self.label = label
        self.value = value
        self.subtitle = subtitle
    }

    /// The VoiceOver sentence for this tile: "label value[, subtitle]".
    public var accessibilityLabel: String {
        if let subtitle, !subtitle.isEmpty {
            return "\(label) \(value), \(subtitle)"
        }
        return "\(label) \(value)"
    }
}

// MARK: - Projection

/// The fully-projected widget content for every layout: the two primary tiles (Total Energy / Total
/// Cost), the two secondary tiles shown when tall (Cost / distance, vs Gas Savings), the compact
/// big-number value, and the standard-layout footer. Computed once per snapshot by the model.
public struct ChargeCostProjection: Equatable {
    public let metrics: ChargeCostMetrics
    public let distanceSymbol: String
    public let primaryTiles: [ChargeCostTile]
    public let secondaryTiles: [ChargeCostTile]
    public let compactValue: String
    public let compactCaption: String
    public let footerLeft: String
    public let footerRight: String

    public init(
        metrics: ChargeCostMetrics,
        distanceSymbol: String,
        primaryTiles: [ChargeCostTile],
        secondaryTiles: [ChargeCostTile],
        compactValue: String,
        compactCaption: String,
        footerLeft: String,
        footerRight: String
    ) {
        self.metrics = metrics
        self.distanceSymbol = distanceSymbol
        self.primaryTiles = primaryTiles
        self.secondaryTiles = secondaryTiles
        self.compactValue = compactValue
        self.compactCaption = compactCaption
        self.footerLeft = footerLeft
        self.footerRight = footerRight
    }

    /// The tiles shown for a given layout: the tall layout appends the two secondary tiles, the
    /// standard layout shows only the primary pair (its extra detail lives in the footer).
    public func tiles(for layout: ChargeCostLayout) -> [ChargeCostTile] {
        layout == .tall ? primaryTiles + secondaryTiles : primaryTiles
    }
}

// MARK: - Layout (web `isCompact` / `isTall`)

/// The widget's render layout, resolved from its grid footprint exactly as the web source does
/// (`isCompact = cols <= 1 && rows <= 1`, `isTall = rows >= 2`). Pure + testable; the registry's
/// `minSize` of 1×2 means the live dashboard always resolves to `.tall`, but the full ladder is
/// implemented for parity with every branch of the web source.
public enum ChargeCostLayout: Equatable {
    case compact
    case standard
    case tall

    public static func resolve(_ size: DashboardWidgetSize) -> ChargeCostLayout {
        if size.cols <= 1, size.rows <= 1 { return .compact }
        if size.rows >= 2 { return .tall }
        return .standard
    }
}

// MARK: - Projector

/// Pure projector: `[ChargeCostSession]` + `ChargeCostPrefs` → `ChargeCostProjection`. Every value
/// is computed with the exact same arithmetic + formatting as the web widget's `computeMetrics`.
public enum ChargeCostProjector {
    private static let emptyValue = "—"

    /// The web `computeMetrics(sessions, costPerKwh, costPerDistFn, estimateGasCostFn)` ported
    /// verbatim — including the miles-as-metres call chain, preserved for cross-platform parity.
    public static func computeMetrics(sessions: [ChargeCostSession], prefs: ChargeCostPrefs) -> ChargeCostMetrics {
        var totalKwh = 0.0
        var totalCost = 0.0

        for session in sessions {
            let energy = convertChargeEnergyFromSIToKwh(session.totalEnergyAddedWh)
            totalKwh += energy
            // Prefer session cost if recorded, otherwise estimate from kWh.
            totalCost += session.cost ?? (energy * prefs.costPerKwh)
        }

        let totalDistanceMi = totalKwh * ChargeCostConstants.avgMilesPerKwh
        let costPerDistance = costPerDistanceUnit(kwh: totalKwh, distance: totalDistanceMi, prefs: prefs)
        let gasCost = estimateGasCost(distance: totalDistanceMi, prefs: prefs)
        let gasSavings = gasCost.map { $0 - totalCost }

        return ChargeCostMetrics(
            totalKwh: totalKwh,
            totalCost: totalCost,
            costPerDistance: costPerDistance,
            gasSavings: gasSavings,
            sessionCount: sessions.count,
            totalDistanceMi: totalDistanceMi
        )
    }

    public static func project(sessions: [ChargeCostSession], prefs: ChargeCostPrefs) -> ChargeCostProjection {
        let metrics = computeMetrics(sessions: sessions, prefs: prefs)
        let locale = prefs.localeIdentifier
        let symbol = prefs.distance.symbol

        let primaryTiles = makePrimaryTiles(metrics: metrics, prefs: prefs, locale: locale)
        let secondaryTiles = makeSecondaryTiles(metrics: metrics, prefs: prefs, locale: locale, symbol: symbol)

        return ChargeCostProjection(
            metrics: metrics,
            distanceSymbol: symbol,
            primaryTiles: primaryTiles,
            secondaryTiles: secondaryTiles,
            compactValue: currency(metrics.totalCost, prefs: prefs, decimals: 0, locale: locale),
            compactCaption: ChargeCostStrings.string("widget.chargeCost.monthly", "30-day cost"),
            footerLeft: footerLeft(metrics: metrics, prefs: prefs, locale: locale, symbol: symbol),
            footerRight: footerRight(metrics: metrics, prefs: prefs, locale: locale)
        )
    }

    // MARK: Tiles

    private static func makePrimaryTiles(
        metrics: ChargeCostMetrics,
        prefs: ChargeCostPrefs,
        locale: String
    ) -> [ChargeCostTile] {
        let energyValue = "\(ChargeCostFormat.number(metrics.totalKwh, decimals: 1, localeIdentifier: locale)) "
            + ChargeCostStrings.string("widget.chargeCost.kwh", "kWh")
        let perKwh = currency(prefs.costPerKwh, prefs: prefs, locale: locale)
        let kwhLabel = ChargeCostStrings.string("widget.chargeCost.kwh", "kWh")

        return [
            ChargeCostTile(
                id: "total-energy",
                systemImage: "bolt.fill",
                tone: .cyan,
                label: ChargeCostStrings.string("widget.chargeCost.totalEnergy", "Total Energy"),
                value: energyValue,
                subtitle: ChargeCostStrings.format(
                    "widget.chargeCost.sessions",
                    "%d sessions",
                    metrics.sessionCount
                )
            ),
            ChargeCostTile(
                id: "total-cost",
                systemImage: "dollarsign.circle.fill",
                tone: .green,
                label: ChargeCostStrings.string("widget.chargeCost.totalCost", "Total Cost"),
                value: currency(metrics.totalCost, prefs: prefs, locale: locale),
                subtitle: "\(perKwh)/\(kwhLabel)"
            )
        ]
    }

    private static func makeSecondaryTiles(
        metrics: ChargeCostMetrics,
        prefs: ChargeCostPrefs,
        locale: String,
        symbol: String
    ) -> [ChargeCostTile] {
        let costPerDistanceValue = metrics.costPerDistance
            .map { currency($0, prefs: prefs, decimals: 3, locale: locale) } ?? emptyValue
        let gasSavingsValue = metrics.gasSavings
            .map { currency($0, prefs: prefs, locale: locale) } ?? emptyValue
        let gasSubtitle = metrics.gasSavings != nil
            ? ChargeCostStrings.string("widget.chargeCost.savingsNote", "30-day estimate")
            : ChargeCostStrings.string("widget.chargeCost.configureGas", "Set gas price in settings")

        return [
            ChargeCostTile(
                id: "cost-per-distance",
                systemImage: "fuelpump.fill",
                tone: .amber,
                label: ChargeCostStrings.format("widget.chargeCost.costPerDistance", "Cost / %@", symbol),
                value: costPerDistanceValue,
                subtitle: nil
            ),
            ChargeCostTile(
                id: "gas-savings",
                systemImage: "chart.line.downtrend.xyaxis",
                tone: .green,
                label: ChargeCostStrings.string("widget.chargeCost.gasSavings", "vs Gas Savings"),
                value: gasSavingsValue,
                subtitle: gasSubtitle
            )
        ]
    }

    // MARK: Footer (web standard-layout `!isTall` row)

    private static func footerLeft(
        metrics: ChargeCostMetrics,
        prefs: ChargeCostPrefs,
        locale: String,
        symbol: String
    ) -> String {
        guard let costPerDistance = metrics.costPerDistance else { return emptyValue }
        return "\(currency(costPerDistance, prefs: prefs, decimals: 3, locale: locale))/\(symbol)"
    }

    private static func footerRight(
        metrics: ChargeCostMetrics,
        prefs: ChargeCostPrefs,
        locale: String
    ) -> String {
        guard let gasSavings = metrics.gasSavings else { return "" }
        return ChargeCostStrings.format(
            "widget.chargeCost.saved",
            "Saved %@ vs gas",
            currency(gasSavings, prefs: prefs, locale: locale)
        )
    }

    // MARK: Numeric helpers (web `useFormatting`)

    /// `costPerDistanceUnit(kwh, distanceM)` ported verbatim — the second argument flows in as the
    /// web's miles-valued estimate even though the SI signature reads it as metres.
    private static func costPerDistanceUnit(kwh: Double, distance: Double, prefs: ChargeCostPrefs) -> Double? {
        guard distance > 0 else { return nil }
        let cost = kwh * prefs.costPerKwh
        let displayDistance = convertChargeDistanceFromSI(distance, to: prefs.distance)
        return displayDistance > 0 ? cost / displayDistance : nil
    }

    /// `estimateGasCost(distanceM)` ported verbatim — mpg is mile-based so the value is converted to
    /// miles (again reading the miles-valued estimate as metres) before applying mpg + price.
    private static func estimateGasCost(distance: Double, prefs: ChargeCostPrefs) -> Double? {
        let mpg = prefs.gasEfficiencyMpg
        let gasPrice = prefs.gasPricePerUnit
        guard mpg > 0, gasPrice > 0, distance > 0 else { return nil }
        let distanceMi = convertChargeDistanceFromSI(distance, to: .miles)
        let gallonsUsed = distanceMi / mpg
        if prefs.gasUnit == .liter {
            return gallonsUsed * ChargeCostConstants.gallonsToLiters * gasPrice
        }
        return gallonsUsed * gasPrice
    }

    private static func currency(
        _ amount: Double,
        prefs: ChargeCostPrefs,
        decimals: Int? = nil,
        locale: String
    ) -> String {
        ChargeCostFormat.currency(
            amount,
            symbol: prefs.currencySymbol,
            precision: decimals ?? prefs.precision,
            localeIdentifier: locale
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the cost breakdown. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum ChargeCostAccessibility {
    /// One spoken sentence per visible element for the given layout, prefixed by the surface title.
    public static func summary(for projection: ChargeCostProjection, layout: ChargeCostLayout) -> String {
        let title = ChargeCostStrings.string("widget.chargeCost.title", "Charge Cost Tracker")
        if layout == .compact {
            return "\(title) \(projection.compactValue) \(projection.compactCaption)"
        }
        var parts = [title]
        for tile in projection.tiles(for: layout) {
            parts.append(tile.accessibilityLabel)
        }
        if layout == .standard {
            if !projection.footerLeft.isEmpty, projection.footerLeft != "—" {
                parts.append(projection.footerLeft)
            }
            if !projection.footerRight.isEmpty {
                parts.append(projection.footerRight)
            }
        }
        return parts.joined(separator: ". ")
    }
}
