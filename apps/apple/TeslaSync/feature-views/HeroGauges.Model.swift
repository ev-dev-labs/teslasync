//
//  HeroGauges.Model.swift
//  TeslaSync — P4 feature view · 0103 · HeroGauges (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `HeroGaugesModel`; no networking lives in the view.
//  SwiftUI parity of features/charging/components/charging-list/HeroGauges.tsx — the four
//  headline charging "hero" gauges (Sessions, Energy, Total Cost, Avg Power) plus the
//  Avg $/kWh readout the charging list renders above its session table.
//
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives compile and run on a plain host and are pinned by unit tests; the
//  SwiftUI chrome layers on top in HeroGauges.swift / HeroGauges.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol HeroGaugesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogHeroGaugesTelemetry: HeroGaugesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's charging query, mirroring the shared `LoadableState`
/// cases the production source projects from the `useCharging` hook (web `isLoading` skeleton /
/// resolved `stats` / `stats === null` empty / failure).
public enum HeroLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so cached gauges are clearly labeled while reconnecting / offline.
public enum HeroConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The computed charging summary this surface reads — the exact subset of the web `ChargingStats`
/// DTO (from `computeStats(sessions)`) that `HeroGauges` consumes. `count` is the session count,
/// `totalEnergy` is kWh, `totalCost` is in the user's currency, `avgPower` is kW, and
/// `avgCostPerKwh` is currency-per-kWh. The shared `ChargingStore` projects these from the API
/// the same way the web hook does; display formatting happens in `HeroGaugesProjector`.
public struct ChargingStatsDTO: Sendable, Equatable {
    public var count: Int
    public var totalEnergy: Double
    public var totalCost: Double
    public var avgPower: Double
    public var avgCostPerKwh: Double

    public init(
        count: Int = 0,
        totalEnergy: Double = 0,
        totalCost: Double = 0,
        avgPower: Double = 0,
        avgCostPerKwh: Double = 0
    ) {
        self.count = count
        self.totalEnergy = totalEnergy
        self.totalCost = totalCost
        self.avgPower = avgPower
        self.avgCostPerKwh = avgCostPerKwh
    }
}

/// The user's display preferences for this surface, mirroring `useFormatting()`. The web component
/// renders the currency symbol literally as "$"; the production app resolves the real symbol +
/// locale and pushes them with each snapshot so the view never reads settings directly.
public struct HeroUnitPrefs: Sendable, Equatable {
    public var currencySymbol: String
    public var localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `HeroGaugesSource`: the computed charging stats + display
/// prefs plus their load/connection status. The model turns this into the projection.
public struct HeroGaugesUpdate: Sendable, Equatable {
    public var status: HeroLoadStatus
    public var connection: HeroConnection
    public var isFetching: Bool
    public var stats: ChargingStatsDTO?
    public var units: HeroUnitPrefs
    public var updatedAt: Date?

    public init(
        status: HeroLoadStatus = .loading,
        connection: HeroConnection = .live,
        isFetching: Bool = false,
        stats: ChargingStatsDTO? = nil,
        units: HeroUnitPrefs = HeroUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<ChargingStats>>` from the KMP `ChargingStore` composed
/// with the `SettingsStore` for `useFormatting`); previews and tests use
/// `InMemoryHeroGaugesSource`. The view never talks to the network directly.
@MainActor
public protocol HeroGaugesSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (HeroGaugesUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `HeroGaugesSource`, recomputes the
/// `HeroGaugesProjection` via `HeroGaugesProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class HeroGaugesModel {
    /// The mutually-exclusive render branches (web shell loading skeleton / resolved gauges /
    /// empty / failure).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: HeroConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: HeroGaugesProjection?
    public private(set) var units = HeroUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any HeroGaugesSource
    @ObservationIgnored private let telemetry: any HeroGaugesTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any HeroGaugesSource,
        telemetry: any HeroGaugesTelemetry = OSLogHeroGaugesTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: HeroGaugesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached gauges stay visible). Wired to the retry affordance and to
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web stale-query self-refresh (prompt "stale chip + auto-refresh").
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: HeroGaugesUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.stats.map { HeroGaugesProjector.project(stats: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats != nil)
    }

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the initial
    /// fetch and the empty state when there are no stats; whenever stats are known the grid renders
    /// (cached values stay visible behind a refresh / transient failure so an offline or stale pod
    /// still shows the last-known gauges).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: HeroLoadStatus, hasData: Bool) -> Phase {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryHeroGaugesSource: HeroGaugesSource {
    public var onUpdate: (@MainActor (HeroGaugesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: HeroGaugesUpdate?

    public init(initial: HeroGaugesUpdate? = nil) {
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
    public func push(_ update: HeroGaugesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile
/// and test without SwiftUI.
public enum HeroGaugesSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HeroGauges"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "HeroGauges" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)`
/// helper lives in the view file.
public enum HeroGaugesStrings {
    public static let table = "HeroGauges"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
