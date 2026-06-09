//
//  DetailedStatistics.Adapter.swift
//  TeslaSync — P4 feature view · 0101 · DetailedStatistics (Apple)
//
//  The testable projection core for the charging-list "Detailed Statistics" panel — the faithful
//  port of features/charging/components/charging-list/DetailedStatistics.tsx. Everything here is
//  pure and dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web component takes `stats: ChargingStats` + `enhanced: EnhancedStats` (both computed
//      by the parent charging list from `useCharging` via `computeStats` / `computeEnhancedStats`)
//      and renders six centered tiles inside a `<GlassPanel>` headed by a TrendingUp title. The
//      native source seam provides the same value-typed snapshot and this adapter projects the six
//      tiles from it (one tested seam).
//    • The six tiles, in the exact web order: Total Sessions `<AnimatedNumber stats.count/>`
//      (0 dp, animated), Avg Duration `formatDuration(enhanced.avgDuration)`, Avg Power
//      `fmtWithUnit(stats.avgPower, 'kW')` (the global decimal precision, default 2), Top Charger
//      `enhanced.mostCommonType[0]` (the raw charger label) with a "(N×)" count suffix, Total Cost
//      `<Currency stats.totalCost/>` (2 dp), Avg $/kWh `<Currency stats.avgCostPerKwh precision=3/>`.
//    • Value colors mirror the web Tailwind classes: Avg Power is `text-purple-300` (mapped to the
//      `chartSeriesPower` design token), Total Cost is `text-amber-300`, Avg $/kWh is
//      `text-emerald-300`, and the remaining three are `text-[var(--text-primary)]`.
//    • The web parent only mounts this panel when `stats` and `enhanced` are both present (there
//      were charging sessions); a missing snapshot resolves to `.empty`, widened with the loading
//      and error envelope the parent list owns.
//

import Foundation

// MARK: - Charging stats snapshot (web `ChargingStats`)

/// The fields of the web `ChargingStats` that `DetailedStatistics` actually reads. The full web
/// interface also carries energy / duration / per-category counts (surfaced by sibling charging-
/// list components, not by this panel), so only the four this panel consumes are modeled —
/// mirroring the sibling QuickMetrics precedent of modeling just the read fields.
public struct DetailedStatisticsStats: Sendable, Equatable {
    /// `count` — total number of charging sessions in the window (the animated headline tile).
    public var count: Int
    /// `avgPower` — mean peak power across sessions, already in kW (the web `computeStats`
    /// converts SI → kW before this component sees it).
    public var avgPower: Double
    /// `totalCost` — total session cost in the user's currency (no FX is applied here).
    public var totalCost: Double
    /// `avgCostPerKwh` — blended cost per kWh in the user's currency.
    public var avgCostPerKwh: Double

    public init(count: Int, avgPower: Double, totalCost: Double, avgCostPerKwh: Double) {
        self.count = count
        self.avgPower = avgPower
        self.totalCost = totalCost
        self.avgCostPerKwh = avgCostPerKwh
    }
}

// MARK: - Enhanced stats snapshot (web `EnhancedStats`)

/// The web `EnhancedStats` this panel reads: the mean session duration (minutes) and the most
/// common charger type as a `(name, count)` pair (web `mostCommonType: [string, number]`).
public struct DetailedStatisticsEnhanced: Sendable, Equatable {
    /// `avgDuration` — mean session duration in **minutes** (web `stats.totalDuration / count`).
    public var avgDuration: Double
    /// `mostCommonType[0]` — the raw charger label (e.g. "Tesla Supercharger", "AC/Home"). This is
    /// data, not a localized string, and is rendered verbatim.
    public var mostCommonTypeName: String
    /// `mostCommonType[1]` — how many sessions used that charger type (the "(N×)" label suffix).
    public var mostCommonTypeCount: Int

    public init(avgDuration: Double, mostCommonTypeName: String, mostCommonTypeCount: Int) {
        self.avgDuration = avgDuration
        self.mostCommonTypeName = mostCommonTypeName
        self.mostCommonTypeCount = mostCommonTypeCount
    }
}

// MARK: - Tile value tone (web value text color)

/// The value-text color a tile carries, mapped from the web Tailwind classes
/// (`text-purple-300` / `text-amber-300` / `text-emerald-300` / `text-[var(--text-primary)]`) to
/// the design tokens so light / dark / high-contrast all resolve correctly.
public enum DetailedStatisticTone: String, Sendable, Equatable, CaseIterable {
    /// The three neutral tiles — web `text-[var(--text-primary)]`.
    case primary
    /// Avg Power — web `text-purple-300` → the `chartSeriesPower` token.
    case power
    /// Total Cost — web `text-amber-300` → the `statusWarning` token.
    case warning
    /// Avg $/kWh — web `text-emerald-300` → the `statusSuccess` token.
    case success
}

// MARK: - Tile projection (web tile)

/// One projected statistic tile (web `<div>` with a bold value `<p>` and a label `<p>`). The
/// `value` is a pre-formatted string rendered verbatim (a localized number, currency, unit,
/// duration, or charger label); `labelCount`, when present, is the "(N×)" suffix the Top Charger
/// tile appends to its localized label.
public struct DetailedStatistic: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let tone: DetailedStatisticTone
    /// The Top Charger occurrence count rendered as " (N×)" after the label, or `nil` for the
    /// other five tiles (web: only Top Charger carries the count suffix).
    public let labelCount: Int?
    /// Whether the value animates on change — only Total Sessions uses the web `<AnimatedNumber>`
    /// (native `.contentTransition(.numericText())`); the other tiles render verbatim.
    public let animatesValue: Bool

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        tone: DetailedStatisticTone,
        labelCount: Int? = nil,
        animatesValue: Bool = false
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.tone = tone
        self.labelCount = labelCount
        self.animatesValue = animatesValue
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web parent mounts the panel only when `stats` + `enhanced`
/// are present (content); their absence is the empty state. The loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring the parent list's lifecycle.
public enum DetailedStatisticsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the charging query, projected into a phase.
public enum DetailedStatisticsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so cached
/// statistics are clearly labeled while reconnecting / offline.
public enum DetailedStatisticsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Number / currency / duration formatting (web `fmtNumber` / `Currency` / `formatDuration`)

/// Pure formatting helpers reproducing the web `lib/numberFormat.ts` (`safeNumber`, `fmtNumber`,
/// `fmtWithUnit`), the `<Currency>` renderer, and `lib/dateFormat.ts` (`formatDurationMinutes`,
/// re-exported as `formatDuration`) so every platform shows identical strings. All pure + testable.
public enum DetailedStatisticsFormat {
    /// The em-dash the web `formatDurationMinutes` (`FALLBACK`) and `<Currency>` (`fallback`) return
    /// for an invalid value.
    public static let emDash = "—"

    /// The kW unit symbol the web hardcodes for the Avg Power tile (`fmtWithUnit(_, 'kW')`).
    public static let kilowattSymbol = "kW"

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of fraction
    /// digits, with the JS `toLocaleString` half-away-from-zero rounding and the `safeNumber`
    /// non-finite → 0 guard.
    public static func number(
        _ value: Double,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Web `<AnimatedNumber value={count} />` → `fmtNumber(count, 0)`: the grouped integer the
    /// count animates to.
    public static func count(_ value: Int, locale: Locale = Locale(identifier: "en-US")) -> String {
        number(Double(value), decimals: 0, locale: locale)
    }

    /// Web `<Currency value={amount} precision={decimals} />`: the user's currency symbol prefixed
    /// to the grouped amount. A `null` / non-finite amount yields the em-dash (the `Currency`
    /// `fallback`), with no symbol.
    public static func currency(
        _ value: Double,
        symbol: String,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        guard value.isFinite else { return emDash }
        return symbol + number(value, decimals: decimals, locale: locale)
    }

    /// Web `fmtWithUnit(value, unit)`: the grouped number at the given decimal precision followed by
    /// a space and the unit symbol.
    public static func withUnit(
        _ value: Double,
        unit: String,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        "\(number(value, decimals: decimals, locale: locale)) \(unit)"
    }

    /// Web `formatDurationMinutes(minutes)`: `'—'` for a non-finite or negative input, else
    /// `"{h}h {m}m"` (hours floored, remaining minutes rounded half-away-from-zero) or `"{m}m"`
    /// when under an hour.
    public static func duration(minutes: Double) -> String {
        guard minutes.isFinite, minutes >= 0 else { return emDash }
        let hours = Int((minutes / 60).rounded(.down))
        let remainder = minutes.truncatingRemainder(dividingBy: 60)
        let mins = Int(remainder.rounded(.toNearestOrAwayFromZero))
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// The Top Charger label value (web `enhanced.mostCommonType[0]`), guarding an empty string to
    /// the em-dash so the tile never renders blank.
    public static func chargerName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? emDash : trimmed
    }
}

// MARK: - Projection (pure, web-parity)

/// The dependency-free projection from the cached `DetailedStatisticsStats` + `…Enhanced` + the
/// user's currency / locale / precision preferences to the six view-ready tiles + the render phase.
/// A faithful port of the web component's read of `stats` and `enhanced`.
public enum DetailedStatisticsProjection {
    /// Builds the six tiles in the exact web order. Returns an empty array when either snapshot is
    /// nil (the web parent renders nothing when there were no sessions), which the phase resolves
    /// to `.empty`.
    public static func metrics(
        stats: DetailedStatisticsStats?,
        enhanced: DetailedStatisticsEnhanced?,
        currencySymbol: String,
        locale: Locale = Locale(identifier: "en-US"),
        precision: Int = 2
    ) -> [DetailedStatistic] {
        guard let stats, let enhanced else { return [] }
        return [
            totalSessionsTile(stats, locale: locale),
            avgDurationTile(enhanced),
            avgPowerTile(stats, locale: locale, precision: precision),
            topChargerTile(enhanced),
            totalCostTile(stats, symbol: currencySymbol, locale: locale),
            avgCostPerKwhTile(stats, symbol: currencySymbol, locale: locale)
        ]
    }

    /// Tile 1 — Total Sessions (web `<AnimatedNumber stats.count/>`, 0 dp, animated, primary).
    private static func totalSessionsTile(_ stats: DetailedStatisticsStats, locale: Locale) -> DetailedStatistic {
        DetailedStatistic(
            id: "totalSessions",
            labelKey: "charging.stats.totalSessions",
            labelFallback: "Total Sessions",
            value: DetailedStatisticsFormat.count(stats.count, locale: locale),
            tone: .primary,
            animatesValue: true
        )
    }

    /// Tile 2 — Avg Duration (web `formatDuration(enhanced.avgDuration)`, primary).
    private static func avgDurationTile(_ enhanced: DetailedStatisticsEnhanced) -> DetailedStatistic {
        DetailedStatistic(
            id: "avgDuration",
            labelKey: "charging.stats.avgDuration",
            labelFallback: "Avg Duration",
            value: DetailedStatisticsFormat.duration(minutes: enhanced.avgDuration),
            tone: .primary
        )
    }

    /// Tile 3 — Avg Power (web `fmtWithUnit(stats.avgPower, 'kW')`, the global precision, purple).
    private static func avgPowerTile(
        _ stats: DetailedStatisticsStats,
        locale: Locale,
        precision: Int
    ) -> DetailedStatistic {
        DetailedStatistic(
            id: "avgPower",
            labelKey: "charging.stats.avgPower",
            labelFallback: "Avg Power",
            value: DetailedStatisticsFormat.withUnit(
                stats.avgPower,
                unit: DetailedStatisticsFormat.kilowattSymbol,
                decimals: precision,
                locale: locale
            ),
            tone: .power
        )
    }

    /// Tile 4 — Top Charger (web `enhanced.mostCommonType[0]` + "(N×)" label suffix, primary).
    private static func topChargerTile(_ enhanced: DetailedStatisticsEnhanced) -> DetailedStatistic {
        DetailedStatistic(
            id: "topCharger",
            labelKey: "charging.stats.topCharger",
            labelFallback: "Top Charger",
            value: DetailedStatisticsFormat.chargerName(enhanced.mostCommonTypeName),
            tone: .primary,
            labelCount: enhanced.mostCommonTypeCount
        )
    }

    /// Tile 5 — Total Cost (web `<Currency stats.totalCost/>`, 2 dp, amber).
    private static func totalCostTile(
        _ stats: DetailedStatisticsStats,
        symbol: String,
        locale: Locale
    ) -> DetailedStatistic {
        DetailedStatistic(
            id: "totalCost",
            labelKey: "charging.stats.totalCost",
            labelFallback: "Total Cost",
            value: DetailedStatisticsFormat.currency(stats.totalCost, symbol: symbol, decimals: 2, locale: locale),
            tone: .warning
        )
    }

    /// Tile 6 — Avg $/kWh (web `<Currency stats.avgCostPerKwh precision=3/>`, 3 dp, emerald).
    private static func avgCostPerKwhTile(
        _ stats: DetailedStatisticsStats,
        symbol: String,
        locale: Locale
    ) -> DetailedStatistic {
        DetailedStatistic(
            id: "avgCostPerKwh",
            labelKey: "charging.stats.avgCostPerKwh",
            labelFallback: "Avg $/kWh",
            value: DetailedStatisticsFormat.currency(stats.avgCostPerKwh, symbol: symbol, decimals: 3, locale: locale),
            tone: .success
        )
    }

    /// Resolves the render phase from the bound load status + whether both snapshots are present
    /// (web `stats && enhanced ? panel : nothing`). Cached data stays `.content` through a failure
    /// so the freshness chip / banner flag staleness rather than blanking the panel.
    public static func resolvePhase(
        _ status: DetailedStatisticsLoadStatus,
        hasData: Bool
    ) -> DetailedStatisticsPhase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free
/// core so it is reachable from the projection's unit tests.
public enum DetailedStatisticsSurface {
    public static let slug = "DetailedStatistics"
}
