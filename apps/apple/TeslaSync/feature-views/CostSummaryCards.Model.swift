//
//  CostSummaryCards.Model.swift
//  TeslaSync — P4 feature view · 0111 · CostSummaryCards (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `CostSummaryModel`; no networking lives in the view.
//  SwiftUI parity of
//  features/charging/components/cost-analysis/CostSummaryCards.tsx — the charging cost
//  analysis "summary cards" row that renders the aggregated `CoreStats` (total cost, blended
//  $/kWh, cost per distance, total energy, gas savings, savings %) as six `StatBox` tiles.
//  The web component reads its data from the parent `useCostAnalysisData` projection and its
//  display preferences from `useFormatting` (currency symbol) + `useSettings` (gas unit,
//  locale); the production app composes all three into the `CostSummarySource` seam below.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol CostSummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogCostSummaryTelemetry: CostSummaryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's cost-analysis query, mirroring the shared
/// `LoadableState` cases the web source's parent projects from `useCostAnalysisData`
/// (web `isLoading` skeleton / resolved `coreStats` / `coreStats === null` empty / failure).
public enum CostSummaryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached tiles are clearly labeled while reconnecting / offline.
public enum CostSummaryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's gas-unit preference (web `useSettings().settings.gas_unit`). Resolves to the
/// short unit label the web source builds (`gas_unit === 'liter' ? 'L' : 'gal'`); the label
/// is routed through the P1/S10 facade so even the unit abbreviation stays localizable.
public enum CostGasUnit: String, Sendable, Equatable, Codable {
    case gallon
    case liter

    /// The P1/S10 key for the short unit label rendered in the "Gas Savings" subtitle.
    public var labelKey: String {
        self == .liter ? "costAnalysis.stats.gasUnitLiter" : "costAnalysis.stats.gasUnitGallon"
    }

    /// The web English value for the short unit label (`'L'` / `'gal'`).
    public var labelFallback: String {
        self == .liter ? "L" : "gal"
    }
}

/// The aggregated `CoreStats` fields the web source reads. A `nil` snapshot (web
/// `coreStats === null`) renders every tile at the zero sentinel, exactly as the web
/// `coreStats?.field ?? 0` guard does — the grid never renders blank.
public struct CostSummaryStats: Sendable, Equatable {
    /// Web `coreStats.totalCost` — summed `cost_decimal` (display currency).
    public var totalCost: Double
    /// Web `coreStats.count` — number of charging sessions in range (web `fmtInt`).
    public var count: Int
    /// Web `coreStats.avgCostPerKwh` — blended cost per kWh.
    public var avgCostPerKwh: Double
    /// Web `coreStats.costPerDist` — cost per the user's display distance unit.
    public var costPerDist: Double
    /// Web `coreStats.totalEnergy` — total energy added (kWh, already SI-converted upstream).
    public var totalEnergy: Double
    /// Web `coreStats.gallonsEquiv` — gasoline-gallon energy equivalent.
    public var gallonsEquiv: Double
    /// Web `coreStats.savings` — `gasCost - totalCost` (display currency).
    public var savings: Double
    /// Web `coreStats.savingsPercent` — `(savings / gasCost) * 100`.
    public var savingsPercent: Double

    public init(
        totalCost: Double = 0,
        count: Int = 0,
        avgCostPerKwh: Double = 0,
        costPerDist: Double = 0,
        totalEnergy: Double = 0,
        gallonsEquiv: Double = 0,
        savings: Double = 0,
        savingsPercent: Double = 0
    ) {
        self.totalCost = totalCost
        self.count = count
        self.avgCostPerKwh = avgCostPerKwh
        self.costPerDist = costPerDist
        self.totalEnergy = totalEnergy
        self.gallonsEquiv = gallonsEquiv
        self.savings = savings
        self.savingsPercent = savingsPercent
    }

    /// The all-zero snapshot rendered when the cost-analysis query has no rows — the web
    /// `coreStats?.x ?? 0` fallback applied to every field at once.
    public static let zero = CostSummaryStats()
}

/// The display preferences the web source reads outside `coreStats`: the `gasPrice` +
/// `distanceUnit` + `isMiles` props (from the parent page) and the `currencySymbol` /
/// `gas_unit` / `locale` from `useFormatting` + `useSettings`. Bundled so the projection can
/// reproduce every subtitle (`per {unit}`, `vs {price}/{gasUnit}`) and the unit-aware label
/// (`Cost Per {Mile|km}`).
public struct CostSummaryUnitContext: Sendable, Equatable {
    /// Web `gasPrice` prop — the per-unit gasoline price shown in the "Gas Savings" subtitle.
    public var gasPrice: Double
    /// Web `distanceUnit` prop — the display distance symbol shown in the "Cost Per" subtitle.
    public var distanceUnit: String
    /// Web `isMiles` prop — selects the "Mile" vs "km" word in the "Cost Per" label.
    public var isMiles: Bool
    /// Web `useFormatting().currencySymbol` — the currency prefix (defaults to `$`).
    public var currencySymbol: String
    /// Web `useSettings().settings.gas_unit` — resolves the "Gas Savings" unit label.
    public var gasUnit: CostGasUnit
    /// Web global locale (BCP-47) used by `fmtNumber`'s `toLocaleString`; defaults to en-US.
    public var locale: String?

    public init(
        gasPrice: Double = 0,
        distanceUnit: String = "mi",
        isMiles: Bool = true,
        currencySymbol: String = "$",
        gasUnit: CostGasUnit = .gallon,
        locale: String? = nil
    ) {
        self.gasPrice = gasPrice
        self.distanceUnit = distanceUnit
        self.isMiles = isMiles
        self.currencySymbol = currencySymbol
        self.gasUnit = gasUnit
        self.locale = locale
    }
}

/// One coalesced snapshot pushed by a `CostSummarySource`: the cost-analysis load status +
/// the aggregated stats + the display-unit context + the (shared) connection + the in-flight
/// refresh flag + the freshness timestamp.
public struct CostSummaryUpdate: Sendable, Equatable {
    public var status: CostSummaryLoadStatus
    public var stats: CostSummaryStats?
    public var context: CostSummaryUnitContext
    public var refreshing: Bool
    public var connection: CostSummaryConnection
    public var updatedAt: Date?

    public init(
        status: CostSummaryLoadStatus = .loading,
        stats: CostSummaryStats? = nil,
        context: CostSummaryUnitContext = CostSummaryUnitContext(),
        refreshing: Bool = false,
        connection: CostSummaryConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.stats = stats
        self.context = context
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the cost-analysis projection (web `useCostAnalysisData`)
/// with the formatting + settings holders (web `useFormatting` / `useSettings`) and a refresh
/// affordance. Previews + tests use `InMemoryCostSummarySource`. The view never talks to the
/// network directly.
@MainActor
public protocol CostSummarySource: AnyObject {
    var onUpdate: (@MainActor (CostSummaryUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the cost-analysis query from the backend (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `CostSummarySource`, projects the
/// aggregated stats + display context into the six view-ready tiles, and exposes a render
/// `CostSummaryPhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class CostSummaryModel {
    public private(set) var connection: CostSummaryConnection = .live
    public private(set) var phase: CostSummaryPhase = .loading
    public private(set) var cards: [CostSummaryCardModel] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CostSummarySource
    @ObservationIgnored private let telemetry: any CostSummaryTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any CostSummarySource,
        telemetry: any CostSummaryTelemetry = OSLogCostSummaryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostSummaryCards.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the cost-analysis query (web `refetch()`), used by the error-state retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: CostSummaryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        refreshing = update.refreshing
        cards = CostSummaryProjection.cards(
            from: update.stats,
            context: update.context,
            localize: CostSummaryStrings.string
        )
        phase = CostSummaryProjection.resolvePhase(update.status, hasValue: update.stats != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of the cost-analysis query (prompt "stale chip +
    /// auto-refresh"); reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: CostSummaryConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryCostSummarySource: CostSummarySource {
    public var onUpdate: (@MainActor (CostSummaryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostSummaryUpdate?

    public init(initial: CostSummaryUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: CostSummaryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension CostSummaryCards {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "CostSummaryCards"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "CostSummaryCards" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum CostSummaryStrings {
    public static let table = "CostSummaryCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
