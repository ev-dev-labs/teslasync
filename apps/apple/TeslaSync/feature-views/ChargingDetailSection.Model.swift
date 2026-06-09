//
//  ChargingDetailSection.Model.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  `charging_analytics` slice (no networking in the view — the web section takes
//  `data` as a prop; here a source pushes coalesced snapshots), the P1/S10 i18n
//  facade (`useTranslation`), the formatting facade (`useFormatting` —
//  currency + integer), the P1/S11 telemetry contract, and the `@Observable`
//  view-model that resolves the render phase. Previews/tests drive the model with
//  `InMemoryChargingDetailSource`; production wires a source over the shared
//  analytics state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), consent-gated and
/// redacted there.
public protocol ChargingDetailTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChargingDetailTelemetry: ChargingDetailTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (P1/S8 — web `useFormatting`)

/// The display-boundary formatting the section needs: currency (web
/// `formatCurrency(amount, 2)` — `currencySymbol + grouped fixed-decimals`) and
/// integers (web `fmtInt` — locale-grouped, zero fraction digits). Production
/// injects a settings-backed implementation (currency symbol + precision + locale
/// from `useSettings`); previews/tests use `DefaultChargingDetailFormatting`.
public protocol ChargingDetailFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatInt(_ value: Double) -> String
}

public extension ChargingDetailFormatting {
    /// Currency at the web default precision (2), matching the section's call site.
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: `"$"` symbol, grouped thousands, fixed decimals,
/// rounding half-up — the parity of the web `${currencySymbol}${fmtNumber(...)}`
/// with the `$` / precision-2 defaults. Stateless and `Sendable`.
public struct DefaultChargingDetailFormatting: ChargingDetailFormatting, Sendable {
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

    public func formatCurrency(_ amount: Double, decimals: Int) -> String {
        let value = ChargingNumeric.safe(amount)
        let number = formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: value)) ?? "0"
        return currencySymbol + number
    }

    public func formatInt(_ value: Double) -> String {
        let safe = ChargingNumeric.safe(value)
        return formatter(decimals: 0).string(from: NSNumber(value: safe)) ?? "0"
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the analytics slice, mirroring the shared `LoadableState`
/// cases a production source projects from the analytics `Resource<T>`.
public enum ChargingDetailStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`,
/// `stale` (older than the freshness window), `offline` (no connectivity — cached
/// values shown). Drives the freshness banner.
public enum ChargingDetailConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargingDetailSource`: the resolved
/// analytics slice plus its load/connection status. The model turns this into the
/// render phase.
public struct ChargingAnalyticsUpdate: Sendable, Equatable {
    public var status: ChargingDetailStatus
    public var connection: ChargingDetailConnection
    public var analytics: ChargingAnalytics?
    public var updatedAt: Date?

    public init(
        status: ChargingDetailStatus = .loading,
        connection: ChargingDetailConnection = .live,
        analytics: ChargingAnalytics? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.analytics = analytics
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 analytics state holder; previews/tests use `InMemoryChargingDetailSource`.
/// The view never talks to the network directly.
@MainActor
public protocol ChargingDetailSource: AnyObject {
    var onUpdate: (@MainActor (ChargingAnalyticsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ChargingDetailSource`,
/// holds the latest analytics + freshness, and exposes a render `Phase` plus the
/// four panels' pre-computed projections for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargingDetailModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders
    /// all four panels (each owns its own empty state, matching the web,
    /// which never hides a panel); `loading` is the initial fetch; `error` is a
    /// hard failure with no cached data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargingDetailConnection = .live
    public private(set) var analytics = ChargingAnalytics()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingDetailSource
    @ObservationIgnored private let telemetry: any ChargingDetailTelemetry
    @ObservationIgnored let formatting: any ChargingDetailFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any ChargingDetailSource,
        telemetry: any ChargingDetailTelemetry = OSLogChargingDetailTelemetry(),
        formatting: any ChargingDetailFormatting = DefaultChargingDetailFormatting(),
        localize: @escaping (String, String) -> String = ChargingDetailStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Panel projections (web memos, recomputed from the current analytics)

    /// The charger-brand leaderboard rows (web `brandLeaderboard`).
    public var brandLeaderboard: [BrandLeaderboardRow] {
        ChargingDetailProjection.brandLeaderboard(analytics.brands)
    }

    /// The charger-type share bars (web `chargerTypes.map`).
    public var chargerTypeShares: [ChargerTypeShare] {
        ChargingDetailProjection.chargerTypeShares(analytics.chargerTypes)
    }

    /// The dual-axis scale for the monthly composed chart.
    public var monthlyTrendScale: MonthlyTrendScale {
        ChargingDetailProjection.monthlyTrendScale(analytics.monthlyTrend)
    }

    /// The monthly trend points (web `monthlyTrend`).
    public var monthlyTrend: [MonthlyChargePoint] {
        analytics.monthlyTrend
    }

    /// The cost summary, or `nil` when absent (web `costStats ? … : empty`).
    public var costStats: CostStats? {
        analytics.costStats
    }

    /// Whether the resolved analytics has no data in any panel.
    public var isEmpty: Bool {
        analytics.isEmpty
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingDetailSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream analytics feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached analytics stay visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargingAnalyticsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let payload = update.analytics {
            analytics = payload
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached analytics stay visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with no data yet, and the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(_ update: ChargingAnalyticsUpdate) -> Phase {
        let hasData = (update.analytics?.isEmpty == false)
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
public final class InMemoryChargingDetailSource: ChargingDetailSource {
    public var onUpdate: (@MainActor (ChargingAnalyticsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingAnalyticsUpdate?

    public init(initial: ChargingAnalyticsUpdate? = nil) {
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
    public func push(_ update: ChargingAnalyticsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargingDetailSection"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings without editing
/// the shared catalog.
public enum ChargingDetailStrings {
    public static let table = "ChargingDetailSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
