//
//  SavingsSlide.Projection.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's render
//  math: the `gasCostEquiv = gas_savings + total_charging_cost`, the grouped
//  `<AnimatedNumber prefix="$">` hero, the un-grouped `$Math.round(...)` bar
//  labels, the `round(tcc/equiv*100)%` electric bar width, and the
//  `round(gas_savings/5)` cups-of-coffee note) plus the per-state presentation
//  resolver. Pure value logic — no SwiftUI, no networking — so every render
//  branch is unit-testable.
//

import Foundation

// MARK: - Projection output value type

/// The fully-resolved, localized render model for the loaded slide. Every string
/// is pre-formatted so the view renders verbatim; the raw `savingsValue` is kept
/// for the hero count-up's animation target.
public struct SavingsSlideProjection: Equatable, Sendable {
    /// Grouped hero amount, web `<AnimatedNumber value={gas_savings} prefix="$">`.
    public let savingsText: String
    /// The raw savings the hero counts up to (web `AnimatedNumber` target).
    public let savingsValue: Double
    /// Un-grouped gas-equivalent cost, web `${Math.round(gasCostEquiv)}`.
    public let gasCostText: String
    /// Un-grouped electric cost, web `${Math.round(total_charging_cost)}`.
    public let electricCostText: String
    /// Electric bar fill fraction (0…1), web width `round(tcc/equiv*100)%`.
    public let electricFraction: Double
    /// Cups-of-coffee count, web `Math.round(gas_savings / 5)`.
    public let cupsOfCoffee: Int
    /// Localized note, web `yearReview.savingsNote` ("That's N cups of coffee!").
    public let coffeeNote: String
}

// MARK: - Projection build (cached → projection)

public extension SavingsSlideProjection {
    /// Builds the projection from the cached savings, reproducing the web render
    /// math exactly: the grouped hero amount vs. the un-grouped rounded bar
    /// labels, and the electric bar width as an integer percentage of the gas
    /// equivalent (guarded to 0 when the gas equivalent is non-positive).
    static func make(
        from savings: YearReviewSavings,
        locale: Locale = .current
    ) -> SavingsSlideProjection {
        let gasCostEquiv = savings.gasSavings + savings.totalChargingCost
        let cups = Int((savings.gasSavings / 5).rounded(.toNearestOrAwayFromZero))
        return SavingsSlideProjection(
            savingsText: heroCurrency(savings.gasSavings, locale: locale),
            savingsValue: savings.gasSavings,
            gasCostText: plainCurrency(gasCostEquiv),
            electricCostText: plainCurrency(savings.totalChargingCost),
            electricFraction: electricFraction(charging: savings.totalChargingCost, gasEquivalent: gasCostEquiv),
            cupsOfCoffee: cups,
            coffeeNote: coffeeNote(cups: cups, locale: locale)
        )
    }
}

// MARK: - Formatting helpers (web `fmtNumber` / `Math.round` / `t(savingsNote)`)

public extension SavingsSlideProjection {
    /// Grouped, locale-aware whole-dollar amount with the web `$` prefix — the
    /// web hero `<AnimatedNumber prefix="$" decimals=0>` over `fmtNumber`.
    static func heroCurrency(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        let rounded = value.rounded(.toNearestOrAwayFromZero)
        let number = formatter.string(from: NSNumber(value: rounded)) ?? "0"
        return "$" + number
    }

    /// Un-grouped, rounded whole-dollar amount with the `$` prefix — the web bar
    /// labels `${Math.round(...)}` (no thousands separators, matching the source).
    static func plainCurrency(_ value: Double) -> String {
        "$" + String(Int(value.rounded(.toNearestOrAwayFromZero)))
    }

    /// The electric bar fill fraction (0…1). Web computes the bar width as
    /// `gasCostEquiv > 0 ? round(tcc / equiv * 100)% : 0%`; this returns that same
    /// integer percentage as a clamped fraction so the native bar matches pixel-
    /// for-pixel.
    static func electricFraction(charging: Double, gasEquivalent: Double) -> Double {
        guard gasEquivalent > 0 else { return 0 }
        let percent = (charging / gasEquivalent * 100).rounded(.toNearestOrAwayFromZero)
        let clamped = min(max(percent, 0), 100)
        return clamped / 100
    }

    /// The localized cups-of-coffee note (web `t('yearReview.savingsNote', {
    /// cupsOfCoffee, defaultValue })`). The count is interpolated through a
    /// localized `%d` format so translators control word order.
    static func coffeeNote(cups: Int, locale: Locale = .current) -> String {
        let format = SavingsSlideStrings.string("yearReview.savingsNote", "That's %d cups of coffee!")
        return String(format: format, locale: locale, cups)
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the status accessory (web freshness indicator).
public enum SavingsSlideFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content).
/// The web slide is purely presentational (it is only mounted once `data` is
/// resolved); this superset adds the prompt's loading + empty + stale + offline +
/// error chrome around that same content composition.
public enum SavingsSlidePresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(SavingsSlideProjection, freshness: SavingsSlideFreshness, refreshing: Bool)
}

public extension SavingsSlidePresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a
    /// render-ready presentation. Keeps any cached savings visible behind a
    /// refresh/error; a resolved-but-absent review becomes the friendly empty
    /// state (never a blank slide).
    static func resolve(
        state: SavingsSlideLoadState<YearReviewSavings>,
        locale: Locale = .current
    ) -> SavingsSlidePresentation {
        func project(_ savings: YearReviewSavings) -> SavingsSlideProjection {
            SavingsSlideProjection.make(from: savings, locale: locale)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(savings, stale):
            return .content(project(savings), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, project: project)
        }
    }

    private static func resolveFailure(
        _ error: SavingsSlideError,
        cached: YearReviewSavings?,
        stale: Bool,
        project: (YearReviewSavings) -> SavingsSlideProjection
    ) -> SavingsSlidePresentation {
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
