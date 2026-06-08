//
//  OptimizerSection.Model.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  charging-optimizer slice (no networking in the view — the web section takes
//  `optimizer` as a prop; here a source pushes coalesced snapshots), the P1/S10
//  i18n facade (`useTranslation`), the formatting facade (web `fmtNumber` +
//  `useFormatting().formatCurrency`), the P1/S11 telemetry contract, and the
//  `@Observable` view-model that resolves the render phase. Previews/tests drive
//  the model with `InMemoryOptimizerSource`; production wires a source over the
//  shared charging state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), consent-gated and
/// redacted there.
public protocol OptimizerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogOptimizerTelemetry: OptimizerTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (web `fmtNumber` + `useFormatting().formatCurrency`)

/// The display-boundary formatting the section needs: locale-grouped fixed-decimal
/// numbers (web `fmtNumber(value, decimals)`) and currency (web `formatCurrency =
/// currencySymbol + fmtNumber(amount, decimals)`). Production injects a
/// settings-backed implementation (symbol + precision + locale from `useSettings`);
/// previews/tests use `DefaultOptimizerFormatting`.
public protocol OptimizerFormatting {
    func formatNumber(_ value: Double, decimals: Int) -> String
    func formatCurrency(_ amount: Double, decimals: Int) -> String
}

public extension OptimizerFormatting {
    /// A percentage at the web default precision (0) — `fmtNumber(value, 0) + "%"`.
    func formatPercent(_ value: Double, decimals: Int = 0) -> String {
        formatNumber(value, decimals: decimals) + "%"
    }
}

/// Bundle-free default formatter: locale-grouped thousands, fixed decimals,
/// rounding half-up (matching JS `toLocaleString`'s default `halfExpand`), and a
/// `"$"` currency symbol — the parity of the web `fmtNumber` + `formatCurrency`
/// defaults. Stateless and `Sendable`.
public struct DefaultOptimizerFormatting: OptimizerFormatting, Sendable {
    private let currencySymbol: String
    private let localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
    }

    private func formatter(decimals: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = OptimizerNumeric.safe(value)
        let digits = Swift.max(0, decimals)
        return formatter(decimals: digits).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        currencySymbol + formatNumber(amount, decimals: decimals)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the optimizer slice, mirroring the shared `LoadableState`
/// cases a production source projects from the charging `Resource<T>`.
public enum OptimizerStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`,
/// `stale` (older than the freshness window), `offline` (no connectivity — cached
/// values shown). Drives the freshness banner.
public enum OptimizerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `OptimizerSource`: the resolved optimizer
/// slice plus its load/connection status. The model turns this into the render
/// phase.
public struct ChargingOptimizerUpdate: Sendable, Equatable {
    public var status: OptimizerStatus
    public var connection: OptimizerConnection
    public var optimizer: ChargingOptimizer?
    public var updatedAt: Date?

    public init(
        status: OptimizerStatus = .loading,
        connection: OptimizerConnection = .live,
        optimizer: ChargingOptimizer? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.optimizer = optimizer
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 charging state holder; previews/tests use `InMemoryOptimizerSource`. The
/// view never talks to the network directly.
@MainActor
public protocol OptimizerSource: AnyObject {
    var onUpdate: (@MainActor (ChargingOptimizerUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `OptimizerSource`, holds
/// the latest optimizer + freshness, and exposes a render `Phase` plus the
/// pre-computed projections (savings/heatmap visibility, score tier) for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class OptimizerModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders the
    /// composition (each panel owns its own empty state, matching the web, which
    /// never hides a panel); `loading` is the initial fetch; `error` is a hard
    /// failure with no cached data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: OptimizerConnection = .live
    public private(set) var optimizer = ChargingOptimizer()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any OptimizerSource
    @ObservationIgnored private let telemetry: any OptimizerTelemetry
    @ObservationIgnored let formatting: any OptimizerFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any OptimizerSource,
        telemetry: any OptimizerTelemetry = OSLogOptimizerTelemetry(),
        formatting: any OptimizerFormatting = DefaultOptimizerFormatting(),
        localize: @escaping (String, String) -> String = OptimizerStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Projections (web conditionals, recomputed from the current optimizer)

    /// Whether the savings banner shows (web `potential_monthly_savings > 5`).
    public var savingsBannerVisible: Bool {
        OptimizerProjection.savingsBannerVisible(optimizer.costAnalysis.potentialMonthlySavings)
    }

    /// Whether the heatmap panel renders (web `weekly_heatmap.length > 0`).
    public var heatmapVisible: Bool {
        OptimizerProjection.heatmapVisible(optimizer.weeklyHeatmap)
    }

    /// The battery-friendly score tier (web `>= 75 / >= 50` thresholds).
    public var batteryScoreTier: BatteryScoreTier {
        BatteryScoreTier.resolve(optimizer.batteryHealthScore)
    }

    /// The recommendations list (web `recommendations ?? []`).
    public var recommendations: [OptimizerRecommendation] {
        optimizer.recommendations
    }

    /// Whether the resolved optimizer carries no meaningful signal yet.
    public var isEmpty: Bool {
        optimizer.isEmpty
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: OptimizerSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream optimizer feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached optimizer stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargingOptimizerUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let payload = update.optimizer {
            optimizer = payload
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached optimizer stays visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with no data yet, and the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(_ update: ChargingOptimizerUpdate) -> Phase {
        let hasData = (update.optimizer?.isEmpty == false)
        switch update.status {
        case .loading:
            return hasData ? .loaded : .loading
        case .loaded, .empty:
            return .loaded
        case let .failed(message):
            return hasData ? .loaded : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryOptimizerSource: OptimizerSource {
    public var onUpdate: (@MainActor (ChargingOptimizerUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingOptimizerUpdate?

    public init(initial: ChargingOptimizerUpdate? = nil) {
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
    public func push(_ update: ChargingOptimizerUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "OptimizerSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings without editing the
/// shared catalog.
public enum OptimizerStrings {
    public static let table = "OptimizerSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
