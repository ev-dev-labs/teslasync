//
//  ChargingSection.Adapter.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  The testable projection core for the weekly-digest "Charging" section — the
//  faithful port of
//  features/analytics/components/weekly-digest/ChargingSection.tsx. Everything here
//  is pure and dependency-free (Foundation only) so it can be unit-tested without a
//  bundle or a rendered view.
//
//  Web parity notes:
//    • The web component takes `metrics: DigestMetrics` + `dailyEnergyData:
//      DailyEnergyEntry[]` (`{ day, energy }`) and renders a daily-energy bar chart,
//      a four-tile stat row (Sessions / Total Energy Added / Avg Charge Rate / Total
//      Cost), and an "Energy vs. Last Week" badge.
//    • The cost tile uses `useFormatting().formatCurrency(value, 2)` — a currency
//      symbol prefixed to `fmtNumber(value, 2)`; the energy/rate tiles use
//      `fmtNumber(value, 1)` + a "kWh"/"kW" unit; Sessions uses `fmtInt`.
//    • The badge variant is `chargeEnergyAdded >= prevChargeEnergy ? 'success' :
//      'warning'` and its text is `pctChange(...)%` when `prevChargeEnergy > 0`,
//      else the em-dash sentinel.
//

import Foundation

// MARK: - Units (locale-invariant SI display symbols)

/// The unit symbols the web renders verbatim next to the energy/rate tiles. They
/// are scientific symbols (not translatable prose), kept as named constants so the
/// projection and the rendered tooltip/axis share one source of truth.
public enum ChargingUnits {
    public static let kwh = "kWh"
    public static let kw = "kW"
}

// MARK: - Daily energy entry (web `DailyEnergyEntry`)

/// One day's added energy — the parity of the web `{ day, energy }` chart datum.
public struct ChargingDailyEnergy: Sendable, Equatable {
    /// The day label the web uses as the bar's x value (e.g. "Mon").
    public var day: String
    /// Energy added that day, in kWh (web `energy`).
    public var energy: Double

    public init(day: String, energy: Double) {
        self.day = day
        self.energy = energy
    }
}

// MARK: - Charging metrics (the `DigestMetrics` subset this section reads)

/// The slice of the web `DigestMetrics` the Charging section consumes. Held as its
/// own value so the projection + tests never need the whole digest model.
public struct ChargingMetrics: Sendable, Equatable {
    /// Completed charging sessions in the window (web `chargingSessionCount`).
    public var sessionCount: Int
    /// Total energy added in the window, kWh (web `chargeEnergyAdded`).
    public var energyAddedKwh: Double
    /// Average charge rate, kW (web `avgChargeRate`).
    public var avgChargeRateKw: Double
    /// Total charging cost in the window (web `chargingCost`).
    public var cost: Double
    /// Previous window's energy added, kWh (web `prevChargeEnergy`).
    public var prevEnergyKwh: Double

    public init(
        sessionCount: Int,
        energyAddedKwh: Double,
        avgChargeRateKw: Double,
        cost: Double,
        prevEnergyKwh: Double
    ) {
        self.sessionCount = sessionCount
        self.energyAddedKwh = energyAddedKwh
        self.avgChargeRateKw = avgChargeRateKw
        self.cost = cost
        self.prevEnergyKwh = prevEnergyKwh
    }
}

// MARK: - Chart bar (one projected column)

/// One projected bar: a stable index, the day label, and the clamped energy value.
public struct ChargingEnergyBar: Sendable, Equatable, Identifiable {
    /// Stable position-based identity (days repeat across weeks but not within one).
    public var index: Int
    /// The bar's x-axis label (web `day`).
    public var day: String
    /// The bar height in kWh, clamped to be non-negative + finite.
    public var energy: Double

    public var id: Int {
        index
    }

    public init(index: Int, day: String, energy: Double) {
        self.index = index
        self.day = day
        self.energy = energy
    }
}

// MARK: - Stat tile (web `MiniStat`)

/// The four stat tiles the web renders, in source order. Each carries the web i18n
/// key + English fallback for its label; the formatted value is supplied by the
/// projection so the kind stays presentation-free.
public enum ChargingStatKind: String, Sendable, CaseIterable, Identifiable {
    case sessions
    case totalEnergy
    case avgRate
    case totalCost

    public var id: String {
        rawValue
    }

    /// The i18n key the label resolves (web `t(key, default)`).
    public var localizationKey: String {
        switch self {
        case .sessions: "analytics.weeklyDigest.sessions"
        case .totalEnergy: "analytics.weeklyDigest.totalEnergyAdded"
        case .avgRate: "analytics.weeklyDigest.avgChargeRate"
        case .totalCost: "analytics.weeklyDigest.totalCost"
        }
    }

    /// The web English fallback for `localizationKey`.
    public var fallback: String {
        switch self {
        case .sessions: "Sessions"
        case .totalEnergy: "Total Energy Added"
        case .avgRate: "Avg Charge Rate"
        case .totalCost: "Total Cost"
        }
    }
}

/// A resolved stat tile — its kind plus the already-formatted display value.
public struct ChargingStat: Sendable, Equatable, Identifiable {
    public var kind: ChargingStatKind
    public var value: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: ChargingStatKind, value: String) {
        self.kind = kind
        self.value = value
    }
}

// MARK: - Week-over-week trend (web `Badge`)

/// The badge tone — the parity of the web `success` / `warning` variants.
public enum ChargingTrendTone: Sendable, Equatable {
    case positive
    case negative
}

/// The resolved "Energy vs. Last Week" badge: its display text + tone.
public struct ChargingTrend: Sendable, Equatable {
    /// The badge label — `"<pct>%"` or the em-dash sentinel.
    public var value: String
    /// The badge tone (web variant).
    public var tone: ChargingTrendTone

    public init(value: String, tone: ChargingTrendTone) {
        self.value = value
        self.tone = tone
    }
}

// MARK: - Render phase + load/connection envelope

/// What the surface should render. The web component is always "content" (its
/// parent `WeeklyDigestPage` owns loading / error / empty); the native surface
/// reproduces that whole lifecycle so every prompt state renders here.
public enum ChargingPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the digest query.
public enum ChargingLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + cached-data banner.
public enum ChargingConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Formatting (web `fmtNumber` / `fmtInt` / `formatCurrency`)

/// The currency formatting inputs the web reads from `useFormatting` /
/// `useSettings`. Only the symbol matters here — the section always passes an
/// explicit fraction-digit count (web `formatCurrency(value, 2)`).
public struct ChargingFormatting: Sendable, Equatable {
    /// The currency symbol, defaulting to "$" (web `currency_symbol || '$'`).
    public var currencySymbol: String

    public init(currencySymbol: String = "$") {
        let trimmed = currencySymbol.trimmingCharacters(in: .whitespaces)
        self.currencySymbol = trimmed.isEmpty ? "$" : trimmed
    }
}

/// Locale-aware number formatting that mirrors the web `numberFormat` helpers:
/// `toLocaleString(locale, { min/maxFractionDigits })` with grouping separators.
public enum ChargingFormat {
    /// Web `fmtNumber(value, decimals, locale)` — grouped, fixed-fraction, half-up.
    public static func number(_ value: Double, fractionDigits: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        let digits = max(0, fractionDigits)
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.usesGroupingSeparator = true
        formatter.roundingMode = .halfUp
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? "\(safe)"
    }

    /// Web `fmtInt(value)` — grouped integer (zero fraction digits).
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, fractionDigits: 0, locale: locale)
    }

    /// Web `formatCurrency(amount, decimals)` — symbol prefixed to `fmtNumber`.
    public static func currency(
        _ amount: Double,
        fractionDigits: Int,
        formatting: ChargingFormatting,
        locale: Locale = .current
    ) -> String {
        formatting.currencySymbol + number(amount, fractionDigits: fractionDigits, locale: locale)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw metrics + daily energy to chart-ready
/// bars, formatted stat tiles, and the week-over-week trend.
public enum ChargingProjection {
    /// Maps daily-energy data to chart bars in source order, clamping each value to
    /// a finite, non-negative height.
    public static func bars(from entries: [ChargingDailyEnergy]) -> [ChargingEnergyBar] {
        entries.enumerated().map { index, entry in
            let energy = entry.energy.isFinite ? max(0, entry.energy) : 0
            return ChargingEnergyBar(index: index, day: entry.day, energy: energy)
        }
    }

    /// Web `pctChange(current, previous)`: percentage delta, guarding divide-by-zero.
    public static func pctChange(current: Double, previous: Double) -> Double {
        if previous == 0 {
            return current > 0 ? 100 : 0
        }
        return ((current - previous) / abs(previous)) * 100
    }

    /// The four formatted stat tiles, in web source order.
    public static func stats(
        from metrics: ChargingMetrics,
        formatting: ChargingFormatting,
        locale: Locale = .current
    ) -> [ChargingStat] {
        let energy = ChargingFormat.number(metrics.energyAddedKwh, fractionDigits: 1, locale: locale)
        let rate = ChargingFormat.number(metrics.avgChargeRateKw, fractionDigits: 1, locale: locale)
        return [
            ChargingStat(kind: .sessions, value: ChargingFormat.int(Double(metrics.sessionCount), locale: locale)),
            ChargingStat(kind: .totalEnergy, value: "\(energy) \(ChargingUnits.kwh)"),
            ChargingStat(kind: .avgRate, value: "\(rate) \(ChargingUnits.kw)"),
            ChargingStat(
                kind: .totalCost,
                value: ChargingFormat.currency(metrics.cost, fractionDigits: 2, formatting: formatting, locale: locale)
            )
        ]
    }

    /// The week-over-week badge: tone from the `>=` comparison and text from
    /// `pctChange` (or the em-dash sentinel when there's no prior baseline).
    public static func trend(from metrics: ChargingMetrics, locale: Locale = .current) -> ChargingTrend {
        let tone: ChargingTrendTone = metrics.energyAddedKwh >= metrics.prevEnergyKwh ? .positive : .negative
        guard metrics.prevEnergyKwh > 0 else {
            return ChargingTrend(value: "—", tone: tone)
        }
        let pct = pctChange(current: metrics.energyAddedKwh, previous: metrics.prevEnergyKwh)
        return ChargingTrend(value: "\(ChargingFormat.number(pct, fractionDigits: 1, locale: locale))%", tone: tone)
    }

    /// Total energy across all bars (chart summary / a11y).
    public static func totalEnergy(_ bars: [ChargingEnergyBar]) -> Double {
        bars.reduce(0) { $0 + $1.energy }
    }

    /// Whether the section has anything to show — any daily bar, or any non-zero
    /// charging metric. Drives the loaded → content/empty split.
    public static func hasContent(metrics: ChargingMetrics?, bars: [ChargingEnergyBar]) -> Bool {
        guard let metrics else { return !bars.isEmpty }
        return !bars.isEmpty
            || metrics.sessionCount > 0
            || metrics.energyAddedKwh > 0
            || metrics.cost > 0
    }

    /// Resolves the render phase from the bound load status + whether the section
    /// has content (web parent's `isLoading` / error wiring).
    public static func resolvePhase(_ status: ChargingLoadStatus, hasContent: Bool) -> ChargingPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasContent ? .content : .empty
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ChargingSurface {
    public static let slug = "ChargingSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum ChargingAccessibility {
    /// The section-level summary: the "Charging" title + each stat label/value.
    public static func sectionSummary(
        stats: [ChargingStat],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.weeklyDigest.chargingSection", "Charging")
        guard !stats.isEmpty else { return title }
        let parts = stats.map { "\(localize($0.kind.localizationKey, $0.kind.fallback)) \($0.value)" }
        return "\(title): " + parts.joined(separator: ", ")
    }

    /// The chart-level summary: the chart title + day count + total energy.
    public static func chartSummary(
        bars: [ChargingEnergyBar],
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("analytics.weeklyDigest.dailyEnergyAdded", "Daily Energy Added (kWh)")
        guard !bars.isEmpty else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let total = ChargingFormat.number(ChargingProjection.totalEnergy(bars), fractionDigits: 1, locale: locale)
        let days = localize("analytics.weeklyDigest.charging.days", "days")
        let energyAdded = localize("analytics.weeklyDigest.energyAdded", "Energy Added")
        return "\(title): \(bars.count) \(days), \(total) \(ChargingUnits.kwh) \(energyAdded)"
    }

    /// One bar's VoiceOver value: "{day}: {energy} kWh Energy Added".
    public static func barLabel(
        _ bar: ChargingEnergyBar,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let energyAdded = localize("analytics.weeklyDigest.energyAdded", "Energy Added")
        let value = ChargingFormat.number(bar.energy, fractionDigits: 1, locale: locale)
        return "\(bar.day): \(value) \(ChargingUnits.kwh) \(energyAdded)"
    }
}
