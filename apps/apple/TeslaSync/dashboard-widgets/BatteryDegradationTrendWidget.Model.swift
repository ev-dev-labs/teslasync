//
//  BatteryDegradationTrendWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `BatteryDegradationTrendModel`; no networking lives here.
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
public protocol BatteryDegradationTrendTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogBatteryDegradationTrendTelemetry: BatteryDegradationTrendTelemetry {
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
public enum BatteryDegradationTrendLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum BatteryDegradationTrendConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `BatteryDegradationTrendSource`: the cached
/// monthly-trend rows + the degradation summary stats + the active vehicle +
/// load/connection status. The model turns this into the rendered projection.
public struct BatteryDegradationTrendUpdate: Sendable, Equatable {
    public var status: BatteryDegradationTrendLoadStatus
    public var connection: BatteryDegradationTrendConnection
    public var vehicle: DegradationVehicle?
    public var rows: [DegradationTrendRow]
    public var summary: DegradationSummary
    public var updatedAt: Date?

    public init(
        status: BatteryDegradationTrendLoadStatus = .loading,
        connection: BatteryDegradationTrendConnection = .live,
        vehicle: DegradationVehicle? = nil,
        rows: [DegradationTrendRow] = [],
        summary: DegradationSummary = .empty,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.rows = rows
        self.summary = summary
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// energy/vehicle stores); previews and tests use
/// `InMemoryBatteryDegradationTrendSource`. The view never talks to the network.
@MainActor
public protocol BatteryDegradationTrendSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BatteryDegradationTrendUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a
/// `BatteryDegradationTrendSource`, recomputes the `BatteryDegradationProjection`
/// via `BatteryDegradationTrendBuilder`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class BatteryDegradationTrendModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// chart-summary empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BatteryDegradationTrendConnection = .live
    public private(set) var projection: BatteryDegradationProjection = .empty
    public private(set) var vehicle: DegradationVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryDegradationTrendSource
    @ObservationIgnored private let telemetry: any BatteryDegradationTrendTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any BatteryDegradationTrendSource,
        telemetry: any BatteryDegradationTrendTelemetry = OSLogBatteryDegradationTrendTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryDegradationTrendWidget.surfaceSlug)
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

    /// Compact (summary-only, no chart) when the widget is a single column AND a
    /// single row — the web `isCompact = size.cols <= 1 && size.rows <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1 && size.rows <= 1
    }

    private func apply(_ update: BatteryDegradationTrendUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = BatteryDegradationTrendBuilder.buildProjection(
            rows: update.rows,
            summary: update.summary
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No degradation data" empty whenever there is no
    /// health value and no trend; cached content stays visible behind a
    /// refresh/offline/error so a transient failure never blanks a populated
    /// widget (web shell + `WidgetChartSummary.isEmpty`).
    static func resolvePhase(
        status: BatteryDegradationTrendLoadStatus,
        projection: BatteryDegradationProjection
    ) -> Phase {
        switch status {
        case .loading:
            projection.isEmpty ? .loading : .content
        case .empty:
            .empty
        case .loaded:
            projection.isEmpty ? .empty : .content
        case let .failed(message):
            projection.isEmpty ? .error(message) : .content
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryBatteryDegradationTrendSource: BatteryDegradationTrendSource {
    public var onUpdate: (@MainActor (BatteryDegradationTrendUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryDegradationTrendUpdate?

    public init(initial: BatteryDegradationTrendUpdate? = nil) {
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
    public func push(_ update: BatteryDegradationTrendUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the
/// "BatteryDegradationTrendWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum BatteryDegradationTrendStrings {
    public static let table = "BatteryDegradationTrendWidget"

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
public enum BatteryDegradationTrendAccessibility {
    /// Header/chart summary: "State of health 92.5%. Degradation 0.42% per month.
    /// Cycles 312." Omits the degradation clause when the rate is not shown, and
    /// reads the empty message when there is nothing to summarize.
    public static func summary(for projection: BatteryDegradationProjection) -> String {
        guard !projection.isEmpty else {
            return BatteryDegradationTrendStrings.string(
                "widget.batteryDegradationTrend.noDegradation",
                "No degradation data"
            )
        }
        var clauses: [String] = []
        let sohLabel = BatteryDegradationTrendStrings.string(
            "widget.batteryDegradationTrend.sohA11y",
            "State of health"
        )
        clauses.append("\(sohLabel) \(BatteryDegradationTrendFormat.healthValue(projection.currentHealth))")

        if let rate = projection.degradationRate, BatteryDegradationTrendBuilder.showsDegradationRate(rate) {
            let degradationLabel = BatteryDegradationTrendStrings.string(
                "widget.batteryDegradationTrend.degradationA11y",
                "Degradation"
            )
            let perMonth = BatteryDegradationTrendStrings.string(
                "widget.batteryDegradationTrend.perMonthA11y",
                "per month"
            )
            clauses.append("\(degradationLabel) \(BatteryDegradationTrendFormat.number(rate, digits: 2))% \(perMonth)")
        }

        let cyclesLabel = BatteryDegradationTrendStrings.string(
            "widget.batteryDegradationTrend.cycles",
            "Cycles"
        )
        clauses.append("\(cyclesLabel) \(BatteryDegradationTrendFormat.cyclesValue(projection.cycles))")

        return clauses.joined(separator: ". ")
    }

    /// Per-point VoiceOver value: "<MonthLabel>: <health>% health".
    public static func pointLabel(_ point: DegradationTrendPoint) -> String {
        let health = BatteryDegradationTrendFormat.number(point.health, digits: 1)
        let healthWord = BatteryDegradationTrendStrings.string(
            "widget.batteryDegradationTrend.healthPct",
            "Health %"
        )
        return "\(point.monthLabel): \(health)% \(healthWord)"
    }
}
