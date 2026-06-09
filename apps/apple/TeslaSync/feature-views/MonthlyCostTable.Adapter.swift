//
//  MonthlyCostTable.Adapter.swift
//  TeslaSync — P4 feature view · 0117 · MonthlyCostTable (Apple)
//
//  The testable projection core for the monthly cost-breakdown table — the SwiftUI
//  parity of features/charging/components/cost-analysis/MonthlyCostTable.tsx plus the
//  web helpers it is fed by: `fmtInt` / `fmtWithUnit` / `fmtNumber` (lib/numberFormat.ts)
//  and the `Currency` renderer (components/data-display/format/Currency.tsx). Everything
//  here is pure + dependency-free (no store, no bundle, no rendered view) so the bucket
//  model, the locale number/currency formatting, the signed-savings wording, and the
//  default month-descending sort + per-column comparators are all unit tested in isolation.
//
//  Parity note: the web table is a presentational leaf fed a `MonthlyBucket[]` prop that
//  its parent (the cost-analysis page) has already aggregated into display units —
//  `energy` is kWh, `cost` / `gasEquiv` / `savings` are the user's currency, and
//  `avgCostPerKwh` is currency-per-kWh. This core carries those numbers verbatim (it does
//  not reinterpret or apply SI conversion, which the parent owns) and only reproduces the
//  web's formatting + ordering arithmetic exactly.
//

import Foundation

// MARK: - Bucket model (web `MonthlyBucket` from cost-analysis/types.ts)

/// One month's roll-up — the native mirror of the web `MonthlyBucket`. `id` is the
/// `month` label (the web `keyExtractor={(row) => row.month}`); the numeric fields stay
/// raw so the view formats them through `MonthlyCostFormat`.
public struct MonthlyCostBucket: Identifiable, Equatable, Sendable {
    /// The month label rendered in the first column and used as the row identity.
    public let month: String
    /// Total spend for the month (user currency).
    public let cost: Double
    /// Total energy delivered for the month (kWh — already display-scaled upstream).
    public let energy: Double
    /// Number of charging sessions in the month.
    public let sessions: Int
    /// Blended price per kWh for the month (currency per kWh).
    public let avgCostPerKwh: Double
    /// Equivalent gasoline spend for the same distance (user currency).
    public let gasEquiv: Double
    /// Gas-equivalent minus actual EV spend (user currency; negative ⇒ EV cost more).
    public let savings: Double

    public var id: String {
        month
    }

    public init(
        month: String,
        cost: Double,
        energy: Double,
        sessions: Int,
        avgCostPerKwh: Double,
        gasEquiv: Double,
        savings: Double
    ) {
        self.month = month
        self.cost = cost
        self.energy = energy
        self.sessions = sessions
        self.avgCostPerKwh = avgCostPerKwh
        self.gasEquiv = gasEquiv
        self.savings = savings
    }
}

// MARK: - Number / currency formatting (ports of numberFormat.ts + Currency.tsx)

/// Pure number + currency formatting ported from the web helpers so the rounding, the
/// grouping separators, the fixed precision, and the signed-savings wording match the
/// source exactly. The web global precision is 2 and `safeNumber` coerces non-finite
/// input to 0; both are reproduced here, as is the `Currency` em-dash fallback.
public enum MonthlyCostFormat {
    /// The em-dash sentinel the web `Currency` renders for a missing / non-finite value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits,
    /// half-up rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)`, locale-grouped integer.
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        number(Double(value), decimals: 0, locale: locale)
    }

    /// Native port of `fmtWithUnit(v, unit, decimals)` — `fmtNumber` plus a spaced unit.
    public static func withUnit(
        _ value: Double,
        _ unit: String,
        decimals: Int = 2,
        locale: Locale = .current
    ) -> String {
        number(value, decimals: decimals, locale: locale) + " " + unit
    }

    /// Native port of the web `Currency` renderer: `{symbol}{fmtNumber(value, precision)}`,
    /// with the em-dash fallback for a non-finite amount. The symbol defaults to the web
    /// USD `$`; FX is never applied (the value is shown verbatim, exactly as the web does).
    public static func currency(
        _ value: Double,
        precision: Int = 2,
        symbol: String = "$",
        locale: Locale = .current
    ) -> String {
        guard value.isFinite else { return dash }
        return symbol + number(value, decimals: precision, locale: locale)
    }

    /// Native port of the web savings cell: `{value >= 0 ? '+' : ''}<Currency value/>`.
    /// A non-negative value gets a leading `+`; a negative value keeps the sign emitted by
    /// the number itself (e.g. `$-12.00`); a non-finite value falls back to the em dash.
    public static func signedCurrency(
        _ value: Double,
        precision: Int = 2,
        symbol: String = "$",
        locale: Locale = .current
    ) -> String {
        let prefix = value >= 0 ? "+" : ""
        return prefix + currency(value, precision: precision, symbol: symbol, locale: locale)
    }
}

// MARK: - Sorting (web `tableSortKey` / `tableSortDir`, default month / desc)

/// The sortable columns — the native mirror of the web `Column.key` values the
/// `DataTable` sorts on. Drives both the per-column comparators (header re-sort) and the
/// default ordering applied before the rows reach the table.
public enum MonthlyCostSortKey: String, Sendable, CaseIterable {
    case month
    case sessions
    case energy
    case cost
    case avgCostPerKwh
    case gasEquiv
    case savings
}

/// Pure sort helpers — the native port of the web `sortedData` memo. The web compares
/// numbers numerically and everything else by `localeCompare`, then applies the
/// direction; the default key is `month` and the default direction is descending.
public enum MonthlyCostSort {
    /// Ascending comparator for a column (the table applies the chosen direction). Numeric
    /// columns compare by value; the `month` column compares by localized string order.
    public static func comparator(
        for key: MonthlyCostSortKey
    ) -> (MonthlyCostBucket, MonthlyCostBucket) -> ComparisonResult {
        switch key {
        case .month: { $0.month.localizedCompare($1.month) }
        case .sessions: { compare(Double($0.sessions), Double($1.sessions)) }
        case .energy: { compare($0.energy, $1.energy) }
        case .cost: { compare($0.cost, $1.cost) }
        case .avgCostPerKwh: { compare($0.avgCostPerKwh, $1.avgCostPerKwh) }
        case .gasEquiv: { compare($0.gasEquiv, $1.gasEquiv) }
        case .savings: { compare($0.savings, $1.savings) }
        }
    }

    /// The web default ordering: `month` descending, stable across ties. Reuses the shared
    /// `TSTableSort` so the native default matches the table's own re-sort behaviour.
    public static func defaultSorted(_ buckets: [MonthlyCostBucket]) -> [MonthlyCostBucket] {
        TSTableSort.sorted(buckets, by: comparator(for: .month), ascending: false)
    }

    static func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver row string from already-formatted parts, so the spoken content is
/// asserted without rendering the view.
public enum MonthlyCostTableAccessibility {
    /// The per-row spoken label: "{month}, {sessions}, {energy}, {cost}, {savings}".
    public static func rowLabel(
        month: String,
        sessions: String,
        energy: String,
        cost: String,
        savings: String
    ) -> String {
        "\(month), \(sessions), \(energy), \(cost), \(savings)"
    }
}
