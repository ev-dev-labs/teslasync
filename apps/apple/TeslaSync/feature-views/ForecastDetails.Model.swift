//
//  ForecastDetails.Model.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  cost-forecast slice (no networking in the view — the web component takes
//  `forecastData` as a prop; here a source pushes coalesced snapshots), the P1/S10
//  i18n facade (`useTranslation`), the formatting facade (`useFormatting` —
//  currency + integer), the P1/S11 telemetry contract, and the `@Observable`
//  view-model that resolves the render phase. Previews/tests drive the model with
//  `InMemoryForecastSource`; production wires a source over the shared cost-analysis
//  state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the shared
/// core diagnostics contract (consent-gated + redacted there).
public protocol ForecastTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogForecastTelemetry: ForecastTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (P1/S8 — web `useFormatting`)

/// The display-boundary formatting the section needs: currency (web `<Currency
/// value precision />` / `useFormatting().currencySymbol` — `currencySymbol +
/// grouped fixed-decimals`) and integers (web `fmtNumber(value, 0)` — locale-grouped,
/// zero fraction digits). Production injects a settings-backed implementation
/// (currency symbol + precision + locale from `useSettings`); previews/tests use
/// `DefaultForecastFormatting`.
public protocol ForecastFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatInt(_ value: Double) -> String
}

public extension ForecastFormatting {
    /// Currency at the web `<Currency>` default precision (2), matching the cost-row
    /// call sites (`gas_cost_per_month` / `ev_cost_per_month`).
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: `"$"` symbol, grouped thousands, fixed decimals,
/// rounding half-up — the parity of the web `${currencySymbol}${fmtNumber(...)}`
/// with the `$` / locale defaults. Stateless and `Sendable`.
public struct DefaultForecastFormatting: ForecastFormatting, Sendable {
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
        let value = ForecastNumeric.safe(amount)
        let number = formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: value)) ?? "0"
        return currencySymbol + number
    }

    public func formatInt(_ value: Double) -> String {
        let safe = ForecastNumeric.safe(value)
        return formatter(decimals: 0).string(from: NSNumber(value: safe)) ?? "0"
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the cost-forecast slice, mirroring the shared
/// `LoadableState` cases a production source projects from the cost-analysis
/// `Resource<T>`.
public enum ForecastStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`, `stale`
/// (older than the freshness window), `offline` (no connectivity — cached values
/// shown). Drives the freshness banner.
public enum ForecastConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ForecastSource`: the resolved forecast slice
/// plus its load/connection status. The model turns this into the render phase.
public struct ForecastUpdate: Sendable, Equatable {
    public var status: ForecastStatus
    public var connection: ForecastConnection
    public var forecast: CostForecast?
    public var updatedAt: Date?

    public init(
        status: ForecastStatus = .loading,
        connection: ForecastConnection = .live,
        forecast: CostForecast? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.forecast = forecast
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// cost-analysis state holder; previews/tests use `InMemoryForecastSource`. The view
/// never talks to the network directly.
@MainActor
public protocol ForecastSource: AnyObject {
    var onUpdate: (@MainActor (ForecastUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ForecastSource`, holds the
/// latest forecast + freshness, and exposes a render `Phase` plus the three panels'
/// pre-computed projections for SwiftUI to switch over.
@MainActor
@Observable
public final class ForecastDetailsModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders all
    /// three panels (each owns its own empty state, matching the web, which never
    /// hides a panel — `forecastData ? … : <EmptyState/>`); `loading` is the initial
    /// fetch; `error` is a hard failure with no cached data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ForecastConnection = .live
    public private(set) var forecast: CostForecast?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ForecastSource
    @ObservationIgnored private let telemetry: any ForecastTelemetry
    @ObservationIgnored let formatting: any ForecastFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any ForecastSource,
        telemetry: any ForecastTelemetry = OSLogForecastTelemetry(),
        formatting: any ForecastFormatting = DefaultForecastFormatting(),
        localize: @escaping (String, String) -> String = ForecastStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Panel projections (web inline data, recomputed from the current forecast)

    /// Whether a forecast slice is present (web `forecastData ? … : empty`). Drives
    /// the breakdown + savings panels' content-vs-empty disposition.
    public var hasForecast: Bool {
        forecast != nil
    }

    /// The two breakdown donut slices (web `<Pie data={[home, super]}>`), or empty
    /// when no forecast is present.
    public var breakdownSlices: [ForecastBreakdownSlice] {
        guard let forecast else { return [] }
        return ForecastProjection.breakdownSlices(forecast.breakdown)
    }

    /// The gas-vs-EV savings figures (web `gas_comparison`), or `nil` when no
    /// forecast is present.
    public var savings: ForecastGasComparison? {
        guard let forecast else { return nil }
        return ForecastProjection.savings(forecast.gasComparison)
    }

    /// The non-empty insight rows (web `(forecastData?.insights ?? [])`).
    public var insights: [ForecastInsight] {
        ForecastProjection.insights(forecast?.insights ?? [])
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ForecastDetails.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream forecast feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached forecast stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ForecastUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let payload = update.forecast {
            forecast = payload
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Cached forecast stays visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with no data yet, and the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(_ update: ForecastUpdate) -> Phase {
        let hasData = update.forecast != nil
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
public final class InMemoryForecastSource: ForecastSource {
    public var onUpdate: (@MainActor (ForecastUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ForecastUpdate?

    public init(initial: ForecastUpdate? = nil) {
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
    public func push(_ update: ForecastUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ForecastDetails" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; kept per-surface so
/// each parallel prompt owns its own strings without editing the shared catalog.
public enum ForecastStrings {
    public static let table = "ForecastDetails"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
