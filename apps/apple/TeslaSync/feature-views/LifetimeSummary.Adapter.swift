//
//  LifetimeSummary.Adapter.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  The testable projection core for the cost-analysis Lifetime Summary section — the
//  SwiftUI parity of features/charging/components/cost-analysis/LifetimeSummary.tsx
//  plus the formatters it leans on (`fmtNumber`, `fmtInt`, `fmtWithUnit`, and the
//  `useFormatting` `formatCurrency`). Everything here is pure + dependency-free (no
//  store, no bundle, no rendered view) so the number / currency formatting and the
//  seven lifetime-metric tile values are all unit tested in isolation.
//
//  Units note: the web leaf is presentational — it renders the `coreStats` /
//  `lifetimeMetrics` its parent (`useCostAnalysisData`) already computed. This adapter
//  mirrors that: the cached value types carry the parent's web-shaped fields verbatim
//  (`totalEnergy` is the kWh the parent converted; `freeEnergy` is passed through to
//  the "kWh" wrapper exactly as the web component does). No new SI-suffixed model
//  field is introduced — the display unit lives in the i18n facade at the render edge.
//

import Foundation

// MARK: - Section data (the CoreStats / LifetimeMetrics slices this surface reads)

/// The slice of the parent `CoreStats` the Lifetime Summary reads (web reads
/// `totalCost`, `totalEnergy`, `count`). The cost analysis stats are computed
/// client-side from the charging-sessions query, so this is a plain cached value
/// type — there is no dedicated endpoint and therefore no wire decode here.
public struct LifetimeCoreStats: Equatable, Sendable {
    /// Sum of every session cost over the selected range (currency major units).
    public let totalCost: Double
    /// Total energy added over the range, in kWh — already converted from SI by the
    /// parent hook (web `convertEnergyFromSI(Σ total_energy_added_wh, 'kWh')`).
    public let totalEnergy: Double
    /// Number of charging sessions in the range (web `sessions.length`).
    public let count: Int

    public init(totalCost: Double, totalEnergy: Double, count: Int) {
        self.totalCost = totalCost
        self.totalEnergy = totalEnergy
        self.count = count
    }
}

/// The slice of the parent `LifetimeMetrics` the Lifetime Summary reads (web reads
/// `avgSessionCost`, `avgSessionEnergy`, `avgDuration`, `freeCount`, `freeEnergy`).
public struct LifetimeMetrics: Equatable, Sendable {
    /// Mean cost per session (web `totalCost / count`).
    public let avgSessionCost: Double
    /// Mean energy per session, in kWh (web `totalEnergy / count`).
    public let avgSessionEnergy: Double
    /// Mean session duration, in minutes (web `totalDuration / count`).
    public let avgDuration: Double
    /// Number of zero-cost ("free") sessions (web `cost_decimal` falsy / 0).
    public let freeCount: Int
    /// Energy summed across the free sessions, rendered through the "kWh" wrapper
    /// exactly as the web component does (web `fmtWithUnit(freeEnergy, 'kWh', 1)`).
    public let freeEnergy: Double

    public init(
        avgSessionCost: Double,
        avgSessionEnergy: Double,
        avgDuration: Double,
        freeCount: Int,
        freeEnergy: Double
    ) {
        self.avgSessionCost = avgSessionCost
        self.avgSessionEnergy = avgSessionEnergy
        self.avgDuration = avgDuration
        self.freeCount = freeCount
        self.freeEnergy = freeEnergy
    }
}

// MARK: - Formatting preferences (web `useFormatting` settings slice)

/// The display-boundary formatting preferences the web `useFormatting` derives from
/// `useSettings` — the currency symbol (web `settings.currency_symbol`, default `$`)
/// and the locale the grouped number formatter uses. The view binds this through the
/// state holder so the symbol / locale track the user's settings; the defaults mirror
/// the web globals (`$`, `en-US`).
public struct LifetimeFormatting: Equatable, Sendable {
    public let currencySymbol: String
    public let localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en-US") {
        let trimmed = currencySymbol.trimmingCharacters(in: .whitespaces)
        self.currencySymbol = trimmed.isEmpty ? "$" : currencySymbol
        self.localeIdentifier = localeIdentifier.trimmingCharacters(in: .whitespaces).isEmpty
            ? "en-US"
            : localeIdentifier
    }

    var locale: Locale {
        Locale(identifier: localeIdentifier)
    }
}

// MARK: - Number formatting (web `fmtNumber` / `fmtInt` / `formatCurrency`)

/// Locale-aware number formatter mirroring the web `fmtNumber(v, decimals, locale)`:
/// grouped decimal with a fixed fraction width, with nullish / non-finite input
/// coerced to zero (web `safeNumber`). The web global defaults (precision 2,
/// `en-US`) are reproduced; both are overridable to track `useSettings` at the
/// display boundary. `int` is the `fmtInt` shortcut; `currency` is the `useFormatting`
/// `formatCurrency` (`"\(symbol)\(fmtNumber(amount, decimals))"`).
public enum LifetimeNumberFormat {
    public static func number(
        _ value: Double,
        decimals: Int = 2,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }

    /// Web `fmtInt(v)` — grouped integer (zero fraction digits).
    public static func int(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Web `useFormatting().formatCurrency(amount, decimals)` —
    /// the symbol prefixed directly onto the grouped number (no separating space).
    public static func currency(
        _ amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        "\(symbol)\(number(amount, decimals: decimals, locale: locale))"
    }
}

// MARK: - Metric kind (the seven web `LifetimeMetric` tiles)

/// Which lifetime metric a tile represents. The `allCases` order is the exact web
/// render order, so the data body lays the tiles out identically.
public enum LifetimeMetricKind: String, Sendable, Equatable, CaseIterable {
    case totalSpent
    case totalEnergy
    case totalSessions
    case avgSessionCost
    case avgEnergy
    case avgDuration
    case freeSessions
}

// MARK: - Tile projection (web `LifetimeMetric`)

/// The view-ready projection of one `LifetimeMetric`: the kind plus the already
/// number-formatted value pieces. `primaryText` is the main figure (a currency string,
/// a grouped number, or a count); `secondaryText` carries the free-sessions energy
/// figure. The unit words (`kWh` / `min`) and the free-sessions `"{{count}} ({{energy}})"`
/// wrapper stay in the view so they resolve through the i18n facade.
public struct LifetimeMetricProjection: Identifiable, Equatable, Sendable {
    public var id: LifetimeMetricKind {
        kind
    }

    public let kind: LifetimeMetricKind
    public let primaryText: String
    public let secondaryText: String?

    public init(kind: LifetimeMetricKind, primaryText: String, secondaryText: String? = nil) {
        self.kind = kind
        self.primaryText = primaryText
        self.secondaryText = secondaryText
    }
}

// MARK: - Tile builder (web LifetimeSummary composition)

/// Pure builder that turns the cached `CoreStats` + `LifetimeMetrics` into the seven
/// tile projections, reproducing the exact web expressions. Unit tested directly.
public enum LifetimeMetricsBuilder {
    /// Reproduces the web tile value expressions, in render order:
    /// `formatCurrency(totalCost, 2)`, `fmtWithUnit(totalEnergy, 'kWh', 1)`,
    /// `fmtInt(count)`, `formatCurrency(avgSessionCost, 2)`,
    /// `fmtWithUnit(avgSessionEnergy, 'kWh', 1)`, `fmtNumber(avgDuration, 0)`,
    /// and `fmtInt(freeCount)` + `fmtWithUnit(freeEnergy, 'kWh', 1)`.
    public static func tiles(
        coreStats: LifetimeCoreStats,
        metrics: LifetimeMetrics,
        formatting: LifetimeFormatting = LifetimeFormatting()
    ) -> [LifetimeMetricProjection] {
        let locale = formatting.locale
        let symbol = formatting.currencySymbol
        return [
            LifetimeMetricProjection(
                kind: .totalSpent,
                primaryText: LifetimeNumberFormat.currency(
                    coreStats.totalCost, symbol: symbol, decimals: 2, locale: locale
                )
            ),
            LifetimeMetricProjection(
                kind: .totalEnergy,
                primaryText: LifetimeNumberFormat.number(coreStats.totalEnergy, decimals: 1, locale: locale)
            ),
            LifetimeMetricProjection(
                kind: .totalSessions,
                primaryText: LifetimeNumberFormat.int(Double(coreStats.count), locale: locale)
            ),
            LifetimeMetricProjection(
                kind: .avgSessionCost,
                primaryText: LifetimeNumberFormat.currency(
                    metrics.avgSessionCost, symbol: symbol, decimals: 2, locale: locale
                )
            ),
            LifetimeMetricProjection(
                kind: .avgEnergy,
                primaryText: LifetimeNumberFormat.number(metrics.avgSessionEnergy, decimals: 1, locale: locale)
            ),
            LifetimeMetricProjection(
                kind: .avgDuration,
                primaryText: LifetimeNumberFormat.number(metrics.avgDuration, decimals: 0, locale: locale)
            ),
            LifetimeMetricProjection(
                kind: .freeSessions,
                primaryText: LifetimeNumberFormat.int(Double(metrics.freeCount), locale: locale),
                secondaryText: LifetimeNumberFormat.number(metrics.freeEnergy, decimals: 1, locale: locale)
            )
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a labelled tile from its already-resolved
/// display strings. Pure + public so the spoken content is asserted without rendering
/// the view; empty fragments are dropped so the phrase never reads a stray comma.
public enum LifetimeSummaryAccessibility {
    public static func tileSummary(label: String, value: String) -> String {
        [label, value]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
