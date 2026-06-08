//
//  TimeToChargeSection.Models.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  The domain value types ported from the web source's data contracts plus the
//  view-state envelope the surface switches over. Pure Foundation — no SwiftUI,
//  no shared xcframework — so the file host-compiles and the projection that
//  consumes these types is unit-testable in isolation.
//

import Foundation

// MARK: - Domain input (web `ChargingSession` subset the section reads)

/// One charging session, narrowed to the fields the time-to-charge `useMemo`
/// consumes (web `ChargingSession`). Timestamps are kept as the raw ISO strings
/// the API returns so the year grouping matches the web `started_at.slice(0, 4)`
/// and the duration math parses exactly as the source does. Energy/power values
/// are SI (Wh, W) per the Phase-48 canonical contract; conversion to a display
/// unit happens at the projection edge, never on disk.
public struct ChargingSessionSummary: Identifiable, Equatable, Sendable {
    public let id: Int
    public let startedAt: String
    public let endedAt: String?
    public let startSocPct: Double
    public let endSocPct: Double?
    public let totalEnergyAddedWh: Double
    public let peakPowerW: Double?
    public let chargerType: String?

    public init(
        id: Int,
        startedAt: String,
        endedAt: String?,
        startSocPct: Double,
        endSocPct: Double?,
        totalEnergyAddedWh: Double,
        peakPowerW: Double?,
        chargerType: String?
    ) {
        self.id = id
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.peakPowerW = peakPowerW
        self.chargerType = chargerType
    }
}

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared facade error shape
/// so the production binding is a 1:1 map (offline keeps cached sessions; decode
/// is non-retryable; network/api are retryable — web `QueryError` retry).
public enum TimeToChargeError: Equatable, Sendable {
    case offline
    case network(message: String)
    case decode(message: String)
    case api(status: Int, code: String?, body: String?)

    /// Whether a retry affordance should be offered (web `QueryError` retry).
    public var isRetryable: Bool {
        switch self {
        case .offline, .network, .api: true
        case .decode: false
        }
    }
}

// MARK: - Load state (cache-then-network + stale flag, ADR-013)

/// Native projection of the shared core's `Resource<T>` lifecycle, carrying the
/// last cached value to keep on screen behind a refresh/error and the ADR-013
/// `stale` flag. Mirrors the facade `LoadableState` without importing the shared
/// framework, so the surface host-compiles and every branch is unit-testable.
public enum TimeToChargeLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(TimeToChargeError, cached: Value?, stale: Bool)
}

extension TimeToChargeLoadState: Equatable where Value: Equatable {}

// MARK: - Metrics value types (web `TimeToChargeMetrics`)

/// A charge-rate reference to one session (web `{ rate, id }`): the rate in kWh/h
/// and the session id used in the card subtitle (`Session #{{id}}`).
public struct ChargeRateRef: Equatable, Sendable {
    public let id: Int
    public let rate: Double

    public init(id: Int, rate: Double) {
        self.id = id
        self.rate = rate
    }
}

/// One per-year trend point (web `yearlyTrend` element). Rounded to one decimal
/// to match the web `Math.round(avg * 10) / 10`. Rendered by the sibling
/// YearlyTrendChart surface; computed here as part of this section's data.
public struct YearlyTrendPoint: Equatable, Sendable {
    public let year: String
    public let avg10to80: Double
    public let avg20to80: Double
    public let count: Int

    public init(year: String, avg10to80: Double, avg20to80: Double, count: Int) {
        self.year = year
        self.avg10to80 = avg10to80
        self.avg20to80 = avg20to80
        self.count = count
    }
}

/// The resolved time-to-charge metrics (web `TimeToChargeMetrics`): the two
/// average-duration figures (minutes, `nil` when no session crosses the band),
/// the fastest/slowest charge-rate references, and the per-year trend series.
public struct TimeToChargeMetrics: Equatable, Sendable {
    public let avg10to80: Double?
    public let avg20to80: Double?
    public let fastest: ChargeRateRef?
    public let slowest: ChargeRateRef?
    public let yearlyTrend: [YearlyTrendPoint]

    public init(
        avg10to80: Double?,
        avg20to80: Double?,
        fastest: ChargeRateRef?,
        slowest: ChargeRateRef?,
        yearlyTrend: [YearlyTrendPoint]
    ) {
        self.avg10to80 = avg10to80
        self.avg20to80 = avg20to80
        self.fastest = fastest
        self.slowest = slowest
        self.yearlyTrend = yearlyTrend
    }

    /// The web `empty` constant: all-`nil` figures and an empty trend.
    public static let empty = TimeToChargeMetrics(
        avg10to80: nil, avg20to80: nil, fastest: nil, slowest: nil, yearlyTrend: []
    )
}

// MARK: - Card model (web `<TimeToChargeCard label value unit subtitle>`)

/// The semantic accent for each card's icon affordance — a brand token role,
/// resolved to a `Color` in the view (ADR-006 semantic parity, never a hex).
public enum TimeToChargeAccent: String, Sendable, Equatable, CaseIterable {
    case band10 // 10 → 80 duration
    case band20 // 20 → 80 duration
    case fastest // fastest session rate
    case slowest // slowest session rate
}

/// One resolved metric card — the native mirror of a single web `TimeToChargeCard`
/// (`label` / `value` / `unit` / `subtitle`). Prose is carried as i18n keys +
/// English fallbacks (resolved in the view); the numeric value is pre-formatted
/// and `nil` when there is no figure (web `value ?? '—'`, with the unit hidden).
public struct TimeToChargeCardModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String?
    public let unitKey: String
    public let unitFallback: String
    public let subtitleKey: String?
    public let subtitleFallback: String?
    public let subtitleSessionID: Int?
    public let accent: TimeToChargeAccent
    public let symbol: String

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String?,
        unitKey: String,
        unitFallback: String,
        subtitleKey: String?,
        subtitleFallback: String?,
        subtitleSessionID: Int?,
        accent: TimeToChargeAccent,
        symbol: String
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unitKey = unitKey
        self.unitFallback = unitFallback
        self.subtitleKey = subtitleKey
        self.subtitleFallback = subtitleFallback
        self.subtitleSessionID = subtitleSessionID
        self.accent = accent
        self.symbol = symbol
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the header accessory (web freshness indicator).
public enum TimeToChargeFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The resolved content state: the four cards, the (still-computed) trend series,
/// and the freshness/refresh chrome.
public struct TimeToChargeContent: Equatable, Sendable {
    public let cards: [TimeToChargeCardModel]
    public let metrics: TimeToChargeMetrics
    public let freshness: TimeToChargeFreshness
    public let refreshing: Bool

    public init(
        cards: [TimeToChargeCardModel],
        metrics: TimeToChargeMetrics,
        freshness: TimeToChargeFreshness,
        refreshing: Bool
    ) {
        self.cards = cards
        self.metrics = metrics
        self.freshness = freshness
        self.refreshing = refreshing
    }
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content).
/// The web leaf only branches on the session count; this superset adds the
/// prompt's loading + stale + offline + error chrome while preserving the
/// four-card summary as the content branch.
public enum TimeToChargePresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(TimeToChargeContent)
}
