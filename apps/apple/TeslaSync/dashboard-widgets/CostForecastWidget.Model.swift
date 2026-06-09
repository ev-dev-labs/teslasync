//
//  CostForecastWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `CostForecastWidgetModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol CostForecastWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogCostForecastWidgetTelemetry: CostForecastWidgetTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum CostForecastWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum CostForecastWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `CostForecastWidgetSource`: the cached historical
/// + forecast months, the active currency symbol / decimal precision from the
/// shared settings store, and load/connection status. The model turns this into
/// the rendered projection + currency formatter.
public struct CostForecastWidgetUpdate: Sendable, Equatable {
    public var status: CostForecastWidgetLoadStatus
    public var connection: CostForecastWidgetConnection
    public var vehicle: CostForecastWidgetVehicle?
    public var historical: [CostForecastWidgetHistoricalMonth]
    public var forecast: [CostForecastWidgetForecastMonth]
    public var currencySymbol: String
    public var decimalPrecision: Int
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: CostForecastWidgetLoadStatus = .loading,
        connection: CostForecastWidgetConnection = .live,
        vehicle: CostForecastWidgetVehicle? = nil,
        historical: [CostForecastWidgetHistoricalMonth] = [],
        forecast: [CostForecastWidgetForecastMonth] = [],
        currencySymbol: String = "$",
        decimalPrecision: Int = 2,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.historical = historical
        self.forecast = forecast
        self.currencySymbol = currencySymbol
        self.decimalPrecision = decimalPrecision
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useCostForecast` projected from the KMP
/// `ChargingStore`, with `useVehicles` supplying the scoped id and the settings
/// store the currency symbol / precision); previews and tests use
/// `InMemoryCostForecastWidgetSource`. The view never talks to the network.
@MainActor
public protocol CostForecastWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (CostForecastWidgetUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `CostForecastWidgetSource`,
/// recomputes the `CostForecastWidgetProjection` via `CostForecastWidgetBuilder`, and exposes
/// a render `Phase` + freshness + the display currency formatter for SwiftUI.
@MainActor
@Observable
public final class CostForecastWidgetModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// chart-summary empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: CostForecastWidgetConnection = .live
    public private(set) var projection: CostForecastWidgetProjection = .empty
    public private(set) var currency = CostForecastWidgetCurrencyFormatter()
    public private(set) var vehicle: CostForecastWidgetVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CostForecastWidgetSource
    @ObservationIgnored private let telemetry: any CostForecastWidgetTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any CostForecastWidgetSource,
        telemetry: any CostForecastWidgetTelemetry = OSLogCostForecastWidgetTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostForecastWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances and the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Compact (summary-only, no chart) when the widget is a single column — the
    /// web `isCompact = size.cols <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Wide (more axis ticks) at 3+ columns — the web `isWide = size.cols >= 3`.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: CostForecastWidgetUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        currency = CostForecastWidgetCurrencyFormatter(
            symbol: update.currencySymbol,
            precision: update.decimalPrecision,
            localeIdentifier: update.localeIdentifier
        )
        projection = CostForecastWidgetBuilder.buildProjection(
            historical: update.historical,
            forecast: update.forecast
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No forecast data" empty whenever there is nothing
    /// to chart; cached bars stay visible behind a refresh/offline/error so a
    /// transient failure never blanks a populated widget.
    static func resolvePhase(
        status: CostForecastWidgetLoadStatus,
        projection: CostForecastWidgetProjection
    ) -> Phase {
        switch status {
        case .loading:
            projection.hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasData ? .content : .empty
        case let .failed(message):
            projection.hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryCostForecastWidgetSource: CostForecastWidgetSource {
    public var onUpdate: (@MainActor (CostForecastWidgetUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostForecastWidgetUpdate?

    public init(initial: CostForecastWidgetUpdate? = nil) {
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
    public func push(_ update: CostForecastWidgetUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "CostForecastWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum CostForecastWidgetStrings {
    public static let table = "CostForecastWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget / chart. Pure + public so
/// the a11y content can be unit-tested without rendering the view.
public enum CostForecastWidgetAccessibility {
    /// Header/chart summary: "Next Month <cost>. Avg $/kWh <cost>. Trend up/down
    /// <delta>." (web stats), or the empty message when there is nothing to show.
    public static func summary(
        for projection: CostForecastWidgetProjection,
        currency: CostForecastWidgetCurrencyFormatter
    ) -> String {
        guard projection.hasData else {
            return CostForecastWidgetStrings.string("widget.costForecast.noData", "No forecast data")
        }
        let nextMonth = CostForecastWidgetStrings.string("widget.costForecast.nextMonth", "Next Month")
        let avgLabel = CostForecastWidgetStrings.string("widget.costForecast.avgPerKwh", "Avg $/kWh")
        let nextValue = currency.string(projection.nextCost, decimals: 0)
        let avgValue = projection.avgCostPerKwh.map { currency.string($0, decimals: 2) } ?? "—"
        let trend = trendPhrase(for: projection, currency: currency)
        return "\(nextMonth) \(nextValue). \(avgLabel) \(avgValue). \(trend)."
    }

    /// The spoken trend phrase: "Trend up/down <delta>" (web `↑/↓ <delta>`).
    public static func trendPhrase(
        for projection: CostForecastWidgetProjection,
        currency: CostForecastWidgetCurrencyFormatter
    ) -> String {
        let trend = CostForecastWidgetStrings.string("widget.costForecast.trend", "Trend")
        let direction = projection.trendUp
            ? CostForecastWidgetStrings.string("widget.costForecast.trendUp", "up")
            : CostForecastWidgetStrings.string("widget.costForecast.trendDown", "down")
        let delta = currency.string(projection.trendDelta, decimals: 0)
        return "\(trend) \(direction) \(delta)"
    }

    /// Per-bar VoiceOver value: "<month>: <cost>, actual/forecast".
    public static func barLabel(_ bar: CostForecastWidgetBar, currency: CostForecastWidgetCurrencyFormatter) -> String {
        let kind = bar.isForecast
            ? CostForecastWidgetStrings.string("widget.costForecast.forecast", "Forecast")
            : CostForecastWidgetStrings.string("widget.costForecast.actual", "Actual")
        let cost = currency.string(bar.cost, decimals: 0)
        return "\(bar.month): \(cost), \(kind)"
    }
}
