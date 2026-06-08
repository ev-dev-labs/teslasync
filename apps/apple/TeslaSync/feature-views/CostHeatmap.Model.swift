//
//  CostHeatmap.Model.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the charging
//  optimizer slice (no networking in the view — the web `CostHeatmap` takes
//  `heatmap` + `peakCostPerKwh` as props; here a source pushes coalesced snapshots),
//  the P1/S10 i18n facade (`useTranslation`), the formatting facade (`useFormatting`
//  — currency at 3-decimal cost-per-kWh + grouped integers), the P1/S11 telemetry
//  contract (`view.opened`), and the `@Observable` view-model that resolves the
//  render phase + the grid/legend/label projections. Previews/tests drive the model
//  with `InMemoryCostHeatmapSource`; production wires a source over the shared
//  optimizer state holder.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract — `view.opened`)

/// Emits the surface-open product-analytics event. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), consent-gated + redacted.
public protocol CostHeatmapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogCostHeatmapTelemetry: CostHeatmapTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (web `useFormatting`)

/// The display-boundary formatting the surface needs: currency (web
/// `formatCurrency(amount, decimals)` — `currencySymbol + grouped fixed-decimals`,
/// called at precision `3` for the per-kWh cost) and grouped integers (the session
/// count in the accessible summary). Production injects a settings-backed
/// implementation (symbol + locale from `useSettings`); previews/tests use
/// `DefaultCostHeatmapFormatting`.
public protocol CostHeatmapFormatting {
    func formatCurrency(_ amount: Double, decimals: Int) -> String
    func formatInt(_ value: Double) -> String
}

public extension CostHeatmapFormatting {
    /// Cost-per-kWh at the web call-site precision (web `formatCurrency(cost, 3)`).
    func formatCostPerKwh(_ amount: Double) -> String {
        formatCurrency(amount, decimals: 3)
    }
}

/// Bundle-free default formatter: `"$"` symbol, grouped thousands, fixed decimals,
/// rounding half-up — the parity of the web `${currencySymbol}${fmtNumber(...)}`
/// with the `$` default and the JS `halfExpand` rounding. Stateless and `Sendable`.
public struct DefaultCostHeatmapFormatting: CostHeatmapFormatting, Sendable {
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
        let value = CostHeatmapNumeric.safe(amount)
        let number = formatter(decimals: Swift.max(0, decimals)).string(from: NSNumber(value: value)) ?? "0"
        return currencySymbol + number
    }

    public func formatInt(_ value: Double) -> String {
        let safe = CostHeatmapNumeric.safe(value)
        return formatter(decimals: 0).string(from: NSNumber(value: safe)) ?? "0"
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the optimizer slice, mirroring the shared `LoadableState`
/// cases a production source projects from the optimizer `Resource<T>`.
public enum CostHeatmapStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live`, `stale`
/// (older than the freshness window), `offline` (no connectivity — cached values
/// shown). Drives the freshness banner.
public enum CostHeatmapConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `CostHeatmapSource`: the resolved heatmap data
/// plus its load/connection status. The model turns this into the render phase.
public struct CostHeatmapSnapshot: Sendable, Equatable {
    public var status: CostHeatmapStatus
    public var connection: CostHeatmapConnection
    public var data: CostHeatmapData?
    public var updatedAt: Date?

    public init(
        status: CostHeatmapStatus = .loading,
        connection: CostHeatmapConnection = .live,
        data: CostHeatmapData? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// optimizer state holder; previews/tests use `InMemoryCostHeatmapSource`. The view
/// never talks to the network directly.
@MainActor
public protocol CostHeatmapSource: AnyObject {
    var onUpdate: (@MainActor (CostHeatmapSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `CostHeatmapSource`, holds
/// the latest heatmap data + freshness, and exposes a render `Phase` plus the
/// grid / legend / label projections for SwiftUI to switch over.
@MainActor
@Observable
public final class CostHeatmapModel {
    /// The mutually-exclusive top-level render branches. `loaded` always renders the
    /// panel (which self-empties rather than hiding, matching the web's never-blank
    /// rule); `loading` is the initial fetch; `error` is a hard failure with no
    /// cached data to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: CostHeatmapConnection = .live
    public private(set) var data = CostHeatmapData()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CostHeatmapSource
    @ObservationIgnored private let telemetry: any CostHeatmapTelemetry
    @ObservationIgnored let formatting: any CostHeatmapFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any CostHeatmapSource,
        telemetry: any CostHeatmapTelemetry = OSLogCostHeatmapTelemetry(),
        formatting: any CostHeatmapFormatting = DefaultCostHeatmapFormatting(),
        localize: @escaping (String, String) -> String = CostHeatmapStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
    }

    // MARK: Projections (web render computations, recomputed from the current data)

    /// The dense 7×24 grid the canvas draws (web grid build).
    public var cells: [CostHeatmapCell] {
        CostHeatmapProjection.grid(data)
    }

    /// The five cheap→expensive legend swatches (web legend `.map`).
    public var legendSwatches: [CostHeatmapColor] {
        CostHeatmapProjection.legendSwatches()
    }

    /// Localized Sunday-first day labels (web `['Sun' … 'Sat']`).
    public var dayLabels: [String] {
        CostHeatmapProjection.dayLabels()
    }

    /// The hours that carry a tick label (web `i % 3 === 0`).
    public var labelledHours: [Int] {
        CostHeatmapProjection.labelledHours
    }

    /// The cost scale ceiling (web `peakCostPerKwh || 0.30`).
    public var maxCost: Double {
        CostHeatmapProjection.maxCost(peakCostPerKwh: data.peakCostPerKwh)
    }

    /// Whether no slot has any recorded session (drives the empty state).
    public var isEmpty: Bool {
        data.isEmpty
    }

    /// The pre-built VoiceOver summary for the grid canvas.
    public var accessibilitySummary: String {
        CostHeatmapAccessibility.summary(
            data,
            dayLabels: dayLabels,
            labels: summaryLabels,
            formatCurrency: { [formatting] amount in formatting.formatCurrency(amount, decimals: 3) },
            formatInt: formatting.formatInt
        )
    }

    private var summaryLabels: CostHeatmapSummaryLabels {
        CostHeatmapSummaryLabels(
            title: localize("charging.optimizer.heatmap", "Charging Cost Heatmap"),
            sessions: localize("charging.optimizer.heatmap.sessions", "sessions"),
            cheapest: localize("charging.optimizer.heatmap.cheapest", "Cheapest"),
            priciest: localize("charging.optimizer.heatmap.priciest", "Most expensive"),
            busiest: localize("charging.optimizer.heatmap.busiest", "Busiest"),
            perKwh: localize("charging.optimizer.heatmap.perKwh", "/kWh"),
            empty: localize("charging.optimizer.heatmap.empty", "No charging sessions recorded yet")
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostHeatmap.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream optimizer feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached data stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ snapshot: CostHeatmapSnapshot) {
        connection = snapshot.connection
        updatedAt = snapshot.updatedAt
        if let payload = snapshot.data {
            data = payload
        }
        phase = Self.resolvePhase(snapshot)
    }

    /// Resolves the render phase. Cached data stays visible behind a refresh /
    /// failure (freshness reflected by the banner); the skeleton shows only on the
    /// initial fetch with no data yet, and the hard-error state only when a failure
    /// arrives with nothing cached to render.
    public static func resolvePhase(_ snapshot: CostHeatmapSnapshot) -> Phase {
        let hasData = (snapshot.data?.isEmpty == false)
        switch snapshot.status {
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
public final class InMemoryCostHeatmapSource: CostHeatmapSource {
    public var onUpdate: (@MainActor (CostHeatmapSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostHeatmapSnapshot?

    public init(initial: CostHeatmapSnapshot? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: CostHeatmapSnapshot) {
        onUpdate?(snapshot)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "CostHeatmap" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; kept per-surface so
/// each parallel prompt owns its own strings without editing the shared catalog.
public enum CostHeatmapStrings {
    public static let table = "CostHeatmap"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
