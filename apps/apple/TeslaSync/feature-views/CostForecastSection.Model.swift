//
//  CostForecastSection.Model.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the cost-
//  forecast slice (no networking in the view — the web section takes `forecastData`
//  as a prop; here a source pushes coalesced snapshots), the P1/S10 i18n facade
//  (`useTranslation`), the formatting facade (`useFormatting` — currency), the
//  P1/S11 telemetry contract (`view.opened`), and the `@Observable` view-model that
//  resolves the render phase. Previews/tests drive the model with
//  `InMemoryCostForecastSource`; production wires a source over the shared charging
//  cost-analysis state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), consent-gated and
/// redacted there.
public protocol CostForecastTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogCostForecastTelemetry: CostForecastTelemetry {
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
/// `formatCurrency` / the `$` y-axis unit) at a caller-chosen precision, plus a
/// compact axis variant ("$1.2k") for the dollar axis. Production injects a
/// settings-backed implementation (currency symbol + locale from `useSettings`);
/// previews/tests use `DefaultCostForecastFormatting`.
public protocol CostForecastFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatCurrencyCompact(_ amount: Double) -> String
}

public extension CostForecastFormatting {
    /// Currency at 2 decimals — the section's tooltip / summary precision.
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: `"$"` symbol, grouped thousands, fixed decimals,
/// rounding half-up — the parity of the web `${currencySymbol}${value}` with the
/// `$` default. The compact variant prefixes the symbol onto the abbreviated
/// magnitude (web `YAxis unit="$"`). Stateless and `Sendable`.
public struct DefaultCostForecastFormatting: CostForecastFormatting, Sendable {
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
        let value = CostNumeric.safe(amount)
        let number = formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: value)) ?? "0"
        return currencySymbol + number
    }

    public func formatCurrencyCompact(_ amount: Double) -> String {
        currencySymbol + CostNumeric.axisLabel(CostNumeric.safe(amount))
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the cost-forecast slice, mirroring the shared
/// `LoadableState` cases a production source projects from the cost-analysis
/// `Resource<T>`.
public enum CostForecastStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`,
/// `stale` (older than the freshness window), `offline` (no connectivity — cached
/// values shown). Drives the freshness banner.
public enum CostForecastConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `CostForecastSource`: the resolved forecast
/// slice plus its load/connection status. The model turns this into the render
/// phase.
public struct CostForecastUpdate: Sendable, Equatable {
    public var status: CostForecastStatus
    public var connection: CostForecastConnection
    public var data: CostForecastData?
    public var updatedAt: Date?

    public init(
        status: CostForecastStatus = .loading,
        connection: CostForecastConnection = .live,
        data: CostForecastData? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 cost-analysis state holder; previews/tests use `InMemoryCostForecastSource`.
/// The view never talks to the network directly.
@MainActor
public protocol CostForecastSource: AnyObject {
    var onUpdate: (@MainActor (CostForecastUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `CostForecastSource`, holds
/// the latest forecast slice + freshness, and exposes a render `Phase` plus the two
/// charts' pre-computed projections for SwiftUI to switch over.
@MainActor
@Observable
public final class CostForecastModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders
    /// both chart panels (each owns its own empty state, matching the web, which
    /// shows an `EmptyState` rather than hiding a panel); `loading` is the initial
    /// fetch; `error` is a hard failure with no cached data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: CostForecastConnection = .live
    public private(set) var data = CostForecastData()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CostForecastSource
    @ObservationIgnored private let telemetry: any CostForecastTelemetry
    @ObservationIgnored let formatting: any CostForecastFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any CostForecastSource,
        telemetry: any CostForecastTelemetry = OSLogCostForecastTelemetry(),
        formatting: any CostForecastFormatting = DefaultCostForecastFormatting(),
        localize: @escaping (String, String) -> String = CostForecastStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Chart projections (web memos, recomputed from the current data)

    /// Whether the forecast chart has enough data to draw (web `hasForecast`).
    public var hasForecast: Bool {
        CostForecastProjection.hasForecast(data)
    }

    /// Whether the cost-per-kWh trend has enough data to draw (web
    /// `hasCostPerKwhTrend`).
    public var hasCostPerKwhTrend: Bool {
        CostForecastProjection.hasCostPerKwhTrend(data)
    }

    /// The combined forecast chart (web `ComposedChart` data + axis).
    public var forecastChart: ForecastChartModel {
        CostForecastProjection.forecastChart(data)
    }

    /// The cost-per-kWh trend points (web `LineChart` data).
    public var costPerKwhPoints: [CostPerKwhPoint] {
        CostForecastProjection.costPerKwhPoints(data)
    }

    /// Upper bound for the cost-per-kWh dollar axis.
    public var costPerKwhUpperBound: Double {
        CostForecastProjection.costPerKwhUpperBound(costPerKwhPoints)
    }

    /// Whether the resolved slice has nothing to plot in either chart.
    public var isEmpty: Bool {
        data.isEmpty
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostForecastSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream forecast feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached data stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: CostForecastUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let payload = update.data {
            data = payload
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached data stays visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with no data yet, and the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(_ update: CostForecastUpdate) -> Phase {
        let hasData = (update.data?.isEmpty == false)
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
public final class InMemoryCostForecastSource: CostForecastSource {
    public var onUpdate: (@MainActor (CostForecastUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostForecastUpdate?

    public init(initial: CostForecastUpdate? = nil) {
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
    public func push(_ update: CostForecastUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "CostForecastSection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings without editing the
/// shared catalog.
public enum CostForecastStrings {
    public static let table = "CostForecastSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
