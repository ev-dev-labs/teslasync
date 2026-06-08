//
//  QuickMetrics.Adapter.swift
//  TeslaSync — P4 feature view · 0105 · QuickMetrics (Apple)
//
//  The testable projection core for the charging-list "Quick Metrics" strip — the faithful
//  port of features/charging/components/charging-list/QuickMetrics.tsx. Everything here is
//  pure and dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web component takes `stats: ChargingStats | null` (computed by the parent list
//      from `useCharging` via `computeStats`) and renders six centered tiles, or an
//      `EmptyState` when `stats` is null. The native source seam provides the same value-typed
//      snapshot and this adapter projects the six tiles from it (one tested seam).
//    • The six tiles, in the exact web order: Home `<AnimatedNumber homeCount/>`, Supercharger
//      `<AnimatedNumber scCount/>`, DC Fast `<AnimatedNumber dcCount/>` (the three counts at 0
//      decimals — `AnimatedNumber`'s default), Total Time `formatDuration(totalDuration)`,
//      Monthly Avg `<Currency totalCost/12 precision=0/>`, Per Session
//      `fmtWithUnit(totalEnergy/count, 'kWh')` (the global decimal precision, default 2).
//    • The three counts carry the web's emerald / rose / amber value color + a lucide glyph
//      (Home / Bolt / Zap); the three derived tiles use the primary text color and no glyph
//      (web `text-[var(--text-primary)]`).
//    • A null `stats` resolves to `.empty` (the web `EmptyState`), widened with the loading /
//      error load envelope the parent list owns.
//

import Foundation

// MARK: - Charging stats snapshot (web `ChargingStats`)

/// The fields of the web `ChargingStats` that `QuickMetrics` actually reads. The full web
/// interface also carries `avgPower` / `avgCostPerKwh` (surfaced by sibling charging-list
/// components, not by this strip), so only the seven QuickMetrics consumes are modeled —
/// mirroring the sibling DrivingPerformanceCards precedent of modeling just the read fields.
public struct QuickMetricsStats: Sendable, Equatable {
    /// `totalEnergy` — total energy added across the window, already in kWh (the web
    /// `computeStats` converts SI → kWh before this component sees it).
    public var totalEnergy: Double
    /// `totalCost` — total session cost in the user's currency (no FX is applied here).
    public var totalCost: Double
    /// `totalDuration` — summed session duration in **minutes** (web `durationMinutes` sum).
    public var totalDuration: Double
    /// `homeCount` — number of home / AC sessions.
    public var homeCount: Int
    /// `scCount` — number of Supercharger sessions.
    public var scCount: Int
    /// `dcCount` — number of third-party DC fast sessions.
    public var dcCount: Int
    /// `count` — total number of sessions (the Per Session divisor).
    public var count: Int

    public init(
        totalEnergy: Double,
        totalCost: Double,
        totalDuration: Double,
        homeCount: Int,
        scCount: Int,
        dcCount: Int,
        count: Int
    ) {
        self.totalEnergy = totalEnergy
        self.totalCost = totalCost
        self.totalDuration = totalDuration
        self.homeCount = homeCount
        self.scCount = scCount
        self.dcCount = dcCount
        self.count = count
    }
}

// MARK: - Tile value tone (web value text color)

/// The value-text color a tile carries, mapped from the web Tailwind classes
/// (`text-emerald-300` / `text-rose-300` / `text-amber-300` / `text-[var(--text-primary)]`)
/// to the theme-adaptive design tokens so light / dark / high-contrast all resolve correctly.
public enum QuickMetricTone: String, Sendable, Equatable, CaseIterable {
    case success
    case danger
    case warning
    case primary
}

// MARK: - Tile projection (web tile)

/// One projected metric tile (web `<div>` with a bold value `<p>` and a label `<p>`). The
/// `value` is a pre-formatted string rendered verbatim (a localized number, currency, unit, or
/// duration); `systemImage` is the optional leading glyph the three count tiles carry.
public struct QuickMetric: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let tone: QuickMetricTone
    /// The SF Symbol shown beside the label, or `nil` for the three derived tiles (web: only
    /// Home / Supercharger / DC Fast carry an icon).
    public let systemImage: String?
    /// Whether the value animates on change — the three count tiles use the web
    /// `<AnimatedNumber>` (native `.contentTransition(.numericText())`); the derived tiles do not.
    public let animatesValue: Bool

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        tone: QuickMetricTone,
        systemImage: String?,
        animatesValue: Bool = false
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.tone = tone
        self.systemImage = systemImage
        self.animatesValue = animatesValue
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source distinguishes content (`stats` present →
/// grid) vs empty (`stats` null → `EmptyState`); the loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring the parent list's lifecycle.
public enum QuickMetricsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the charging query, projected into a phase.
public enum QuickMetricsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so
/// cached metrics are clearly labeled while reconnecting / offline.
public enum QuickMetricsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Number / duration formatting (web `fmtNumber` / `formatDurationMinutes`)

/// Pure formatting helpers reproducing the web `lib/numberFormat.ts` (`safeNumber`,
/// `fmtNumber`, `fmtWithUnit`) and `lib/dateFormat.ts` (`formatDurationMinutes`) so every
/// platform shows identical strings. All pure + testable.
public enum QuickMetricsFormat {
    /// The em-dash the web `formatDurationMinutes` returns for an invalid duration (`FALLBACK`).
    public static let emDash = "—"

    /// The kWh unit symbol the web hardcodes for the Per Session tile (`fmtWithUnit(_, 'kWh')`).
    public static let kilowattHourSymbol = "kWh"

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of
    /// fraction digits, with the JS `toLocaleString` half-away-from-zero rounding and the
    /// `safeNumber` non-finite → 0 guard.
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

    /// Web `<Currency value={totalCost / 12} precision={0} />`: the user's currency symbol
    /// prefixed to the grouped amount. A non-finite amount yields the em-dash (the `Currency`
    /// fallback), with no symbol.
    public static func currency(
        _ value: Double,
        symbol: String,
        decimals: Int = 0,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        guard value.isFinite else { return emDash }
        return symbol + number(value, decimals: decimals, locale: locale)
    }

    /// Web `fmtWithUnit(value, 'kWh')`: the grouped number at the global decimal precision
    /// (default 2) followed by a space and the unit symbol.
    public static func withUnit(
        _ value: Double,
        unit: String,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        "\(number(value, decimals: decimals, locale: locale)) \(unit)"
    }

    /// Web `formatDurationMinutes(minutes)`: `'—'` for a non-finite or negative input, else
    /// `"{h}h {m}m"` (with the hours floored and the remaining minutes rounded half-away-from-
    /// zero) or `"{m}m"` when under an hour.
    public static func duration(minutes: Double) -> String {
        guard minutes.isFinite, minutes >= 0 else { return emDash }
        let hours = Int((minutes / 60).rounded(.down))
        let remainder = minutes.truncatingRemainder(dividingBy: 60)
        let mins = Int(remainder.rounded(.toNearestOrAwayFromZero))
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }
}

// MARK: - Projection (pure, web-parity)

/// The dependency-free projection from the cached `QuickMetricsStats` + the user's currency /
/// locale / precision preferences to the six view-ready tiles + the render phase. A faithful
/// port of the web component's read of `stats`.
public enum QuickMetricsProjection {
    /// Builds the six tiles in the exact web order. Returns an empty array when `stats` is nil
    /// (the web renders the `EmptyState` instead of the grid), which the phase resolves to
    /// `.empty`. The three count tiles + three derived tiles are built by small helpers so each
    /// stays focused.
    public static func metrics(
        from stats: QuickMetricsStats?,
        currencySymbol: String,
        locale: Locale = Locale(identifier: "en-US"),
        precision: Int = 2
    ) -> [QuickMetric] {
        guard let stats else { return [] }
        return countTiles(stats, locale: locale)
            + derivedTiles(stats, currencySymbol: currencySymbol, locale: locale, precision: precision)
    }

    /// The three Home / Supercharger / DC Fast count tiles (web `<AnimatedNumber>`, 0 dp, with
    /// the emerald / rose / amber value color + a glyph).
    private static func countTiles(_ stats: QuickMetricsStats, locale: Locale) -> [QuickMetric] {
        [
            QuickMetric(
                id: "home",
                labelKey: "charging.metrics.home",
                labelFallback: "Home",
                value: QuickMetricsFormat.count(stats.homeCount, locale: locale),
                tone: .success,
                systemImage: "house.fill",
                animatesValue: true
            ),
            QuickMetric(
                id: "supercharger",
                labelKey: "charging.metrics.supercharger",
                labelFallback: "Supercharger",
                value: QuickMetricsFormat.count(stats.scCount, locale: locale),
                tone: .danger,
                systemImage: "bolt.fill",
                animatesValue: true
            ),
            QuickMetric(
                id: "dcFast",
                labelKey: "charging.metrics.dcFast",
                labelFallback: "DC Fast",
                value: QuickMetricsFormat.count(stats.dcCount, locale: locale),
                tone: .warning,
                systemImage: "bolt.car.fill",
                animatesValue: true
            )
        ]
    }

    /// The three derived Total Time / Monthly Avg / Per Session tiles (web `formatDuration` /
    /// `<Currency precision=0>` / `fmtWithUnit(_, 'kWh')`, in the primary text color, no glyph).
    private static func derivedTiles(
        _ stats: QuickMetricsStats,
        currencySymbol: String,
        locale: Locale,
        precision: Int
    ) -> [QuickMetric] {
        let sessions = stats.count
        let perSessionEnergy = sessions > 0 ? stats.totalEnergy / Double(sessions) : 0
        return [
            QuickMetric(
                id: "totalTime",
                labelKey: "charging.metrics.totalTime",
                labelFallback: "Total Time",
                value: QuickMetricsFormat.duration(minutes: stats.totalDuration),
                tone: .primary,
                systemImage: nil
            ),
            QuickMetric(
                id: "monthlyAvg",
                labelKey: "charging.metrics.monthlyAvg",
                labelFallback: "Monthly Avg",
                value: QuickMetricsFormat.currency(stats.totalCost / 12, symbol: currencySymbol, locale: locale),
                tone: .primary,
                systemImage: nil
            ),
            QuickMetric(
                id: "perSession",
                labelKey: "charging.metrics.perSession",
                labelFallback: "Per Session",
                value: QuickMetricsFormat.withUnit(
                    perSessionEnergy,
                    unit: QuickMetricsFormat.kilowattHourSymbol,
                    decimals: precision,
                    locale: locale
                ),
                tone: .primary,
                systemImage: nil
            )
        ]
    }

    /// Resolves the render phase from the bound load status + whether stats are present (web
    /// `stats ? grid : EmptyState`). Cached stats stay `.content` through a failure so the
    /// freshness chip / banner flag staleness rather than blanking the strip.
    public static func resolvePhase(_ status: QuickMetricsLoadStatus, hasStats: Bool) -> QuickMetricsPhase {
        switch status {
        case .loading:
            hasStats ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasStats ? .content : .empty
        case let .failed(message):
            hasStats ? .content : .error(message)
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-
/// free core so it is reachable from the projection's unit tests.
public enum QuickMetricsSurface {
    public static let slug = "QuickMetrics"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like
/// the view's P1/S10 facade.
public enum QuickMetricsAccessibility {
    /// The section-level summary: the strip label followed by each tile's "{label} {value}",
    /// or the friendly empty message when there are no metrics.
    public static func sectionSummary(
        metrics: [QuickMetric],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("charging.metrics.sectionLabel", "Charging metrics")
        guard !metrics.isEmpty else {
            let none = localize("charging.noMetrics", "No charging metrics available yet")
            return "\(title): \(none)"
        }
        let parts = metrics.map { "\(localize($0.labelKey, $0.labelFallback)) \($0.value)" }
        return "\(title): " + parts.joined(separator: ", ")
    }

    /// One tile's VoiceOver value: "{label}: {value}".
    public static func tileLabel(
        _ metric: QuickMetric,
        localize: (String, String) -> String
    ) -> String {
        "\(localize(metric.labelKey, metric.labelFallback)): \(metric.value)"
    }
}
