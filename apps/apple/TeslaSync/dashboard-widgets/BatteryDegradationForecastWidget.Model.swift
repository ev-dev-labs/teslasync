//
//  BatteryDegradationForecastWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model. The view binds through
//  `BatteryDegradationForecastModel`; no networking lives here. The model
//  coalesces the cached predictive-degradation snapshot (web `useBatteryDegradation`)
//  + the active vehicle (web `useVehicles`) into the rendered projection and a
//  mutually-exclusive render `Phase` plus freshness for SwiftUI to switch over.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol BatteryDegradationForecastTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogBatteryDegradationForecastTelemetry: BatteryDegradationForecastTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the `useBatteryDegradation`
/// `Resource<T>` (`isLoading`, `isError`, success, resolved-but-empty).
public enum BatteryDegradationForecastLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip + the connectivity banner (web `DataFreshness` live /
/// stale / offline).
public enum BatteryDegradationForecastConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `BatteryDegradationForecastSource`: the
/// cached predictive-degradation snapshot + the active vehicle + load/connection
/// status. The model turns this into the rendered projection + a render `Phase`.
public struct BatteryDegradationForecastUpdate: Sendable, Equatable {
    public var status: BatteryDegradationForecastLoadStatus
    public var connection: BatteryDegradationForecastConnection
    public var vehicle: BatteryDegradationForecastVehicle?
    public var snapshot: BatteryDegradationForecastSnapshot
    public var updatedAt: Date?

    public init(
        status: BatteryDegradationForecastLoadStatus = .loading,
        connection: BatteryDegradationForecastConnection = .live,
        vehicle: BatteryDegradationForecastVehicle? = nil,
        snapshot: BatteryDegradationForecastSnapshot = .empty,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.snapshot = snapshot
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the energy + vehicle stores); previews and tests
/// use `InMemoryBatteryDegradationForecastSource`. The view never talks to the
/// network directly.
@MainActor
public protocol BatteryDegradationForecastSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (BatteryDegradationForecastUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a
/// `BatteryDegradationForecastSource`, recomputes the
/// `BatteryDegradationForecastProjection` via `BatteryDegradationForecastBuilder`,
/// and exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class BatteryDegradationForecastModel {
    /// The mutually-exclusive render branches (web shell skeleton / error +
    /// `hasData` empty / content).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BatteryDegradationForecastConnection = .live
    public private(set) var projection: BatteryDegradationForecastProjection = .empty
    public private(set) var vehicle: BatteryDegradationForecastVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryDegradationForecastSource
    @ObservationIgnored private let telemetry: any BatteryDegradationForecastTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any BatteryDegradationForecastSource,
        telemetry: any BatteryDegradationForecastTelemetry = OSLogBatteryDegradationForecastTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryDegradationForecastWidget.surfaceSlug)
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

    /// Compact (summary-only, no hero/lists) when the widget is a single column —
    /// the web `isCompact = size.cols <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: BatteryDegradationForecastUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = BatteryDegradationForecastBuilder.buildProjection(snapshot: update.snapshot)
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No degradation forecast data" empty whenever
    /// `hasData` is false; cached content stays visible behind a refresh / offline
    /// / error so a transient failure never blanks a populated widget (web shell +
    /// `hasData` ternary).
    static func resolvePhase(
        status: BatteryDegradationForecastLoadStatus,
        projection: BatteryDegradationForecastProjection
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
public final class InMemoryBatteryDegradationForecastSource: BatteryDegradationForecastSource {
    public var onUpdate: (@MainActor (BatteryDegradationForecastUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryDegradationForecastUpdate?

    public init(initial: BatteryDegradationForecastUpdate? = nil) {
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
    public func push(_ update: BatteryDegradationForecastUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the
/// "BatteryDegradationForecastWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum BatteryDegradationForecastStrings {
    public static let table = "BatteryDegradationForecastWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
