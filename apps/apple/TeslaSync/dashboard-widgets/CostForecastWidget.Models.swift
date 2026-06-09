//
//  CostForecastWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/CostForecastWidget.tsx: the cached historical /
//  forecast month DTOs (subset this widget reads), the vehicle identity, the
//  display-boundary currency formatter, the projected bar, and the merged
//  projection the view renders. Pure Foundation — no SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web CostForecastData → historical/forecast)

/// One historical month from `GET /analytics/cost-forecast` — the Swift port of
/// the subset of the web `CostHistoricalMonth` this widget reads
/// (`types/charging.ts`): the month label, the total `cost`, and the
/// `cost_per_kwh` the "Avg $/kWh" stat reads from the most-recent month. All
/// optional because the web guards each with `?? 0` / `?? '—'`.
public struct CostForecastWidgetHistoricalMonth: Sendable, Equatable, Identifiable {
    public var id: Int
    public var month: String?
    public var cost: Double?
    public var costPerKwh: Double?

    public init(id: Int, month: String? = nil, cost: Double? = nil, costPerKwh: Double? = nil) {
        self.id = id
        self.month = month
        self.cost = cost
        self.costPerKwh = costPerKwh
    }
}

/// One projected month from `GET /analytics/cost-forecast` — the Swift port of
/// the subset of the web `CostForecastMonth` this widget reads: the month label
/// and the projected `cost` (the first forecast month is the "Next Month" stat).
public struct CostForecastWidgetForecastMonth: Sendable, Equatable, Identifiable {
    public var id: Int
    public var month: String?
    public var cost: Double?

    public init(id: Int, month: String? = nil, cost: Double? = nil) {
        self.id = id
        self.month = month
        self.cost = cost
    }
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// optional accessibility).
public struct CostForecastWidgetVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        return name
    }
}

// MARK: - Currency formatter (display boundary — web `formatCurrency`)

/// The widget's display-boundary currency formatter — the Swift port of the web
/// `useFormatting().formatCurrency`: `symbol + fmtNumber(amount, decimals)`. The
/// `symbol` is the user's `currency_symbol` (web default `$`) and `precision`
/// the user's `decimal_precision` (web default 2), both supplied by the source
/// from the shared settings store. Held as a `Sendable` value so the projection,
/// the view, and the accessibility summary all format identically and testably.
public struct CostForecastWidgetCurrencyFormatter: Sendable, Equatable {
    public var symbol: String
    public var precision: Int
    public var localeIdentifier: String

    public init(symbol: String = "$", precision: Int = 2, localeIdentifier: String = "en_US") {
        let trimmed = symbol.trimmingCharacters(in: .whitespacesAndNewlines)
        self.symbol = trimmed.isEmpty ? "$" : trimmed
        self.precision = max(0, precision)
        self.localeIdentifier = localeIdentifier
    }

    /// Formats an amount as `symbol + grouped fixed-decimal number`, mirroring
    /// `formatCurrency(amount, decimals)`. `decimals == nil` uses the user's
    /// precision (web `decimals ?? userPrecision`).
    public func string(_ amount: Double, decimals: Int? = nil) -> String {
        let digits = decimals ?? precision
        let number = CostForecastWidgetFormat.number(amount, decimals: digits, localeIdentifier: localeIdentifier)
        return "\(symbol)\(number)"
    }
}

// MARK: - Projection (port of the web BarDatum + the derived stat values)

/// One projected bar — the Swift port of the web `BarDatum`: the month label
/// (web `month ?? '—'`), the display `cost`, whether it is a forecast (vs
/// historical) month, and a stable, unique `plotKey` so Swift Charts keeps the
/// months ordered and never collapses a historical and a forecast month that
/// share the same label.
public struct CostForecastWidgetBar: Sendable, Equatable, Identifiable {
    public var plotKey: String
    public var month: String
    public var cost: Double
    public var isForecast: Bool

    public init(plotKey: String, month: String, cost: Double, isForecast: Bool) {
        self.plotKey = plotKey
        self.month = month
        self.cost = cost
        self.isForecast = isForecast
    }

    public var id: String {
        plotKey
    }
}

/// The merged projection the view switches over — the last six months as ordered
/// bars (web `slice(-6)`), the next-month projected cost (web `nextCost`), the
/// most-recent historical cost (web `lastCost`) plus the trend direction and
/// absolute delta (web `trendUp` / `nextCost - lastCost`), the most-recent
/// `cost_per_kwh` for the "Avg $/kWh" stat (`nil` when there is no historical
/// month → web `'—'`), and whether there is anything to chart (web
/// `hasData = chartData.length > 0`).
public struct CostForecastWidgetProjection: Sendable, Equatable {
    public var bars: [CostForecastWidgetBar]
    public var nextCost: Double
    public var lastCost: Double
    public var trendUp: Bool
    public var trendDelta: Double
    public var avgCostPerKwh: Double?
    public var hasData: Bool

    public init(
        bars: [CostForecastWidgetBar],
        nextCost: Double,
        lastCost: Double,
        trendUp: Bool,
        trendDelta: Double,
        avgCostPerKwh: Double?,
        hasData: Bool
    ) {
        self.bars = bars
        self.nextCost = nextCost
        self.lastCost = lastCost
        self.trendUp = trendUp
        self.trendDelta = trendDelta
        self.avgCostPerKwh = avgCostPerKwh
        self.hasData = hasData
    }

    /// Empty projection (no months resolved yet). `trendUp` defaults to `true`
    /// to match the web `nextCost (0) >= lastCost (0)`.
    public static let empty = CostForecastWidgetProjection(
        bars: [],
        nextCost: 0,
        lastCost: 0,
        trendUp: true,
        trendDelta: 0,
        avgCostPerKwh: nil,
        hasData: false
    )
}
