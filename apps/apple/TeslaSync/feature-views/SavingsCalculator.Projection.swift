//
//  SavingsCalculator.Projection.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  The comparison → render-model adapter (a faithful port of the web source's
//  formatting: the grouped 2-dp `${fmtNumber(x, 2)}` card amounts, the 3-dp
//  `${fmtNumber(costPerMile, 3)}/${distanceUnit}` per-distance captions, and the
//  0-dp `~${fmtNumber(yearlySavings, 0)}` annual note) plus the per-state
//  presentation resolver. Pure value logic — no SwiftUI, no networking — so every
//  formatted string and every render branch is unit-testable.
//

import Foundation

// MARK: - Projection output value type

/// The fully-resolved, pre-formatted render model for the four comparison cards.
/// Every string is formatted here so the view renders it verbatim; the cards map
/// 1:1 onto the web grid (Gas Cost / EV Cost / Total Savings / Monthly Savings).
public struct SavingsCalculatorProjection: Equatable, Sendable {
    /// Gas-equivalent cost, web `${fmtNumber(gasCost, 2)}`.
    public let gasCostText: String
    /// Gas cost per display unit, web `${fmtNumber(costPerMileGas, 3)}/${unit}`.
    public let gasPerDistanceText: String
    /// EV cost the card surfaces (web uses `actualCost`), `${fmtNumber(_, 2)}`.
    public let evCostText: String
    /// Charging spend per display unit, web `${fmtNumber(costPerMileEV, 3)}/${unit}`.
    public let evPerDistanceText: String
    /// Total savings, web `${fmtNumber(savings, 2)}`.
    public let totalSavingsText: String
    /// Monthly savings, web `${fmtNumber(monthlySavings, 2)}`.
    public let monthlySavingsText: String
    /// Annualized note, web `~${fmtNumber(yearlySavings, 0)}` (whole dollars).
    public let yearlySavingsText: String
    /// The display distance unit echoed for the VoiceOver summary.
    public let distanceUnit: String
}

// MARK: - Projection build (comparison → projection)

public extension SavingsCalculatorProjection {
    /// Builds the projection from a computed comparison, reproducing the web card
    /// formatting exactly. Note the EV card surfaces the real charging spend
    /// (`actualCost`), matching the web source.
    static func make(
        from comparison: GasComparison,
        distanceUnit: String,
        locale: Locale = .current
    ) -> SavingsCalculatorProjection {
        SavingsCalculatorProjection(
            gasCostText: currency(comparison.gasCost, decimals: 2, locale: locale),
            gasPerDistanceText: perDistance(comparison.costPerDistanceGas, unit: distanceUnit, locale: locale),
            evCostText: currency(comparison.actualCost, decimals: 2, locale: locale),
            evPerDistanceText: perDistance(comparison.costPerDistanceEV, unit: distanceUnit, locale: locale),
            totalSavingsText: currency(comparison.savings, decimals: 2, locale: locale),
            monthlySavingsText: currency(comparison.monthlySavings, decimals: 2, locale: locale),
            yearlySavingsText: "~" + currency(comparison.yearlySavings, decimals: 0, locale: locale),
            distanceUnit: distanceUnit
        )
    }

    /// Convenience: project straight from aggregates + assumptions (the path the
    /// view uses, where the comparison is recomputed on every edit).
    static func make(
        data: SavingsCalculatorData,
        assumptions: SavingsCalculatorAssumptions,
        locale: Locale = .current
    ) -> SavingsCalculatorProjection {
        make(
            from: GasComparison.make(data: data, assumptions: assumptions),
            distanceUnit: data.distanceUnit,
            locale: locale
        )
    }
}

// MARK: - Formatting helpers (web `fmtNumber` + `$` prefix)

public extension SavingsCalculatorProjection {
    /// Grouped, locale-aware fixed-decimal number — the web `fmtNumber(v, d)`
    /// over `toLocaleString({ min/maxFractionDigits: d })`. Non-finite values
    /// collapse to `0` (web `safeNumber`).
    static func grouped(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// `$`-prefixed grouped amount — the web card values `${fmtNumber(v, d)}`.
    static func currency(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        "$" + grouped(value, decimals: decimals, locale: locale)
    }

    /// Dollars-per-distance caption (e.g. `$0.123/mi`) — the web subtext
    /// `${fmtNumber(costPerMile, 3)}/${distanceUnit}`.
    static func perDistance(_ value: Double, unit: String, locale: Locale = .current) -> String {
        currency(value, decimals: 3, locale: locale) + "/" + unit
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the panel's status accessory (native contract).
public enum SavingsCalculatorFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive state of the *comparison region* — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content).
/// The web comparison column is either the four-card grid or the "Not enough data
/// for comparison" message; this superset adds the prompt's loading + stale +
/// offline + error chrome around that same composition. The assumptions form
/// renders in every state, so the surface is never blank.
public enum SavingsCalculatorPresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(SavingsCalculatorProjection, freshness: SavingsCalculatorFreshness, refreshing: Bool)
}

public extension SavingsCalculatorPresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) + the live
    /// assumptions to a render-ready presentation. Any cached aggregates stay
    /// visible behind a refresh/error; a resolved-but-empty window becomes the
    /// web "Not enough data for comparison" empty state (never a blank region).
    static func resolve(
        state: SavingsCalculatorLoadState<SavingsCalculatorData>,
        assumptions: SavingsCalculatorAssumptions,
        locale: Locale = .current
    ) -> SavingsCalculatorPresentation {
        func project(_ data: SavingsCalculatorData) -> SavingsCalculatorProjection {
            SavingsCalculatorProjection.make(data: data, assumptions: assumptions, locale: locale)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(data, stale):
            return .content(project(data), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, project: project)
        }
    }

    private static func resolveFailure(
        _ error: SavingsCalculatorError,
        cached: SavingsCalculatorData?,
        stale: Bool,
        project: (SavingsCalculatorData) -> SavingsCalculatorProjection
    ) -> SavingsCalculatorPresentation {
        if error == .offline {
            guard let cached else { return .offlineNoData }
            return .content(project(cached), freshness: .offline, refreshing: false)
        }
        if let cached {
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
        }
        return .error(retryable: error.isRetryable)
    }
}
