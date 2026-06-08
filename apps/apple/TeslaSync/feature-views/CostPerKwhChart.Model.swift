//
//  CostPerKwhChart.Model.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  cost-analysis `costPerKwhTrend` slice (no networking in the view — the web
//  component takes `data` as a prop; here a source pushes coalesced snapshots),
//  the formatting facade (web `useFormatting().formatCurrency`), the P1/S11
//  telemetry contract (`view.opened`), and the `@Observable` view-model that
//  resolves the render phase + drives the stale auto-refresh. Previews/tests drive
//  the model with `InMemoryCostPerKwhSource`; production wires a source over the
//  shared cost-analysis state holder. SwiftUI parity of
//  features/charging/components/cost-analysis/CostPerKwhChart.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol CostPerKwhTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogCostPerKwhTelemetry: CostPerKwhTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (P1/S8 — web `useFormatting`)

/// The display-boundary formatting the surface needs: currency (web
/// `formatCurrency(amount, 2)` — `currencySymbol + grouped fixed-decimals`).
/// Production injects a settings-backed implementation (currency symbol +
/// precision + locale from `useSettings`); previews/tests use
/// `DefaultCostPerKwhFormatting`.
public protocol CostPerKwhFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
}

public extension CostPerKwhFormatting {
    /// Currency at the web default precision (2), matching the chart's call sites
    /// (`formatCurrency(v, 2)` for the Y axis + the selection readout).
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 2)
    }
}

/// Bundle-free default formatter: `"$"` symbol, grouped thousands, fixed decimals,
/// rounding half-up — the parity of the web `${currencySymbol}${fmtNumber(...)}`
/// with the `$` / precision-2 defaults. Stateless and `Sendable`.
public struct DefaultCostPerKwhFormatting: CostPerKwhFormatting, Sendable {
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
        let value = CostPerKwhNumeric.safe(amount)
        let number = formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: value)) ?? "0"
        return currencySymbol + number
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `CostPerKwhSource`: the raw trend samples +
/// their load status + the live-state connection + the last-update timestamp.
public struct CostPerKwhUpdate: Sendable, Equatable {
    public var status: CostPerKwhLoadStatus
    /// The web `costPerKwhTrend` array (`{ date, costPerKwh }[]`).
    public var samples: [CostPerKwhSample]
    public var connection: CostPerKwhConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: CostPerKwhLoadStatus = .loading,
        samples: [CostPerKwhSample] = [],
        connection: CostPerKwhConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.samples = samples
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the cost-analysis query the web
/// `useCostAnalysisData` reads and projecting it to the `costPerKwhTrend` samples.
/// Previews + tests use `InMemoryCostPerKwhSource`. The view never talks to the
/// network.
@MainActor
public protocol CostPerKwhSource: AnyObject {
    var onUpdate: (@MainActor (CostPerKwhUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `CostPerKwhSource`,
/// projects each snapshot into plotted points, exposes a render `CostPerKwhPhase`
/// + freshness for SwiftUI to switch over, and emits the `view.opened` diagnostics
/// event once on first appearance.
@MainActor
@Observable
public final class CostPerKwhModel {
    public private(set) var phase: CostPerKwhPhase = .loading
    public private(set) var connection: CostPerKwhConnection = .live
    public private(set) var points: [CostPerKwhChartPoint] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored let formatting: any CostPerKwhFormatting
    @ObservationIgnored let localize: (String, String) -> String

    @ObservationIgnored private let source: any CostPerKwhSource
    @ObservationIgnored private let telemetry: any CostPerKwhTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any CostPerKwhSource,
        telemetry: any CostPerKwhTelemetry = OSLogCostPerKwhTelemetry(),
        formatting: any CostPerKwhFormatting = DefaultCostPerKwhFormatting(),
        localize: @escaping (String, String) -> String = CostPerKwhStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The thinned X-axis tick labels for the current trend (web auto-thinning).
    public var axisTicks: [String] {
        CostPerKwhProjection.axisTicks(points)
    }

    /// The combined VoiceOver summary for the surface, state-aware so loading /
    /// empty / error are never announced as a blank chart.
    public var accessibilitySummary: String {
        switch phase {
        case .content:
            return CostPerKwhAccessibility.chartSummary(
                points,
                localize: localize,
                formatCurrency: { [formatting] value in formatting.formatCurrency(value) }
            )
        case .empty:
            let title = localize("costAnalysis.charts.costPerKwh", "Cost per kWh Trend")
            return title + ": " + localize("costAnalysis.charts.noData", "Not enough data")
        case .loading:
            return localize("costAnalysis.charts.a11y.loading", "Loading cost per kWh trend")
        case let .error(message):
            let title = localize("costAnalysis.charts.errorTitle", "Couldn't load cost per kWh trend")
            return message.isEmpty ? title : "\(title). \(message)"
        }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostPerKwhSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: CostPerKwhUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        points = CostPerKwhProjection.points(from: update.samples)
        phase = CostPerKwhProjection.resolvePhase(update.status, count: points.count)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps
    /// the cached trend on screen and does not refetch.
    private func handleAutoRefresh(for connection: CostPerKwhConnection) {
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

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCostPerKwhSource: CostPerKwhSource {
    public var onUpdate: (@MainActor (CostPerKwhUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostPerKwhUpdate?

    public init(initial: CostPerKwhUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: CostPerKwhUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "CostPerKwhChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum CostPerKwhStrings {
    public static let table = "CostPerKwhChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
